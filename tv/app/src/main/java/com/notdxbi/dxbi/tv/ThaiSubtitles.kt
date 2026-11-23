package com.notdxbi.dxbi.tv

import android.content.Context
import android.util.Log
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Thai subtitles, on by default (dx.bi settings → Thai subtitles). Stremio's subtitle addon
 * (OpenSubtitles v3) has next to none, but OpenSubtitles' older REST API has them, needs no key and
 * takes the app's own name. The page asks as soon as a film's or an episode's streams are on screen
 * (Bridge.thaiSubtitles), so the files are usually here before one is played; the page and the player
 * ask again as it starts, and get the same lookup while it's still going. The files are kept for the
 * title, so a second play needs no download. Nothing here holds up playback: no IMDb id, no network,
 * an error or no Thai file, and the film plays as it would have.
 */
object ThaiSubtitles {
    /** How many Thai files are fetched for a title ("Thai", "Thai 2") */
    const val SLOTS = 2
    private const val API = "https://rest.opensubtitles.org/search"
    // ~100 titles' worth; the least recently played go first
    private const val CACHE_BYTES = 20L shl 20
    // A title with no Thai file is asked about again after a day (someone may have added one); one whose
    // files all failed to come, after an hour
    private const val NONE_FOR_MS = 24 * 3600_000L
    private const val FAILED_FOR_MS = 3600_000L
    // Downloads that fail before a lookup gives up: each one is a request in the app's name
    private const val MAX_FAILED = 3

    /** One title's lookup. Its files are [file] 1…[ready]; [done] once nothing more is coming */
    class Job(val key: String, val dir: File) {
        @Volatile var ready = 0
            internal set
        @Volatile var done = false
            internal set
        /** The stream's name, which picks between the files; empty when the page asked before one was picked */
        @Volatile internal var release = ""
        private val listeners = CopyOnWriteArrayList<(Job) -> Unit>()

        fun file(slot: Int) = File(dir, "$slot.srt")
        fun listen(listener: (Job) -> Unit) { listeners += listener }
        fun unlisten(listener: (Job) -> Unit) { listeners -= listener }
        internal fun changed() = listeners.forEach { runCatching { it(this) } }
    }

    private val running = HashMap<String, Job>()
    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /**
     * The lookup for [json] ({ imdb: "tt0903747", season, episode, release } from dxbi-tv.js): the one
     * already going for that title, its kept files, or a new one. Null when there's nothing to look up.
     */
    fun request(context: Context, json: JSONObject?): Job? {
        val imdb = json?.optString("imdb").orEmpty()
        if (!Regex("tt\\d{5,10}").matches(imdb)) return null
        val season = json!!.optInt("season", -1)
        val episode = json.optInt("episode", -1)
        val isEpisode = season >= 0 && episode >= 0
        val key = if (isEpisode) "$imdb-s${season}e$episode" else imdb
        val root = File(context.cacheDir, "thai-subtitles")
        synchronized(running) {
            running[key]?.let { job ->
                // (asked from the title's streams, before one was picked: the stream played still helps
                // pick the files, when the search hasn't answered yet)
                if (job.release.isEmpty()) job.release = json.optString("release")
                return job
            }
            val job = Job(key, File(root, key))
            if (kept(job)) return job
            running[key] = job
            job.release = json.optString("release")
            val agent = "dxbi-tv/${BuildConfigVersion.name(context)}"
            thread(name = "dxbi-thai-subtitles", isDaemon = true) {
                fetch(job, imdb, if (isEpisode) season else null, if (isEpisode) episode else null, agent)
                synchronized(running) { running.remove(key) }
                job.done = true
                job.changed()
                // (an error here would take the app down with it)
                runCatching { trim(root, synchronized(running) { running.keys.toSet() } + key) }
            }
            return job
        }
    }

    /**
     * The title's files from an earlier play, or that it has none (within the day), or that they failed
     * to come (within the hour): no lookup needed. The marker holds how many files there are; 0 for
     * none, -1 for failed
     */
    private fun kept(job: Job): Boolean {
        val marker = File(job.dir, "found")
        val count = (if (marker.isFile) runCatching { marker.readText().trim().toInt() }.getOrNull() else null) ?: return false
        val now = System.currentTimeMillis()
        if (count <= 0) {
            if (now - marker.lastModified() > (if (count < 0) FAILED_FOR_MS else NONE_FOR_MS)) return false
        } else {
            job.ready = (1..minOf(count, SLOTS)).takeWhile { job.file(it).length() > 0 }.size
            if (job.ready == 0) return false
            // (played again: kept the longest)
            job.dir.setLastModified(now)
        }
        job.done = true
        return true
    }

