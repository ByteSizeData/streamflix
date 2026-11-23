package com.notdxbi.dxbi.tv

import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import org.json.JSONObject

/**
 * The player tells the main screen where it is, so Stremio keeps the watch progress.
 *
 * The stream being played and how it closed are kept here rather than in the page or the main
 * screen: Android can restart the page (and MainActivity recreates itself) while a video plays,
 * and the restarted page picks them up from here.
 */
object PlaybackBus {
    interface Listener {
        /** paused: the viewer's pause (or the end); buffering: playing, but waiting for data */
        fun onProgress(positionMs: Long, durationMs: Long, paused: Boolean, buffering: Boolean)
        fun onClosed()
        fun onPartyTick(positionMs: Long, durationMs: Long, paused: Boolean, buffering: Boolean, rate: Float)
        fun onPartyLeave()
    }

    /** The open player, for what the page's watch party asks of it */
    @Volatile
    var player: PlayerActivity? = null

    @Volatile
    var listener: Listener? = null

    /** What the page handed to the player (its route and video included), while it plays */
    @Volatile
    var activePlayback: String? = null
        private set

    @Volatile
    private var pendingClose: String? = null

    /** How the player closed is still waiting for the page to take it */
    val closePending: Boolean get() = pendingClose != null

    /**
     * When dx.bi was left with the player open (Home, the TV asleep), until it's back on screen: the
     * page under the player sat there all that time, unseen
     */
    @Volatile
    var playerLeftAt = 0L

    /**
     * The page is stale (it sat through a long time away, see MainActivity.onStart) and dx.bi starts
     * afresh the next time it's left and come back to. False in a new process, which has a new page.
     */
    @Volatile
    var pageStale = false

    /** dx.bi is back on screen after being left with the player open: away long enough to go stale? */
    fun backOnScreen() {
        val left = playerLeftAt
        playerLeftAt = 0
        if (left != 0L && SystemClock.elapsedRealtime() - left > MainActivity.FRESH_AFTER_MS) pageStale = true
    }

    fun started(json: String) {
        activePlayback = json
        pendingClose = null
    }

    fun closed(positionMs: Long, durationMs: Long, ended: Boolean, error: String?, next: Boolean = false) {
        val stream = try { JSONObject(activePlayback ?: "{}") } catch (_: Exception) { JSONObject() }
        pendingClose = JSONObject()
            .put("timeMs", positionMs)
            .put("durationMs", durationMs)
            .put("ended", ended)
            .put("next", next)
            .put("error", error ?: JSONObject.NULL)
            .put("hash", stream.optString("hash"))
            .put("videoId", stream.optString("videoId"))
            .toString()
        activePlayback = null
        listener?.onClosed()
    }

    @Synchronized
    fun takePendingClose(): String? = pendingClose.also { pendingClose = null }
}

object BuildConfigVersion {
    fun name(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
    } catch (_: PackageManager.NameNotFoundException) {
        "0"
    }
}
