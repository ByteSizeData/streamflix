package com.notdxbi.dxbi.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONObject
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewRenderProcess
import androidx.webkit.WebViewRenderProcessClient

/**
 * StreamFlix TV: Stremio's web app with StreamFlix built in, steered with the remote. Streams play in
 * [PlayerActivity]; this screen stays alive underneath so Stremio keeps the watch progress.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var injectedAtStart = false
    private var lastBack = 0L
    // since when the page has left a Back press unanswered (0: it answered the last one)
    private var silentSince = 0L
    private var playbackListener: PlaybackBus.Listener? = null
    private var intro: Intro? = null
    private var leftAt = 0L
    // decided in onStart, done in onResume
    private var freshStart = false
    private var pendingLink: Uri? = null
    private var notAnswering = 0
    private var stoppedForHanging = false

    /**
     * A 4K TV would draw the page at 3840 px, four times the work and memory of 1080p, on hardware
     * that often has under 2 GB: the page is drawn at 1080p and scaled up. Videos aren't affected,
     * they play in their own window.
     */
    private fun webSize(): FrameLayout.LayoutParams {
        val full = resources.displayMetrics
        val phone = Bridge(this).isPhone()
        if (phone || full.widthPixels <= MAX_PAGE_WIDTH) {
            return FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        val scale = full.widthPixels / MAX_PAGE_WIDTH.toFloat()
        web.pivotX = 0f
        web.pivotY = 0f
        web.scaleX = scale
        web.scaleY = scale
        return FrameLayout.LayoutParams(MAX_PAGE_WIDTH, Math.round(full.heightPixels / scale))
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Diary.start(this)
        Diary.note(if (savedInstanceState != null) "main screen made again by Android (its page starts over)" else "main screen made")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        if (!webViewIsRecentEnough()) return

        // Debug builds can be inspected from a computer (chrome://inspect)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        val root = FrameLayout(this)
        root.addView(web, webSize())
        setContentView(root)
        // StreamFlix for phones: its own screens over the page (nothing in StreamFlix TV: see PhoneHooks.kt)
        Phone.attach(this, root, ::js)
        // Play on TV: a phone with the app can send this TV what to play (nothing on a phone)
        TvReceiver.attach(this)
        // Only when StreamFlix is opened, not when the screen is rebuilt (after a page crash, a turned phone).
        // (not in the phone app: the film is made for a TV screen)
        if (savedInstanceState == null && !BuildConfig.PHONE_UI) intro = Intro(this, root).also { it.start() }
        web.setBackgroundColor(getColor(R.color.background))
        web.isFocusable = true
        web.isFocusableInTouchMode = true

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            // A desktop browser's identity (Stremio's web app is made for one), plus StreamFlix TV's mark
            userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/${chromeVersion()} Safari/537.36 dxbi-tv/${BuildConfigVersion.name(this@MainActivity)}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.addJavascriptInterface(Bridge(this), "DxbiTV")
        val startScript = (assets.open("dxbi-tv.js").bufferedReader().use { it.readText() } + Phone.pageScript(this)).replace(Bridge.PLACEHOLDER, Bridge.TOKEN)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, startScript, setOf(STREMIO_ORIGIN))
            injectedAtStart = true
        }

        web.webChromeClient = object : WebChromeClient() {
            // A video that hasn't drawn its first frame shows WebView's grey play button: show nothing
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
        // A page that has stopped answering the remote is started again, rather than left frozen until
        // someone forces StreamFlix closed. Android reports it after about five seconds, then every few
        // seconds while it lasts: three in a row is a page that isn't coming back by itself.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_CLIENT_BASIC_USAGE)) {
            WebViewCompat.setWebViewRenderProcessClient(web, object : WebViewRenderProcessClient() {
                override fun onRenderProcessUnresponsive(view: WebView, renderer: WebViewRenderProcess?) {
                    notAnswering++
                    android.util.Log.w("dxbi", "the page isn't answering ($notAnswering)")
                    if (notAnswering < 3 || renderer == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE)) return
                    notAnswering = 0
                    stoppedForHanging = true
                    renderer.terminate()
                }

                override fun onRenderProcessResponsive(view: WebView, renderer: WebViewRenderProcess?) {
                    notAnswering = 0
                }
            })
        }

        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Older WebViews can't run a script before the page: run it as early as possible instead
                if (!injectedAtStart && url != null && url.startsWith(STREMIO_ORIGIN)) view.evaluateJavascript(startScript, null)
            }

            // The page's engine crashed, or Android took its memory back (TVs with 1.5–2 GB): without
            // this, Android closes StreamFlix straight back to the home screen
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Diary.note("the page's engine is gone (${if (detail.didCrash()) "it crashed" else "Android took its memory"})")
                Phone.pageGone()
                recoverFromCrash(detail.didCrash())
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // Embedded trailers stay in the page
                if (!request.isForMainFrame || url.host == "web.stremio.com") return false
                if (url.scheme == "stremio") {
                    openStremioLink(url)
                    return true
                }
                // Everything else leaves the app (sign-in pages, links in descriptions…) if something can open it
                openExternal(url.toString())
                return true
            }
        }

        playbackListener = object : PlaybackBus.Listener {
            override fun onProgress(positionMs: Long, durationMs: Long, paused: Boolean, buffering: Boolean) {
                js("window.__dxbiTv && window.__dxbiTv.onProgress($positionMs, $durationMs, $paused, $buffering)")
            }

            // The page takes the details from PlaybackBus (a restarted page picks them up as it loads)
            override fun onPartyTick(positionMs: Long, durationMs: Long, paused: Boolean, buffering: Boolean, rate: Float) {
                js("window.__dxbiTv && window.__dxbiTv.onPartyTick($positionMs, $durationMs, $paused, $buffering, $rate)")
            }

            override fun onPartyLeave() {
                js("window.__dxbi && window.__dxbi.partyLeave()")
            }

            override fun onClosed() {
                js("window.__dxbiTv && window.__dxbiTv.playerClosed && window.__dxbiTv.playerClosed()")
            }
        }

        PlaybackBus.listener = playbackListener

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })

        // (the link StreamFlix was opened with, once: a screen rebuilt after a page crash has the same intent)
        val link = intent?.data
        whenOnline { if (savedInstanceState == null && link?.scheme == "stremio") openStremioLink(link) else web.loadUrl(STREMIO_URL) }
        web.requestFocus()

        Updates.checkPlugin(this)
        Updates.checkApp(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // The "update your web engine" message is showing instead of the page
        if (!::web.isInitialized) return
        intent.data?.takeIf { it.scheme == "stremio" }?.let {
            // Back from the background a fresh start may be due, which onStart decides before or after
            // this depending on the Android version: onResume opens it then, here or in the fresh StreamFlix
            if (freshStart || !lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) pendingLink = it
            else openStremioLink(it)
        }
    }

    /**
     * Back from being stopped. A stream handed over just as StreamFlix went to the background (Home pressed
     * while it was starting) may never have opened: Android doesn't start a screen for an app in the
     * background, and nothing would ever say the player closed. StreamFlix would go on thinking a stream
     * plays (no fresh start, no Stremio update, a restarted page sent back to its player screen): it's
     * closed here instead, and the page goes back to the list of streams.
     * (Not in onStart: a screen rebuilt after a page crash starts too, maybe before the player is up.)
     * Looked at a moment later, and only for that same hand-off: coming straight back to StreamFlix just as
     * the stream was asked for, Android may let the player's start through after all, and closing the
     * hand-off before the player was up left it playing with nothing recording where it got to.
     */
    override fun onRestart() {
        super.onRestart()
        val handed = PlaybackBus.activePlayback ?: return
        if (PlaybackBus.player != null) return
        Handler(Looper.getMainLooper()).postDelayed({
            if (PlaybackBus.activePlayback === handed && PlaybackBus.player == null) PlaybackBus.closed(0, 0, false, null)
        }, ORPHAN_CHECK_MS)
    }

    /**
     * Back on screen. After a long time away (the TV asleep, an evening in another app) the page and
     * its engine are stale: StreamFlix starts afresh instead, as it would from the home screen (see
     * [RestartActivity]). Coming back from the player is not being away: the page was keeping the
     * watch progress all along. A long time away that ends in the player (the TV slept with it open),
     * or with how it closed still to give to the page, can't start afresh without losing that: the page
     * is marked stale instead (PlaybackBus.pageStale), kept for the rest of that sitting and replaced
     * the next time StreamFlix is left and come back to, however briefly.
     * Decided here, done in onResume: a link that opened StreamFlix has arrived by then (see onNewIntent).
     */
    override fun onStart() {
        super.onStart()
        if (!::web.isInitialized) return
        val wasLeft = leftAt != 0L
        val away = if (wasLeft) SystemClock.elapsedRealtime() - leftAt else 0L
        leftAt = 0
        if (away > FRESH_AFTER_MS || (wasLeft && PlaybackBus.pageStale)) {
            if (PlaybackBus.activePlayback == null && !PlaybackBus.closePending) {
                android.util.Log.i("dxbi", "back after ${away / 60_000} minutes away (page stale: ${PlaybackBus.pageStale}): starting afresh")
                freshStart = true
                return
            }
            PlaybackBus.pageStale = true
        }
        js("window.__dxbiTv && window.__dxbiTv.shown && window.__dxbiTv.shown()")
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (!::web.isInitialized) return
        // StreamFlix was left with the player open, and is back with the player gone (the home screen's start
        // closed it, or it closed while StreamFlix was away): was that long enough for the page to go stale?
        PlaybackBus.backOnScreen()
        val link = pendingLink
        pendingLink = null
        if (freshStart) {
            freshStart = false
            try {
                startActivity(Intent(this, RestartActivity::class.java)
                    .putExtra(RestartActivity.EXTRA_PID, android.os.Process.myPid())
                    .setData(link)
                    .addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION))
                PlaybackBus.pageStale = false
                finish()
                return
            } catch (_: Exception) {
                // carry on as it is
                js("window.__dxbiTv && window.__dxbiTv.shown && window.__dxbiTv.shown()")
            }
        }
        link?.let { openStremioLink(it) }
        web.requestFocus()
        Updates.onResume(this)
    }

    /**
     * StreamFlix has left the screen (Home, another app, the TV going to sleep): a Stremio update waiting in
     * the page is taken now, so it never has to ask (webUpdate in dxbi-tv.js). Not while a stream plays,
     * since the page is keeping its watch progress, and not on the way out.
     */
    override fun onStop() {
        super.onStop()
        if (::web.isInitialized && !isFinishing && PlaybackBus.activePlayback == null) {
            leftAt = SystemClock.elapsedRealtime()
            js("window.__dxbiTv && window.__dxbiTv.hidden && window.__dxbiTv.hidden()")
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Any key skips the intro (and isn't passed on to the page underneath)
        intro?.takeIf { it.showing }?.let {
            if (event.action == KeyEvent.ACTION_UP) it.skip()
            return true
        }
        // Play/pause keys on the Home screen do nothing useful in the page: keep them from scrolling it
        if (event.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) return true
        return super.dispatchKeyEvent(event)
    }

    /**
     * The page is loaded once the TV is on its network. A TV that has just woken up, or just been
     * switched on, takes a few seconds to get there, and a page loaded before then comes up from its
     * own cache with every row failing to load, and stays that way. Never a long wait: without a
     * network after a few seconds the page is loaded anyway, and says what it can't reach.
     */
    private fun whenOnline(load: () -> Unit) {
        val network = getSystemService(CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return load()
        val online = try {
            network.getNetworkCapabilities(network.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        } catch (_: Exception) {
            true
        }
        if (online) return load()
        var loaded = false
        var watch: ConnectivityManager.NetworkCallback? = null
        val go = Runnable {
            if (loaded) return@Runnable
            loaded = true
            watch?.let { try { network.unregisterNetworkCallback(it) } catch (_: Exception) { /* already gone */ } }
            if (!isFinishing && ::web.isInitialized) load()
        }
        watch = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(found: Network) {
                web.post(go)
            }
        }
        try {
            network.registerDefaultNetworkCallback(watch)
        } catch (_: Exception) {
            return load()
        }
        web.postDelayed(go, ONLINE_WAIT_MS)
    }

    /**
     * The page decides first (closing a card or menu, going back a screen); on Home, Back twice leaves.
     * A page too busy to answer must not swallow the press: after a moment it says how to leave, and
     * once it has answered nothing for a while (HUNG_MS, longer than a busy page takes) a press it
     * leaves unanswered counts as one of the two that leave, so there is always a way out. A busy page
     * that answers late has still gone back a screen: that press doesn't count towards leaving.
     */
    private fun goBack() {
        if (silentSince == 0L) silentSince = SystemClock.elapsedRealtime()
        var answered = false
        val leaveOrSay = { mayLeave: Boolean ->
            val now = System.currentTimeMillis()
            if (mayLeave && now - lastBack < 2500) finish()
            else {
                lastBack = now
                Toast.makeText(this, "Press Back again to leave StreamFlix", Toast.LENGTH_SHORT).show()
            }
        }
        val giveUp = Runnable {
            if (!answered) {
                answered = true
                // (0: the page has answered since this press, so it isn't hanging)
                leaveOrSay(silentSince != 0L && SystemClock.elapsedRealtime() - silentSince >= HUNG_MS)
            }
        }
        web.postDelayed(giveUp, BACK_ANSWER_MS)
        web.evaluateJavascript("(window.__dxbiTv && window.__dxbiTv.back()) ? 1 : 0") { handled ->
            silentSince = 0L
            if (answered) {
                if (handled == "1") lastBack = 0
                return@evaluateJavascript
            }
            answered = true
            web.removeCallbacks(giveUp)
            if (handled != "1") leaveOrSay(true)
        }
    }

    /**
     * Start the page again in a lighter way: the intro film is the heaviest moment of a start, so it's
     * switched off (it can be switched back on in StreamFlix's settings). A second crash soon after says so.
     * A page stopped for not answering (see the watchdog in onCreate) wasn't short of memory: its
     * intro stays as it is.
     */
    private fun recoverFromCrash(crashed: Boolean) {
        val state = getSharedPreferences("app", MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val again = now - state.getLong("lastPageCrash", 0) < 3 * 60_000
        state.edit().putLong("lastPageCrash", now).apply()
        val hung = stoppedForHanging
        stoppedForHanging = false
        android.util.Log.w("dxbi", "page engine gone (crashed=$crashed, hung=$hung, again=$again)")

        if (!hung) {
            val settings = getSharedPreferences("plugin-settings", MODE_PRIVATE)
            val dxbi = try { JSONObject(settings.getString("dxbi", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
            dxbi.put("splash", false)
            settings.edit().putString("dxbi", dxbi.toString()).commit()
        }

        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        if (again) {
            setContentView(View(this))
            AlertDialog.Builder(this)
                .setTitle("StreamFlix keeps stopping")
                .setMessage("StreamFlix's screen stopped twice in a row on this TV, usually because the TV is short of memory. Closing other apps (or restarting the TV) helps. Try again?")
                .setCancelable(false)
                .setPositiveButton("Try again") { _, _ -> recreate() }
                .setNegativeButton("Close") { _, _ -> finish() }
                .show()
        } else {
            recreate()
        }
    }

    fun play(json: String) {
        PlaybackBus.started(json)
        // (the phone app can send it to another app, a Chromecast or a download instead)
        if (Phone.play(this, json)) return
        startActivity(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_STREAM, json))
    }

    fun openExternal(url: String) {
        val uri = Uri.parse(url)
        // YouTube (trailers): the TV's YouTube app, asked for by name. Google TV hands a plain YouTube
        // link to a "no browser" stub instead of the app
        if (uri.host?.endsWith("youtube.com") == true || uri.host == "youtu.be") {
            for (pkg in listOf("com.google.android.youtube.tv", "com.amazon.firetv.youtube", "com.google.android.youtube")) {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg))
                    return
                } catch (_: Exception) { /* not on this TV: the next one */ }
            }
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            Toast.makeText(this, "No app on this TV can open that link", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openStremioLink(uri: Uri) {
        // stremio://host/path/manifest.json → install the addon through Stremio's Addons screen
        val manifest = uri.toString().replaceFirst("stremio://", "https://")
        web.loadUrl("$STREMIO_URL#/addons?addon=" + Uri.encode(manifest))
    }

    /** Whether the page has a screen to show yet (what the intro waits for before fading out) */
    fun pageReady(answer: (Boolean) -> Unit) {
        if (!::web.isInitialized) return answer(true)
        web.evaluateJavascript("!!document.querySelector('$PAGE_READY')") { answer(it == "true") }
    }

    fun js(code: String) {
        if (::web.isInitialized) web.post { web.evaluateJavascript(code, null) }
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun chromeVersion(): String =
        WebViewCompat.getCurrentWebViewPackage(this)?.versionName?.substringBefore(" ") ?: "120.0.0.0"

    /**
     * Stremio's web app needs a modern WebView; old TVs that never updated it get told how. Only a
     * version we can actually read counts as too old (Fire TV's own WebView names itself differently).
     */
    private fun webViewIsRecentEnough(): Boolean {
        val name = WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: return true
        val major = Regex("""^(\d+)\.""").find(name)?.groupValues?.get(1)?.toIntOrNull() ?: return true
        if (major >= MIN_WEBVIEW) return true
        val fireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true)
        setContentView(View(this))
        val builder = AlertDialog.Builder(this)
            .setTitle(if (fireTv) "Update your Fire TV" else "Update Android System WebView")
            .setCancelable(false)
        if (fireTv) {
            builder.setMessage("StreamFlix needs a newer web engine than this Fire TV has ($major). Update it under Settings → My Fire TV → About → Check for Updates, then open StreamFlix again.")
                .setPositiveButton("Close") { _, _ -> finish() }
        } else {
            builder.setMessage("StreamFlix needs Android System WebView $MIN_WEBVIEW or newer (this TV has $major). Update it from the Play Store (search \"Android System WebView\"), then open StreamFlix again.")
                .setPositiveButton("Open Play Store") { _, _ ->
                    openExternal("market://details?id=com.google.android.webview")
                    finish()
                }
                .setNegativeButton("Close") { _, _ -> finish() }
        }
        builder.show()
        return false
    }

    // (Taken here, so that Android doesn't build the screen, and with it the page, again: see the manifest)
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        Diary.note("main screen: the screen changed (hdr ${newConfig.isScreenHdr}, wide colour ${newConfig.isScreenWideColorGamut}, ${newConfig.screenWidthDp}x${newConfig.screenHeightDp} dp)")
    }

    private var lastTrim = -1
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level != lastTrim) Diary.note("Android asks for memory back (level $level${if (PlaybackBus.player != null) ", the player is open" else ""})")
        lastTrim = level
    }

    override fun onDestroy() {
        Diary.note("main screen destroyed (${if (isFinishing) "closing" else if (isChangingConfigurations) "for a screen change" else "by Android, to be made again"}${if (PlaybackBus.player != null) ", the player is open" else ""})")
        // recreate() can bring up the new screen before this one is gone: leave its listener alone
        if (PlaybackBus.listener === playbackListener) PlaybackBus.listener = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object {
        const val STREMIO_ORIGIN = "https://web.stremio.com"
        const val STREMIO_URL = "https://web.stremio.com/"
        const val MIN_WEBVIEW = 100
        // Away this long, StreamFlix comes back as a fresh start (an episode, a meal: shorter than that isn't away)
        const val FRESH_AFTER_MS = 30 * 60_000L
        private const val BACK_ANSWER_MS = 1500L
        private const val ORPHAN_CHECK_MS = 2000L
        // a page that has answered no Back press for this long is hanging, not busy (and may be left)
        private const val HUNG_MS = 5000L
        private const val ONLINE_WAIT_MS = 8000L
        private const val MAX_PAGE_WIDTH = 1920
        // SPLASH_READY in dxbi.plugin.js (Home's rows, a details page, Settings…)
        private const val PAGE_READY = """[class*="meta-item-container"], [class*="metadetails-container"], [class*="player-container"], [class*="settings-content"], [class*="addons-content"]"""
    }
}