    private fun fetch(job: Job, imdb: String, season: Int?, episode: Int?, agent: String) {
        var found = 0
        var failed = 0
        var finished = false
        try {
            job.dir.mkdirs()
            File(job.dir, "found").delete()
            val digits = imdb.removePrefix("tt")
            val url = if (season != null) "$API/episode-$episode/imdbid-$digits/season-$season/sublanguageid-tha" else "$API/imdbid-$digits/sublanguageid-tha"
            val answer = JSONArray(String(get(url, agent, 1 shl 20) ?: return, Charsets.UTF_8))
            val candidates = (0 until answer.length()).mapNotNull { i ->
                val o = answer.optJSONObject(i) ?: return@mapNotNull null
                // (a file in parts for a two-disc release, one marked bad, or another episode's: not for this)
                if (o.optString("SubSumCD", "1") != "1" || o.optString("SubBad") == "1") return@mapNotNull null
                if (season != null && (o.optString("SeriesSeason") != season.toString() || o.optString("SeriesEpisode") != episode.toString())) return@mapNotNull null
                SubtitleFiles.Candidate(
                    release = o.optString("MovieReleaseName") + "\n" + o.optString("SubFileName"),
                    format = o.optString("SubFormat"),
                    downloads = o.optString("SubDownloadsCnt").toIntOrNull() ?: 0,
                    hearingImpaired = o.optString("SubHearingImpaired") == "1",
                    link = o.optString("SubDownloadLink"),
                )
            }
            // (the download links carry a token that lasts minutes: fetched straight after the search)
            for (c in SubtitleFiles.rank(candidates, job.release)) {
                if (found >= SLOTS) break
                // (any trouble with one file, a parser's included, counts as one failure, not the end of the lookup)
                val srt = try { download(c.link, agent) } catch (_: Exception) { null }
                if (srt == null) {
                    // (links that keep failing won't work today: a quota, an expired link, a page in its place)
                    if (++failed >= MAX_FAILED) break
                    continue
                }
                write(job.file(found + 1), srt)
                found++
                job.ready = found
                job.changed()
            }
            finished = true
            Log.i("dxbi", "Thai subtitles for ${job.key}: ${candidates.size} on OpenSubtitles, $found kept, $failed failed")
        } catch (e: Exception) {
            Log.i("dxbi", "Thai subtitles for ${job.key}: ${e.javaClass.simpleName} ${e.message.orEmpty()}")
        } finally {
            // What the title has, kept for next time: its files, or that it has none. When the files it tried
            // all failed to come, that's kept for an hour, so the player's own ask in the same play (and the
            // plays after) doesn't try them all again. No answer from the search: asked again next time
            val marker = when {
                found > 0 -> found.toString()
                failed > 0 -> "-1"
                finished -> "0"
                else -> null
            }
            if (marker != null) runCatching { File(job.dir, "found").writeText(marker) }
        }
    }

    private fun get(url: String, agent: String, limit: Int): ByteArray? {
        val request = Request.Builder().url(url)
            .header("User-Agent", agent)
            .header("X-User-Agent", agent)
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            return response.body?.byteStream()?.use { SubtitleFiles.readLimited(it, limit) }
        }
    }

    /** A subtitle file as UTF-8 SubRip, or null when it isn't one the player can read */
    private fun download(link: String, agent: String): String? {
        // (only from OpenSubtitles itself, whatever its answer says)
        val url = link.toHttpUrlOrNull()?.takeIf { it.isHttps && (it.host == "opensubtitles.org" || it.host.endsWith(".opensubtitles.org")) } ?: return null
        val packed = get(url.toString(), agent, 4 shl 20) ?: return null
        val bytes = SubtitleFiles.gunzip(packed) ?: return null
        return SubtitleFiles.toSrt(SubtitleFiles.decode(bytes))
    }

    /**
     * Written whole and then put in place, so a player never reads half a file (Android's rename replaces
     * a file in one step; elsewhere it's taken away first)
     */
    private fun write(file: File, text: String) {
        val part = File(file.parentFile, "${file.name}.part")
        part.writeText(text, Charsets.UTF_8)
        if (!part.renameTo(file) && !(file.delete() && part.renameTo(file))) {
            part.delete()
            throw IOException("couldn't keep ${file.name}")
        }
    }

    /** Keeps the kept files under [CACHE_BYTES], letting the titles played longest ago go first */
    private fun trim(root: File, keep: Set<String>) {
        val dirs = root.listFiles()?.filter { it.isDirectory } ?: return
        val size = { d: File -> d.listFiles()?.sumOf { it.length() } ?: 0L }
        var total = dirs.sumOf(size)
        // (each folder's time read once: a title played or fetched meanwhile changes it, and a sort whose
        // keys change under it can throw)
        for ((d, _) in dirs.map { it to it.lastModified() }.sortedBy { it.second }) {
            if (total <= CACHE_BYTES) break
            if (d.name in keep) continue
            val bytes = size(d)
            if (d.deleteRecursively()) total -= bytes
        }
    }
}
