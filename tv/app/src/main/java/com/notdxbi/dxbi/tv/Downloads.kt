package com.notdxbi.dxbi.tv

import android.app.Activity
import android.app.Notification
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Requirements
import androidx.media3.exoplayer.scheduler.Scheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Phones and TVs: films and episodes saved to watch offline, like Netflix's downloads. A stream (an addon's
 * link, debrid ones included) is downloaded in the background with Media3's DownloadManager, its
 * subtitles alongside, and plays from the phone in dx.bi's player, picking up where it was left.
 * dx.bi picks the stream (in the quality asked for: plugin api.phone.download), or it's the one
 * chosen from the list.
 *
 * Torrents download through dx.bi's own torrent engine (TorrentEngine), which the downloader reads
 * from like any other link (dxbi-torrent://<hash>…, resolved to its local address each time).
 *
 * The phone app shows them on its own screens (DownloadUi.kt). dx.bi TV shows them in the page, in
 * the Downloads a computer has (the plugin's `downloads`), which asks for them through Bridge.kt:
 * [pageList], [pageAdd], [pageAct], [pageSettings].
 */
@OptIn(UnstableApi::class)
object Downloads {

    class Item(val id: String, val stream: JSONObject, val state: Int, val percent: Float, val bytes: Long, val total: Long, val stopped: Boolean, val watchedAt: Long, val startedAt: Long = 0L) {
        val title: String get() = stream.optString("title")
        val subtitle: String get() = stream.optString("subtitle")
        val art: String? get() = stream.optString("background").takeIf { it.startsWith("http") }
        val poster: String? get() = stream.optString("poster").takeIf { it.startsWith("http") }
        val metaId: String get() = stream.optString("metaId")
        val videoId: String get() = stream.optString("videoId")
        val type: String get() = stream.optString("type")
        val season: Int? get() = if (stream.has("season") && !stream.isNull("season")) stream.optInt("season") else null
        val number: Int? get() = if (stream.has("number") && !stream.isNull("number")) stream.optInt("number") else null
        val quality: String get() = stream.optString("quality")
        val provider: String get() = stream.optString("provider")
        val done get() = state == Download.STATE_COMPLETED
        val failed get() = state == Download.STATE_FAILED
        val paused get() = stopped && !done && !failed
        val watched get() = watchedAt > 0
    }

    /** Downloads → Settings: what the Download buttons save, deleting watched ones, Wi-Fi only, where */
    data class Settings(val quality: String, val autoDelete: String, val wifiOnly: Boolean, val storage: Int)

    /** Somewhere downloads can go: the phone itself, or a memory card */
    data class Place(val index: Int, val label: String, val dir: File, val free: Long)

    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items

    private val _settings = MutableStateFlow(Settings("ask", "off", false, 0))
    val settings: StateFlow<Settings> = _settings

    /** Waiting for Wi-Fi (or any connection) before the downloads can carry on */
    private val _waiting = MutableStateFlow(false)
    val waiting: StateFlow<Boolean> = _waiting

    private var manager: DownloadManager? = null
    // (for removals the list starts itself: watched ones)
    private var appContext: Context? = null
    private lateinit var cache: SimpleCache
    private lateinit var prefs: android.content.SharedPreferences
    private val handler = Handler(Looper.getMainLooper())
    private val http by lazy { OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build() }

    private fun prefsOf(context: Context): android.content.SharedPreferences {
        if (!::prefs.isInitialized) {
            prefs = context.applicationContext.getSharedPreferences("downloads", Context.MODE_PRIVATE)
            _settings.value = Settings(
                prefs.getString("quality", "ask") ?: "ask",
                prefs.getString("autoDelete", "off") ?: "off",
                prefs.getBoolean("wifiOnly", false),
                prefs.getInt("storage", 0),
            )
        }
        return prefs
    }

    /** The phone's own storage, then any memory card (the app's own folder on each). A TV: its own, then a USB drive */
    fun places(context: Context): List<Place> {
        val app = context.applicationContext
        val dirs = app.getExternalFilesDirs(null).toList()
        val tv = app.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val own = if (tv) "This TV" else "Phone storage"
        val card = if (tv) "USB drive" else "Memory card"
        val out = mutableListOf<Place>()
        dirs.forEachIndexed { i, d ->
            if (d == null) return@forEachIndexed
            val free = runCatching { StatFs(d.path).availableBytes }.getOrDefault(-1L)
            out += Place(i, if (i == 0) own else if (dirs.size > 2) "$card $i" else card, File(d, "downloads"), free)
        }
        if (out.isEmpty()) out += Place(0, own, File(app.filesDir, "downloads"), runCatching { StatFs(app.filesDir.path).availableBytes }.getOrDefault(-1L))
        return out
    }

    private fun folder(context: Context): File {
        val all = places(context)
        return (all.firstOrNull { it.index == prefsOf(context).getInt("storage", 0) } ?: all.first()).dir
    }

    @Synchronized
    fun manager(context: Context): DownloadManager {
        manager?.let { return it }
        val app = context.applicationContext
        appContext = app
        prefsOf(app)
        val db = StandaloneDatabaseProvider(app)
        cache = SimpleCache(folder(app), NoOpCacheEvictor(), db)
        val m = DownloadManager(app, db, cache, withHeaders(), Executors.newFixedThreadPool(4))
        m.maxParallelDownloads = prefs.getInt("parallel", 2)
        m.requirements = requirements()
        m.addListener(object : DownloadManager.Listener {
            override fun onDownloadChanged(manager: DownloadManager, download: Download, finalException: Exception?) {
                // a torrent's own copy goes once the download has it all
                if (download.state == Download.STATE_COMPLETED) TorrentEngine.hashOf(download.request.uri.toString())?.let { TorrentEngine.drop(app, it, torrentDir(app)) }
                refresh()
            }
            override fun onDownloadRemoved(manager: DownloadManager, download: Download) = refresh()
            override fun onInitialized(manager: DownloadManager) {
                // (torrents left behind by downloads that have since gone)
                val wanted = runCatching {
                    manager.downloadIndex.getDownloads().use { c ->
                        buildSet { while (c.moveToNext()) if (c.download.state != Download.STATE_COMPLETED) TorrentEngine.hashOf(c.download.request.uri.toString())?.let { add(it) } }
                    }
                }.getOrNull()
                if (wanted != null) TorrentEngine.tidy(torrentDir(app), wanted)
                // Downloads only run while the service does, and nothing else brings it back after
                // dx.bi was updated, closed by Android or the phone restarted: they sat at
                // "Downloading 0%" for ever
                val unfinished = runCatching {
                    manager.downloadIndex.getDownloads(Download.STATE_QUEUED, Download.STATE_DOWNLOADING, Download.STATE_RESTARTING).use { it.count > 0 }
                }.getOrDefault(false)
                if (unfinished) runCatching { DownloadService.sendResumeDownloads(app, DownloadsService::class.java, false) }
                refresh()
            }
            override fun onRequirementsStateChanged(manager: DownloadManager, requirements: Requirements, notMetRequirements: Int) = refresh()
        })
        manager = m
        refresh()
        return m
    }

    private fun requirements() = Requirements(if (_settings.value.wifiOnly) Requirements.NETWORK_UNMETERED else Requirements.NETWORK)

    /**
     * Where torrents being downloaded keep their own copy until it's been saved: the app's own
     * storage, never shared storage (Android/data, a memory card), which Android serves through
     * FUSE. There, libtorrent's file handling crashed Android 14's storage daemon, which took
     * dx.bi (and every app using storage) down with it a few seconds into a download.
     */
    private fun torrentDir(context: Context): File = File(context.noBackupFilesDir, "torrent-parts")

    /** Addons can ask for headers on their links: kept per link, added to every request for it */
    private fun withHeaders(): DataSource.Factory = ResolvingDataSource.Factory(OkHttpDataSource.Factory(http)) { spec ->
        val app = appContext
        if (spec.uri.scheme == TorrentEngine.SCHEME) {
            spec.withUri(TorrentEngine.resolveDownload(app ?: throw java.io.IOException("Downloads aren't set up"), spec.uri, torrentDir(app)))
        } else {
            val saved = prefs.getString("headers:${spec.uri}", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (saved == null) spec else spec.withAdditionalHeaders(saved.keys().asSequence().associateWith { saved.optString(it) })
        }
    }

    /**
     * What the player reads a download through: the phone first, the internet for anything not saved yet.
     * Its subtitles were saved as files (file://), which only DefaultDataSource opens: through the
     * cache alone (web addresses only) they failed, and downloads had no subtitles to choose.
     */
    fun playback(context: Context): DataSource.Factory {
        manager(context)
        val saved = CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(withHeaders()).setCacheWriteDataSinkFactory(null)
        return DefaultDataSource.Factory(context.applicationContext, saved)
    }

    /** The download of one film or episode, if there is one */
    fun find(metaId: String, videoId: String): Item? = _items.value.firstOrNull { it.metaId == metaId && it.videoId == videoId }

    /**
     * Starts saving the stream the page (or the plugin's pick) handed over (the same details the
     * player gets). [quiet]: no "Downloading…" message (a whole season says it once). False when it
     * can't be downloaded or already is.
     */
    /**
     * A message on screen from any thread. [add] is called from the page's bridge and from
     * background coroutines (a torrent picked to download), and a Toast made off the main thread
     * crashed the app ("Can't toast on a thread that has not called Looper.prepare()").
     */
    fun toast(context: Context, text: String, long: Boolean = false) {
        val app = context.applicationContext
        val show = { Toast.makeText(app, text, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show() }
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) show() else android.os.Handler(android.os.Looper.getMainLooper()).post(show)
    }

    fun add(context: Context, json: String, quiet: Boolean = false): Boolean {
        val app = context.applicationContext
        manager(app)
        val stream = JSONObject(json)
        // a torrent: { infoHash, fileIdx, trackers[], name } (plugin api.phone.download / downloadOption)
        stream.optJSONObject("magnet")?.takeIf { it.optString("infoHash").matches(Regex("(?i)[0-9a-f]{40}")) }?.let { m ->
            val trackers = m.optJSONArray("trackers")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() } } ?: emptyList()
            stream.put("url", TorrentEngine.downloadUri(m.optString("infoHash"), m.optInt("fileIdx", -1), trackers, m.optString("name")))
            stream.remove("magnet")
            stream.put("torrent", false)
        }
        val url = stream.optString("url")
        if (url.isEmpty() || stream.optBoolean("torrent")) {
            // (a torrent the page started playing: its address only lasts while it plays)
            toast(app, "Couldn't download that one. Try Download again from the stream's ⋮ menu.", long = true)
            return false
        }
        // (a stream played through the page names its title in its player address:
        // #/player/<stream>/<addon>/<meta addon>/<type>/<id>/<video>)
        val parts = stream.optString("hash").split("/")
        if (stream.optString("metaId").isEmpty() && parts.size >= 8 && parts[1] == "player") {
            stream.put("type", Uri.decode(parts[5])).put("metaId", Uri.decode(parts[6]))
            if (stream.optString("videoId").isEmpty()) stream.put("videoId", Uri.decode(parts[7]))
        }
        val metaId = stream.optString("metaId")
        val videoId = stream.optString("videoId").ifEmpty { metaId }
        stream.put("videoId", videoId)
        val id = (if (metaId.isNotEmpty()) "$metaId:$videoId" else "${stream.optString("hash").hashCode()}-$videoId").replace(Regex("[^\\w:.-]"), "_")
        val old = _items.value.firstOrNull { it.id == id }
        if (old != null && !old.failed) {
            if (!quiet) toast(app, if (old.done) "Already downloaded" else "Already downloading")
            return false
        }
        if (!quiet) toast(app, "Downloading ${listOf(stream.optString("title"), stream.optString("subtitle")).filter { it.isNotEmpty() }.joinToString(" · ")}")
        prefs.edit().remove("watched:$id").remove("pos:$id").apply()
        thread(name = "dxbi-download-prepare") {
            stream.optJSONObject("headers")?.takeIf { it.length() > 0 }?.let { prefs.edit().putString("headers:$url", it.toString()).apply() }
            // (a torrent's copy from a failed try is picked up again: only a different one is dropped)
            if (old != null) TorrentEngine.hashOf(old.stream.optString("url"))?.takeIf { it != TorrentEngine.hashOf(url) }?.let { TorrentEngine.drop(app, it, torrentDir(app)) }
            // subtitles are small: saved straight away (up to three, already ordered by language)
            val subs = stream.optJSONArray("subtitles") ?: JSONArray()
            val saved = JSONArray()
            val dir = File(app.filesDir, "download-subs/$id").apply { mkdirs() }
            for (i in 0 until minOf(subs.length(), 3)) {
                val s = subs.optJSONObject(i) ?: continue
                val file = File(dir, "$i." + (Uri.parse(s.optString("url")).lastPathSegment?.substringAfterLast('.', "srt")?.take(4)?.takeIf { it.matches(Regex("srt|vtt|ass|ssa")) } ?: "srt"))
                val ok = runCatching {
                    http.newCall(Request.Builder().url(s.optString("url")).build()).execute().use { r ->
                        if (!r.isSuccessful) return@use false
                        file.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
                        true
                    }
                }.getOrDefault(false)
                // (addons' links often have no extension: the file's first line says what it is)
                val named = if (!ok) file else runCatching {
                    val head = file.inputStream().use { input -> ByteArray(512).let { b -> String(b, 0, maxOf(0, input.read(b)), Charsets.UTF_8) } }.trimStart('\uFEFF', ' ', '\r', '\n')
                    val ext = when {
                        head.startsWith("WEBVTT") -> "vtt"
                        head.startsWith("[Script Info]", ignoreCase = true) -> "ass"
                        else -> file.extension
                    }
                    if (ext == file.extension) file else File(dir, "$i.$ext").also { file.renameTo(it) }
                }.getOrDefault(file)
                if (ok) saved.put(JSONObject(s.toString()).put("url", Uri.fromFile(named).toString()))
            }
            stream.put("subtitles", saved)
            if (old != null) DownloadService.sendRemoveDownload(app, DownloadsService::class.java, id, false)
            val request = DownloadRequest.Builder(id, Uri.parse(url)).setData(stream.toString().toByteArray()).build()
            DownloadService.sendAddDownload(app, DownloadsService::class.java, request, false)
        }
        return true
    }

    fun remove(context: Context, item: Item) {
        DownloadService.sendRemoveDownload(context.applicationContext, DownloadsService::class.java, item.id, false)
        TorrentEngine.hashOf(item.stream.optString("url"))?.let { TorrentEngine.drop(context.applicationContext, it, torrentDir(context.applicationContext)) }
        File(context.applicationContext.filesDir, "download-subs/${item.id}").deleteRecursively()
        prefsOf(context).edit().remove("pos:${item.id}").remove("watched:${item.id}").apply()
    }

    fun pause(context: Context, item: Item) =
        DownloadService.sendSetStopReason(context.applicationContext, DownloadsService::class.java, item.id, 1, false)

    fun resume(context: Context, item: Item) =
        DownloadService.sendSetStopReason(context.applicationContext, DownloadsService::class.java, item.id, Download.STOP_REASON_NONE, false)

    /** A failed one, again (the same link: Torrentio's ask the debrid service afresh each time) */
    fun retry(context: Context, item: Item) {
        DownloadService.sendRemoveDownload(context.applicationContext, DownloadsService::class.java, item.id, false)
        handler.postDelayed({
            val request = DownloadRequest.Builder(item.id, Uri.parse(item.stream.optString("url"))).setData(item.stream.toString().toByteArray()).build()
            DownloadService.sendAddDownload(context.applicationContext, DownloadsService::class.java, request, false)
        }, 400)
    }

    fun setWatched(context: Context, item: Item, watched: Boolean) {
        prefsOf(context).edit().apply { if (watched) putLong("watched:${item.id}", System.currentTimeMillis()) else remove("watched:${item.id}") }.apply()
        refresh()
    }

    /** Deletes every download that's been watched */
    fun removeWatched(context: Context) = _items.value.filter { it.watched && it.done }.forEach { remove(context, it) }

    /** Plays a download in dx.bi's player, from the phone, where it was left */
    fun play(context: Context, item: Item) {
        val stream = JSONObject(item.stream.toString())
            .put("offline", item.id)
            .put("startMs", prefsOf(context).getLong("pos:${item.id}", item.stream.optLong("startMs", 0L)))
            // (no up-next card or skip times offline: those come from the internet)
            .put("next", JSONObject.NULL)
        context.startActivity(Intent(context, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_STREAM, stream.toString()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Where a download was left (the player says when it closes): near the end counts as watched */
    fun leftAt(id: String, positionMs: Long, durationMs: Long, ended: Boolean) {
        if (!::prefs.isInitialized) return
        val finished = ended || (durationMs > 60_000 && positionMs >= durationMs * 0.92)
        prefs.edit().putLong("pos:$id", if (finished) 0L else positionMs).apply {
            if (finished && !prefs.contains("watched:$id")) putLong("watched:$id", System.currentTimeMillis())
        }.apply()
        refresh()
    }

    // ---------------------------------------------------------------------------------------------
    // Settings

    fun setQuality(context: Context, quality: String) {
        prefsOf(context).edit().putString("quality", quality).apply()
        _settings.value = _settings.value.copy(quality = quality)
    }

    fun setAutoDelete(context: Context, mode: String) {
        prefsOf(context).edit().putString("autoDelete", mode).apply()
        _settings.value = _settings.value.copy(autoDelete = mode)
        refresh()
    }

    fun setWifiOnly(context: Context, on: Boolean) {
        prefsOf(context).edit().putBoolean("wifiOnly", on).apply()
        _settings.value = _settings.value.copy(wifiOnly = on)
        manager?.requirements = requirements()
    }

    /**
     * Moves downloads to another place (the phone or a memory card), then restarts dx.bi: the
     * downloads' store can't be reopened somewhere else while the app runs. [progress] hears how far
     * the copy is (0 to 1), on another thread.
     */
    fun moveTo(activity: Activity, place: Place, progress: (Float) -> Unit, failed: (String) -> Unit) {
        val app = activity.applicationContext
        val from = folder(app)
        if (from == place.dir) return
        manager?.pauseDownloads()
        thread(name = "dxbi-download-move") {
            try {
                Thread.sleep(800) // (the running ones let go of their files)
                val files = from.walkTopDown().filter { it.isFile }.toList()
                val total = files.sumOf { it.length() }.coerceAtLeast(1)
                if (place.free in 0 until total + 100_000_000L) error("Not enough space there: it needs ${"%.1f".format(total / 1e9)} GB.")
                var copied = 0L
                for (f in files) {
                    val to = File(place.dir, f.relativeTo(from).path)
                    to.parentFile?.mkdirs()
                    f.inputStream().use { input -> to.outputStream().use { out ->
                        val buf = ByteArray(1 shl 16)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            copied += n
                            progress(copied.toFloat() / total)
                        }
                    } }
                }
                prefs.edit().putInt("storage", place.index).commit()
                from.deleteRecursively()
                handler.post {
                    // start again as a new process, in the new place
                    val start = activity.packageManager.getLaunchIntentForPackage(activity.packageName)?.component
                    if (start != null) activity.startActivity(Intent.makeRestartActivityTask(start))
                    Runtime.getRuntime().exit(0)
                }
            } catch (e: Exception) {
                place.dir.deleteRecursively()
                manager?.resumeDownloads()
                handler.post { failed(e.message ?: "Couldn't move them.") }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------

    private val tick = Runnable { refresh() }

    fun refresh() {
        val m = manager ?: return
        val list = mutableListOf<Item>()
        val now = System.currentTimeMillis()
        runCatching {
            m.downloadIndex.getDownloads().use { c ->
                while (c.moveToNext()) {
                    val d = c.download
                    val stream = runCatching { JSONObject(String(d.request.data)) }.getOrDefault(JSONObject())
                    list += Item(d.request.id, stream, d.state, d.percentDownloaded.coerceAtLeast(0f), d.bytesDownloaded, d.contentLength, d.stopReason != Download.STOP_REASON_NONE, prefs.getLong("watched:${d.request.id}", 0L), d.startTimeMs)
                }
            }
        }
        // (the index only keeps how far a download got now and then: the ones running are read live)
        val live = m.currentDownloads.associateBy { it.request.id }
        val items = list.map { i -> live[i.id]?.let { d -> Item(i.id, i.stream, d.state, d.percentDownloaded.coerceAtLeast(0f), d.bytesDownloaded, d.contentLength, d.stopReason != Download.STOP_REASON_NONE, i.watchedAt, i.startedAt) } ?: i }
            .sortedWith(compareBy({ it.stream.optString("title") }, { it.season ?: 0 }, { it.number ?: 0 }))
        // watched ones go the way Downloads → Settings says
        val wait = when (_settings.value.autoDelete) { "finished" -> 0L; "day" -> 24 * 3600 * 1000L; else -> -1L }
        val gone = if (wait < 0) emptyList() else items.filter { it.done && it.watched && now - it.watchedAt >= wait }
        _items.value = items - gone.toSet()
        _waiting.value = m.notMetRequirements != 0 && items.any { !it.done && !it.failed && !it.paused }
        // torrents fetch only while their download runs (not paused, or waiting for Wi-Fi)
        TorrentEngine.keepRunning(m.currentDownloads.filter { it.state == Download.STATE_DOWNLOADING }.mapNotNull { TorrentEngine.hashOf(it.request.uri.toString()) }.toSet())
        appContext?.let { c -> if (gone.isNotEmpty()) handler.post { gone.forEach { remove(c, it) } } }
        handler.removeCallbacks(tick)
        if (m.currentDownloads.isNotEmpty()) handler.postDelayed(tick, 1000)
        listener?.invoke()
    }

    // ---------------------------------------------------------------------------------------------
    // dx.bi TV: the page's Downloads (the plugin's `downloads`, as on a computer), through Bridge.kt.
    // These run on the main thread (Bridge hands them over).

    /** Told after every change (the TV's page then asks for the list again) */
    @Volatile var listener: (() -> Unit)? = null

    // how fast each one is going: its bytes a moment ago, and when
    private val lastBytes = HashMap<String, Pair<Long, Long>>()
    private val speeds = HashMap<String, Long>()

    /** The downloads, in the shape a computer's list has (the plugin's `downloads.list`) */
    fun pageList(): String {
        val out = JSONArray()
        val now = System.currentTimeMillis()
        val waitingNow = _waiting.value
        for (i in _items.value) {
            val s = i.stream
            val state = when {
                i.done -> "done"
                i.failed -> "failed"
                i.paused -> "paused"
                i.state == Download.STATE_DOWNLOADING || i.state == Download.STATE_RESTARTING -> "downloading"
                else -> "queued"
            }
            var speed = 0L
            if (state == "downloading") {
                val before = lastBytes[i.id]
                if (before == null || now - before.second >= 1500) {
                    if (before != null && i.bytes >= before.first) speeds[i.id] = (i.bytes - before.first) * 1000 / (now - before.second)
                    lastBytes[i.id] = i.bytes to now
                }
                speed = speeds[i.id] ?: 0L
            } else {
                lastBytes.remove(i.id)
                speeds.remove(i.id)
            }
            out.put(JSONObject()
                .put("id", i.id)
                .put("type", i.type)
                .put("metaId", i.metaId)
                .put("videoId", i.videoId)
                .put("name", s.optString("title"))
                .put("episode", s.optString("subtitle"))
                .put("year", s.optString("year"))
                .put("season", i.season ?: JSONObject.NULL)
                .put("number", i.number ?: JSONObject.NULL)
                .put("poster", i.poster ?: "")
                .put("background", i.art ?: i.poster ?: "")
                .put("quality", i.quality)
                .put("provider", i.provider)
                .put("filename", s.optString("filename"))
                .put("torrent", TorrentEngine.hashOf(s.optString("url")) != null)
                .put("state", state)
                .put("received", i.bytes)
                .put("size", if (i.total > 0) i.total else s.optLong("size"))
                .put("speed", speed)
                .put("watchedAt", i.watchedAt)
                .put("addedAt", i.startedAt)
                .put("error", when {
                    state == "failed" -> "It stopped downloading. Try again, or pick another stream."
                    waitingNow && state != "done" && state != "paused" -> if (_settings.value.wifiOnly) "Waiting for Wi-Fi" else "Waiting for the internet"
                    else -> ""
                }))
        }
        return out.toString()
    }

    /**
     * A download the page asks for: a computer's download (the plugin's downloads.spec), saved like
     * the phone saves one. { ok } or { ok: false, error }
     */
    fun pageAdd(context: Context, specJson: String): String {
        val spec = JSONObject(specJson)
        val metaId = spec.optString("metaId")
        val videoId = spec.optString("videoId").ifEmpty { metaId }
        manager(context)
        find(metaId, videoId)?.takeIf { !it.failed }?.let {
            return JSONObject().put("ok", false).put("error", if (it.done) "Already downloaded" else "Already downloading").toString()
        }
        val subtitles = JSONArray()
        spec.optJSONArray("subtitles")?.let { a ->
            for (n in 0 until a.length()) a.optJSONObject(n)?.let { x ->
                subtitles.put(JSONObject().put("url", x.optString("url")).put("lang", x.optString("lang")).put("label", x.optString("lang")).put("start", n == 0))
            }
        }
        val stream = JSONObject()
            .put("url", spec.optString("url"))
            .put("headers", spec.optJSONObject("headers") ?: JSONObject())
            .put("subtitles", subtitles)
            .put("title", spec.optString("name"))
            .put("subtitle", spec.optString("episode"))
            .put("background", spec.optString("background"))
            .put("poster", spec.optString("poster"))
            .put("type", spec.optString("type"))
            .put("metaId", metaId)
            .put("videoId", videoId)
            .put("season", spec.opt("season") ?: JSONObject.NULL)
            .put("number", spec.opt("number") ?: JSONObject.NULL)
            .put("year", spec.optString("year"))
            .put("quality", spec.optString("quality"))
            .put("provider", spec.optString("provider"))
            .put("filename", spec.optString("filename"))
            .put("size", spec.optLong("size"))
        // a torrent: { infoHash, fileIdx, sources } (its "sources" list its trackers), fetched by the engine
        spec.optJSONObject("torrent")?.takeIf { spec.optString("url").isEmpty() }?.let { t ->
            val trackers = JSONArray()
            t.optJSONArray("sources")?.let { a -> for (n in 0 until a.length()) a.optString(n).takeIf { it.startsWith("tracker:") }?.let { trackers.put(it.removePrefix("tracker:")) } }
            stream.put("magnet", JSONObject()
                .put("infoHash", t.optString("infoHash"))
                .put("fileIdx", if (t.isNull("fileIdx")) -1 else t.optInt("fileIdx", -1))
                .put("trackers", trackers)
                .put("name", spec.optString("filename")))
        }
        val ok = add(context, stream.toString(), quiet = true)
        return JSONObject().put("ok", ok).apply { if (!ok) put("error", "Couldn't download that one. Try another stream.") }.toString()
    }

    /** What the page's buttons do to one download ([id]), or to all of them */
    fun pageAct(context: Context, verb: String, id: String) {
        manager(context)
        val item = _items.value.firstOrNull { it.id == id }
        when (verb) {
            "play" -> item?.takeIf { it.done }?.let { play(context, it) }
            "pause" -> item?.let { pause(context, it) }
            "resume" -> item?.let { resume(context, it) }
            "retry" -> item?.let { retry(context, it) }
            "remove" -> item?.let { remove(context, it) }
            "unwatched" -> item?.let { setWatched(context, it, false) }
            "finished" -> item?.let { setWatched(context, it, true) }
            "removeWatched" -> removeWatched(context)
        }
        refresh()
    }

    /** The page's Downloads → Settings: [changes] made first (null: none), then all of them */
    fun pageSettings(context: Context, changes: JSONObject?): String {
        manager(context)
        if (changes != null) {
            changes.optString("quality").takeIf { it.isNotEmpty() }?.let { setQuality(context, it) }
            changes.optString("autoDelete").takeIf { it.isNotEmpty() }?.let { setAutoDelete(context, it) }
            if (changes.has("wifiOnly")) setWifiOnly(context, changes.optBoolean("wifiOnly"))
            if (changes.has("parallel")) {
                val n = changes.optInt("parallel", 2).coerceIn(1, 4)
                prefsOf(context).edit().putInt("parallel", n).apply()
                manager?.maxParallelDownloads = n
            }
        }
        val all = places(context)
        val here = all.firstOrNull { it.index == prefsOf(context).getInt("storage", 0) } ?: all.first()
        val s = _settings.value
        return JSONObject()
            .put("quality", s.quality)
            .put("autoDelete", s.autoDelete)
            .put("wifiOnly", s.wifiOnly)
            .put("parallel", prefsOf(context).getInt("parallel", 2))
            .put("folder", here.label)
            .put("defaultFolder", here.label)
            .put("free", here.free)
            .toString()
    }

}

/** Keeps downloads going with the app closed, with their progress in a notification */
@OptIn(UnstableApi::class)
class DownloadsService : DownloadService(
    FOREGROUND_NOTIFICATION_ID,
    DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    CHANNEL,
    R.string.downloads_channel,
    0,
) {
    override fun getDownloadManager(): DownloadManager = Downloads.manager(this)

    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        DownloadNotificationHelper(this, CHANNEL).buildProgressNotification(this, R.drawable.ic_play, null, null, downloads, notMetRequirements)

    private companion object {
        const val FOREGROUND_NOTIFICATION_ID = 7041
        const val CHANNEL = "downloads"
    }
}
