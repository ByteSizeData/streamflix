package com.notdxbi.dxbi.tv

import android.content.Context
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Play on TV, the phone's side: finds TVs on the home network that have the app open (TvReceiver.kt
 * in src/main is what answers), sends the chosen stream there instead of playing it here, and works
 * that TV's player. While a TV is chosen, Play goes to it, as it does with a Chromecast.
 *
 * The TV plays the stream itself (it's sent Stremio's link to it), so the TV keeps the watch
 * progress and carries on to the next episode whether or not this phone stays awake.
 */
object TvRemote {
    const val PORT = 47821
    private const val CONNECT_MS = 350

    data class Tv(val name: String, val host: String, val port: Int = PORT)

    data class Status(
        val open: Boolean,
        val screen: String,
        val title: String,
        val subtitle: String,
        val positionMs: Long,
        val durationMs: Long,
        val paused: Boolean,
        val buffering: Boolean,
    ) {
        companion object {
            fun from(o: JSONObject) = Status(
                o.optBoolean("open"), o.optString("screen"), o.optString("title"), o.optString("subtitle"),
                o.optLong("positionMs"), o.optLong("durationMs"), o.optBoolean("paused"), o.optBoolean("buffering"),
            )
        }
    }

    /** One thing to choose in the TV player's settings, and whether it is the one chosen */
    data class Choice(val id: String, val name: String, val on: Boolean)

