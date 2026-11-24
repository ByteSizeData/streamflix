package com.notdxbi.dxbi.tv

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.app.Instrumentation
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.lang.ref.WeakReference
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Play on TV: a phone or tablet running the app (TvRemote.kt in src/mobile, TvRemote.swift on an
 * iPad) finds this TV on the home network, sends it a film or episode, and works the player.
 *
 * The TV listens on [PORT] while the app is open, with plain HTTP and JSON:
 *
 *   GET  /streamflix/info      who this is (no key needed)
 *   POST /streamflix/pair      {name, key}: the TV asks, once for each phone, whether to let it in
 *   POST /streamflix/play      {link}: Stremio's own link to a stream (#/player/…), opened as if it
 *                              had been picked with the TV's remote, so the TV keeps the progress,
 *                              the subtitles and the next episode itself
 *   POST /streamflix/control   {cmd: toggle | play | pause | seek | seekBy | close, ms}
 *   POST /streamflix/key       {key: up | down | left | right | ok | back | volup | voldown}
 *   GET  /streamflix/status    what's playing and where it is
 *
 * Every request carries the header "X-StreamFlix: 1" (a web page in a browser can't send it to
 * another machine), and all but info and pair carry the phone's key in "X-StreamFlix-Key". Only
 * phones allowed on this TV's own screen are let in; what's kept of a key is its SHA-256.
 */
object TvReceiver {
    const val PORT = 47821
    private const val TAG = "dxbi"
    private const val HEAD_MAX = 8 * 1024
    private const val BODY_MAX = 256 * 1024
    private const val PAIR_WAIT_S = 60L