    /** The TV player's settings (PlayerOptions.kt on the TV): each a list to choose from */
    data class Options(
        val audio: List<Choice>,
        val subtitles: List<Choice>,
        val subtitleDelayMs: Long,
        val speed: List<Choice>,
        val picture: List<Choice>,
        val zoom: List<Choice>,
        val sound: List<Choice>,
        val boost: List<Choice>,
    ) {
        companion object {
            private fun list(o: JSONObject, name: String): List<Choice> {
                val a = o.optJSONArray(name) ?: return emptyList()
                return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Choice(it.optString("id"), it.optString("name"), it.optBoolean("on")) }
            }
            fun from(o: JSONObject) = Options(
                list(o, "audio"), list(o, "subtitles"), o.optLong("subtitleDelayMs"),
                list(o, "speed"), list(o, "picture"), list(o, "zoom"), list(o, "sound"), list(o, "boost"),
            )
        }
    }

    /** The TV that Play goes to (none: this phone plays) */
    val tv = MutableStateFlow<Tv?>(null)
    /** TVs found on the network, the last one used first */
    val found = MutableStateFlow<List<Tv>>(emptyList())
    val searching = MutableStateFlow(false)
    /** A TV being asked to let this phone in (its name), while the TV shows its question */
    val connecting = MutableStateFlow<String?>(null)
    /** What the TV is playing; null until it has answered */
    val status = MutableStateFlow<Status?>(null)
    /** The TV player's settings, once asked for; null when nothing plays or the TV app is an older one */
    val options = MutableStateFlow<Options?>(null)
    /** The chosen TV has stopped answering (asleep, or the app closed there) */
    val lost = MutableStateFlow(false)
    /** Something to tell the viewer, shown in the sheet until the next thing happens */
    val problem = MutableStateFlow<String?>(null)
    /** The sheet with the TVs, or the remote, is open */
    val sheet = MutableStateFlow(false)
    /** When Play was sent and the TV's player isn't up yet (0: nothing on its way): the remote says it's starting */
    val starting = MutableStateFlow(0L)
    /** What the TV was playing when Play was sent ("title|subtitle"), so that isn't taken for the new one */
    @Volatile private var playingBefore: String? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poll: Job? = null
    private val random = SecureRandom()

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("tv-remote", Context.MODE_PRIVATE)

    /** This phone's key: made once, and only ever sent to a TV the viewer picked */
    private fun key(context: Context): String {
        val prefs = prefs(context)
        prefs.getString("key", null)?.let { return it }
        val bytes = ByteArray(32).also { random.nextBytes(it) }
        return bytes.joinToString("") { "%02x".format(it) }.also { prefs.edit().putString("key", it).apply() }
    }

    private fun phoneName(context: Context): String =
        (try { Settings.Global.getString(context.contentResolver, "device_name") } catch (_: Exception) { null })
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: "Phone"

    /** The TV used last time, offered first (it isn't connected to until it's picked) */
    fun last(context: Context): Tv? = try {
        prefs(context).getString("last", null)?.let { JSONObject(it) }?.let { Tv(it.getString("name"), it.getString("host"), it.optInt("port", PORT)) }
    } catch (_: Exception) {
        null
    }

    // ---------------------------------------------------------------------------------------------
    // Talking to a TV

    private class Reply(val code: Int, val json: JSONObject) {
        val ok get() = code == 200 && json.optBoolean("ok")
        val error get() = json.optString("error")
    }

    private fun call(tv: Tv, method: String, path: String, body: JSONObject? = null, key: String? = null, readMs: Int = 4000): Reply? = try {
        val conn = URL("http://${tv.host}:${tv.port}/streamflix/$path").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 2500
            conn.readTimeout = readMs
            conn.useCaches = false
            conn.setRequestProperty("X-StreamFlix", "1")
            if (key != null) conn.setRequestProperty("X-StreamFlix-Key", key)
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            Reply(code, try { JSONObject(text) } catch (_: Exception) { JSONObject() })
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        null
    }

    /** As [call], with this phone's key; a TV that no longer knows the phone asks its viewer again, once */
    private fun asked(app: Context, on: Tv, path: String, body: JSONObject, readMs: Int = 4000): Reply? {
        val first = call(on, "POST", path, body, key(app), readMs)
        if (first?.code != 401) return first
        val again = call(on, "POST", "pair", JSONObject().put("name", phoneName(app)).put("key", key(app)), readMs = 65_000)
        return if (again?.ok == true) call(on, "POST", path, body, key(app), readMs) else again
    }

    private fun explain(reply: Reply?, tv: Tv): String = when {
        reply == null -> "${tv.name} isn't answering. Is the app open on the TV?"
        reply.error == "background" -> "Open the app on ${tv.name} first: it has to be on the TV's screen."
        reply.error == "declined" -> "${tv.name} said no to this phone."
        reply.error == "unanswered" -> "Nobody answered on ${tv.name}. Pick Allow on the TV's screen."
        reply.error == "busy" -> "${tv.name} is asking about another phone. Try again in a moment."
        reply.error == "nothing playing" -> "Nothing is playing on ${tv.name}."
        else -> "${tv.name} couldn't do that."
    }

    // ---------------------------------------------------------------------------------------------
    // Finding TVs

    private fun ownAddresses(): List<String> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .map { it.hostAddress!! }
    } catch (_: Exception) {
        emptyList()
    }

    /** Whether the app answers at [host]: the TV's name, or null */
    private fun probe(host: String, port: Int = PORT): Tv? {
        try {
            Socket().use { it.connect(InetSocketAddress(host, port), CONNECT_MS) }
        } catch (_: Exception) {
            return null
        }
        val reply = call(Tv(host, host, port), "GET", "info", readMs = 1500) ?: return null
        if (!reply.ok || reply.json.optString("app") != "StreamFlix") return null
        return Tv(reply.json.optString("name").ifBlank { host }, host, port)
    }

    /** Looks over this phone's own network (the 254 addresses beside its own) for TVs with the app open */
    fun search(context: Context) {
        if (searching.value) return
        searching.value = true
        problem.value = null
        val remembered = last(context)
        scope.launch {
            val own = ownAddresses()
            val hosts = LinkedHashSet<String>()
            remembered?.let { hosts.add(it.host) }
            for (prefix in own.map { it.substringBeforeLast('.') }.distinct()) for (i in 1..254) hosts.add("$prefix.$i")
            hosts.removeAll(own.toSet())
            val pool = Executors.newFixedThreadPool(48)
            val tvs = java.util.Collections.synchronizedList(ArrayList<Tv>())
            for (host in hosts) pool.execute {
                probe(host, if (host == remembered?.host) remembered.port else PORT)?.let {
                    tvs.add(it)
                    found.value = sorted(tvs.toList(), remembered)
                }
            }
            pool.shutdown()
            pool.awaitTermination(15, TimeUnit.SECONDS)
            pool.shutdownNow()
            found.value = sorted(tvs.toList(), remembered)
            searching.value = false
        }
    }

    private fun sorted(tvs: List<Tv>, remembered: Tv?) =
        tvs.distinctBy { it.host }.sortedWith(compareBy({ it.host != remembered?.host }, { it.name.lowercase() }, { it.host }))

    // ---------------------------------------------------------------------------------------------
    // Choosing one

    /** [address]: what the viewer typed, "192.168.1.20" or with ":port" */
    fun connectTo(context: Context, address: String) {
        val text = address.trim().removePrefix("http://").trimEnd('/')
        val host = text.substringBefore(':')
        val port = text.substringAfter(':', "").toIntOrNull() ?: PORT
        if (host.isBlank() || !host.all { it.isLetterOrDigit() || it == '.' || it == '-' }) {
            problem.value = "That doesn't look like an address. It's four numbers with dots, like 192.168.1.20."
            return
        }
        connect(context, Tv(host, host, port))
    }

    /** The TV asks its viewer, the first time, whether to let this phone in: then Play goes there */
    fun connect(context: Context, to: Tv) {
        if (connecting.value != null) return
        val app = context.applicationContext
        problem.value = null
        connecting.value = to.name
        scope.launch {
            val info = call(to, "GET", "info", readMs = 2500)
            val named = if (info?.ok == true) to.copy(name = info.json.optString("name").ifBlank { to.name }) else to
            val reply = if (info?.ok == true) call(named, "POST", "pair", JSONObject().put("name", phoneName(app)).put("key", key(app)), readMs = 65_000) else info
            connecting.value = null
            if (reply?.ok != true) {
                problem.value = explain(reply, named)
                return@launch
            }
            prefs(app).edit().putString("last", JSONObject().put("name", named.name).put("host", named.host).put("port", named.port).toString()).apply()
            status.value = null
            lost.value = false
            tv.value = named
            watch(app, named)
        }
    }

    fun disconnect() {
        poll?.cancel()
        tv.value = null
        status.value = null
        options.value = null
        lost.value = false
        problem.value = null
        starting.value = 0L
    }

    /** Keeps [status] current while a TV is chosen: every second while it plays or the remote is open */
    private fun watch(app: Context, on: Tv) {
        poll?.cancel()
        poll = scope.launch {
            var failures = 0
            while (isActive && tv.value == on) {
                val reply = call(on, "GET", "status", key = key(app), readMs = 2500)
                if (tv.value != on) break
                if (reply?.ok == true) {
                    failures = 0
                    lost.value = false
                    status.value = Status.from(reply.json)
                    // (the player is up with the new film: its own buttons take over. A torrent can take a
                    // minute to start; the film already playing when Play was sent isn't it, unless it
                    // was the same one again)
                    val now = status.value
                    val since = System.currentTimeMillis() - starting.value
                    if (starting.value > 0 && ((now?.open == true && ("${now.title}|${now.subtitle}" != playingBefore || since > 25_000)) || since > 120_000)) starting.value = 0L
                } else if (++failures >= 4) {
                    lost.value = true
                    status.value = null
                }
                delay(if (sheet.value || status.value?.open == true || starting.value > 0) 1000 else 4000)
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // What the screens ask of the chosen TV

    /** Sends Stremio's link to a stream (#/player/…) to the TV; false when it didn't take it */
    suspend fun play(context: Context, link: String): Boolean = withContext(Dispatchers.IO) {
        val on = tv.value ?: return@withContext false
        val app = context.applicationContext
        if (!link.startsWith("#/player/")) {
            problem.value = "That one can't be sent to the TV."
            sheet.value = true
            return@withContext false
        }
        problem.value = null
        // The remote comes up at once, saying the film is starting, then with the player's buttons
        // (pause, subtitles…) as soon as the TV's player is up; or with why it didn't play
        playingBefore = status.value?.takeIf { it.open }?.let { "${it.title}|${it.subtitle}" }
        starting.value = System.currentTimeMillis()
        sheet.value = true
        val reply = asked(app, on, "play", JSONObject().put("link", link), readMs = 8000)
        if (reply?.ok != true) {
            starting.value = 0L
            problem.value = explain(reply, on)
        }
        reply?.ok == true
    }

    fun control(context: Context, cmd: String, ms: Long = 0) {
        val on = tv.value ?: return
        val app = context.applicationContext
        scope.launch {
            val reply = asked(app, on, "control", JSONObject().put("cmd", cmd).put("ms", ms))
            if (reply?.ok == true) status.value = Status.from(reply.json) else if (reply != null && reply.error != "nothing playing") problem.value = explain(reply, on)
        }
    }

    /** Asks the TV for its player's settings (the remote does, every few seconds while it shows them) */
    fun loadOptions(context: Context) {
        val on = tv.value ?: return
        val app = context.applicationContext
        scope.launch {
            val reply = call(on, "GET", "options", key = key(app))
            if (tv.value != on) return@launch
            options.value = if (reply?.ok == true) Options.from(reply.json) else null
        }
    }

    /** Changes one of the TV player's settings (audio, subtitles, subtitleDelay, speed, picture, zoom, sound, boost) */
    fun setOption(context: Context, name: String, value: String) {
        val on = tv.value ?: return
        val app = context.applicationContext
        scope.launch {
            val reply = asked(app, on, "option", JSONObject().put("name", name).put("value", value))
            if (reply?.ok == true) options.value = Options.from(reply.json)
            else if (reply != null && reply.error != "nothing playing") problem.value = explain(reply, on)
        }
    }

    fun press(context: Context, name: String) {
        val on = tv.value ?: return
        val app = context.applicationContext
        scope.launch {
            val reply = asked(app, on, "key", JSONObject().put("key", name))
            if (reply?.ok != true) problem.value = explain(reply, on)
        }
    }
}