    private val ui = Handler(Looper.getMainLooper())
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "tv-receiver").apply { isDaemon = true } }
    @Volatile private var server: ServerSocket? = null
    @Volatile private var app: Application? = null
    @Volatile private var main = WeakReference<MainActivity>(null)
    /** The app's screen that is showing right now (none: the app is behind another, or the TV sleeps) */
    @Volatile private var showing = WeakReference<Activity>(null)
    @Volatile private var asking = false
    @Volatile private var refusedAt = -60_000L

    /**
     * The TV app, wherever it's installed, or the phone app on a TV or TV box (where it is the TV
     * app): a phone or tablet with the phone app sends, and doesn't listen
     */
    fun isTv(context: Context): Boolean {
        if (!BuildConfig.PHONE_UI) return true
        val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        return mode.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    /** Called as the main screen is made: starts listening (once for the app's whole run) */
    fun attach(activity: MainActivity) {
        if (!isTv(activity)) return
        main = WeakReference(activity)
        if (app == null) {
            val application = activity.application
            app = application
            application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
                override fun onActivityResumed(a: Activity) { showing = WeakReference(a) }
                override fun onActivityPaused(a: Activity) { if (showing.get() === a) showing = WeakReference(null) }
                override fun onActivityCreated(a: Activity, state: Bundle?) = Unit
                override fun onActivityStarted(a: Activity) = Unit
                override fun onActivityStopped(a: Activity) = Unit
                override fun onActivitySaveInstanceState(a: Activity, out: Bundle) = Unit
                override fun onActivityDestroyed(a: Activity) = Unit
            })
        }
        if (server == null) listen()
    }

    private fun listen() {
        val socket = try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(PORT))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Play on TV: can't listen on $PORT: ${e.message}")
            return
        }
        server = socket
        Thread({
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                pool.execute { serve(client) }
            }
            server = null
        }, "tv-receiver-accept").apply { isDaemon = true }.start()
    }

    // ---------------------------------------------------------------------------------------------
    // HTTP, as little of it as this needs

    private class Answer(val code: Int, val body: JSONObject)

    private fun ok(body: JSONObject = JSONObject()) = Answer(200, body.put("ok", true))
    private fun no(code: Int, error: String) = Answer(code, JSONObject().put("ok", false).put("error", error))

    private fun serve(client: Socket) {
        try {
            client.soTimeout = 10_000
            val input = client.getInputStream()
            val head = readHead(input) ?: return
            val lines = head.split("\r\n")
            val request = lines.first().split(" ")
            if (request.size < 2) return
            val headers = HashMap<String, String>()
            for (line in lines.drop(1)) {
                val at = line.indexOf(':')
                if (at > 0) headers[line.substring(0, at).trim().lowercase()] = line.substring(at + 1).trim()
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            val answer = if (length < 0 || length > BODY_MAX) no(413, "too long") else {
                val body = ByteArray(length)
                var got = 0
                while (got < length) {
                    val n = input.read(body, got, length - got)
                    if (n < 0) break
                    got += n
                }
                val json = try { if (got == 0) JSONObject() else JSONObject(String(body, 0, got, Charsets.UTF_8)) } catch (_: Exception) { null }
                if (json == null) no(400, "not json") else try {
                    route(request[0], request[1].substringBefore('?'), headers, json)
                } catch (e: Exception) {
                    Log.w(TAG, "Play on TV: ${request[1]} failed: $e")
                    no(500, "failed")
                }
            }
            val bytes = answer.body.toString().toByteArray(Charsets.UTF_8)
            val text = when (answer.code) { 200 -> "OK"; 401 -> "Unauthorized"; 403 -> "Forbidden"; 404 -> "Not Found"; 409 -> "Conflict"; else -> "Error" }
            client.getOutputStream().apply {
                write("HTTP/1.1 ${answer.code} $text\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                write(bytes)
                flush()
            }
        } catch (_: Exception) {
            // a phone that went away mid-request
        } finally {
            try { client.close() } catch (_: Exception) { /* closed already */ }
        }
    }

    private fun readHead(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        var matched = 0
        while (out.size() < HEAD_MAX) {
            val b = input.read()
            if (b < 0) return null
            out.write(b)
            matched = when {
                (matched == 0 || matched == 2) && b == '\r'.code -> matched + 1
                (matched == 1 || matched == 3) && b == '\n'.code -> matched + 1
                b == '\r'.code -> 1
                else -> 0
            }
            if (matched == 4) return String(out.toByteArray(), 0, out.size() - 4, Charsets.ISO_8859_1)
        }
        return null
    }

    private val address = Regex("\\d{1,3}(\\.\\d{1,3}){3}")

    /** The name a request was sent to: an address on the network, or a name that only means something on it */
    private fun localName(host: String?): Boolean {
        val name = host?.substringBefore(':')?.lowercase() ?: return true
        return address.matches(name) || !name.contains('.') || name.endsWith(".local")
    }

    private fun route(method: String, path: String, headers: Map<String, String>, body: JSONObject): Answer {
        if (!path.startsWith("/streamflix/")) return no(404, "not here")
        // (a page in a browser can't add this header to a request to another machine: only the apps do.
        // And the apps ask for the TV by its number on the network, never by a web site's name, which
        // is how a page would get round that: by having its own name point here)
        if (headers["x-streamflix"] != "1" || !localName(headers["host"])) return no(403, "not the app")
        val context = app ?: return no(409, "closed")
        if (method == "GET" && path == "/streamflix/info") {
            return ok(JSONObject().put("app", "StreamFlix").put("v", 1).put("name", tvName(context)).put("version", BuildConfigVersion.name(context)))
        }
        if (method == "POST" && path == "/streamflix/pair") return pair(context, body)
        if (!allowed(context, headers["x-streamflix-key"] ?: "")) return no(401, "pair")
        return when {
            method == "GET" && path == "/streamflix/status" -> ok(status())
            method == "POST" && path == "/streamflix/play" -> play(context, body)
            method == "POST" && path == "/streamflix/control" -> control(body)
            method == "POST" && path == "/streamflix/key" -> key(context, body.optString("key"))
            else -> no(404, "not here")
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Which phones are let in

    private fun prefs(context: Context) = context.getSharedPreferences("tv-receiver", Context.MODE_PRIVATE)

    private fun digest(key: String): String =
        MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun validKey(key: String) = key.length in 32..128 && key.all { it in '0'..'9' || it in 'a'..'f' }

    private fun allowed(context: Context, key: String): Boolean =
        validKey(key) && prefs(context).contains("phone." + digest(key))

    private fun tvName(context: Context): String =
        (try { Settings.Global.getString(context.contentResolver, "device_name") } catch (_: Exception) { null })
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: "TV"

    private fun pair(context: Context, body: JSONObject): Answer {
        val key = body.optString("key")
        if (!validKey(key)) return no(400, "key")
        if (allowed(context, key)) return ok()
        val name = body.optString("name").filter { !it.isISOControl() }.trim().take(40).ifEmpty { "A phone" }
        // (one question at a time, and none for half a minute after a no)
        if (asking || android.os.SystemClock.elapsedRealtime() - refusedAt < 30_000) return no(409, "busy")
        val screen = awake(context) ?: return no(409, "background")
        asking = true
        try {
            val done = CountDownLatch(1)
            var yes = false
            var dialog: AlertDialog? = null
            ui.post {
                if (screen.isFinishing || screen.isDestroyed) { done.countDown(); return@post }
                dialog = AlertDialog.Builder(screen, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle("Let “$name” play on this TV?")
                    .setMessage("A phone or tablet on your network with this app wants to send films and episodes to this TV and work the player.\n\nYou're asked once for each phone.")
                    .setPositiveButton("Allow") { _, _ -> yes = true }
                    .setNegativeButton("Don't allow") { _, _ -> }
                    .setOnDismissListener { done.countDown() }
                    .show()
            }
            val answered = done.await(PAIR_WAIT_S, TimeUnit.SECONDS)
            if (!answered) ui.post { try { dialog?.dismiss() } catch (_: Exception) { /* its screen is gone */ } }
            if (!yes) {
                if (answered) refusedAt = android.os.SystemClock.elapsedRealtime()
                return no(403, if (answered) "declined" else "unanswered")
            }
            prefs(context).edit().putString("phone." + digest(key), name).apply()
            return ok()
        } finally {
            asking = false
        }
    }

    // ---------------------------------------------------------------------------------------------
    // What a phone asks for

    /**
     * The app's screen that is showing. When the TV sleeps with the app on top, it's woken first
     * (the TV set follows over HDMI); behind another app there's none, and nothing can be started.
     * Only a TV that lets a sleeping app hear the network gets this far: a SHIELD doesn't (asleep,
     * nothing reaches this port), so there the TV is woken with its remote.
     */
    private fun awake(context: Context): Activity? {
        showing.get()?.let { return it }
        try {
            val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!power.isInteractive) {
                @Suppress("DEPRECATION")
                power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "streamflix:play-on-tv").acquire(3000)
                for (i in 0 until 40) {
                    Thread.sleep(100)
                    showing.get()?.let { return it }
                }
            }
        } catch (_: Exception) {
            // no way to wake it: as if it were behind another app
        }
        return null
    }

    private fun <T> onUi(wait: Long = 3000, what: () -> T): T? {
        val done = CountDownLatch(1)
        var result: T? = null
        ui.post {
            try { result = what() } catch (e: Exception) { Log.w(TAG, "Play on TV: $e") }
            done.countDown()
        }
        done.await(wait, TimeUnit.MILLISECONDS)
        return result
    }

    private fun status(): JSONObject =
        onUi { PlaybackBus.player?.status() }
            ?: JSONObject().put("open", false).put("screen", if (showing.get() != null) "home" else "background")

    private fun play(context: Context, body: JSONObject): Answer {
        val link = body.optString("link")
        // Stremio's link to a stream and nothing else: it goes into the page's address
        if (!link.startsWith("#/player/") || link.length > BODY_MAX || link.any { it.isWhitespace() || it == '"' || it == '\'' || it == '\\' || it == '<' }) return no(400, "link")
        awake(context) ?: return no(409, "background")
        val screen = main.get()?.takeIf { !it.isFinishing && !it.isDestroyed } ?: return no(409, "background")
        val wasPlaying = onUi {
            val open = PlaybackBus.player
            open?.control("""{"cmd":"close"}""")
            open != null
        } == true
        // (a film that was playing closes first, and its page goes back to where it was before this one opens)
        ui.postDelayed({
            if (!screen.isFinishing && !screen.isDestroyed) screen.js("location.hash = ${JSONObject.quote(link)}")
        }, if (wasPlaying) 1500 else 0)
        return ok()
    }

    private fun control(body: JSONObject): Answer {
        val cmd = body.optString("cmd")
        if (cmd !in setOf("toggle", "play", "pause", "seek", "seekBy", "close")) return no(400, "cmd")
        val json = JSONObject().put("cmd", cmd).put("ms", body.optLong("ms")).toString()
        val state = onUi {
            val open = PlaybackBus.player ?: return@onUi null
            open.control(json)
            if (cmd == "close") JSONObject().put("open", false).put("screen", "home") else open.status()
        } ?: return no(409, "nothing playing")
        return ok(state)
    }

    private val keys = mapOf(
        "up" to KeyEvent.KEYCODE_DPAD_UP, "down" to KeyEvent.KEYCODE_DPAD_DOWN, "left" to KeyEvent.KEYCODE_DPAD_LEFT,
        "right" to KeyEvent.KEYCODE_DPAD_RIGHT, "ok" to KeyEvent.KEYCODE_DPAD_CENTER, "back" to KeyEvent.KEYCODE_BACK,
        "volup" to KeyEvent.KEYCODE_VOLUME_UP, "voldown" to KeyEvent.KEYCODE_VOLUME_DOWN,
    )

    /** A press of the remote, for the app's own screens only (Android lets an app press keys in itself) */
    private fun key(context: Context, name: String): Answer {
        val code = keys[name] ?: return no(400, "key")
        awake(context) ?: return no(409, "background")
        return try {
            Instrumentation().sendKeyDownUpSync(code)
            ok()
        } catch (_: Exception) {
            no(409, "background")
        }
    }
}
