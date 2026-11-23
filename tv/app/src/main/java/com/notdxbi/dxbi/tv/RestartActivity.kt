package com.notdxbi.dxbi.tv

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import java.io.File

/**
 * Starts dx.bi afresh, in a new process.
 *
 * A TV app is rarely closed: it comes back from the home screen, or from the TV's sleep, for days. A
 * page and a web engine that have sat that long come back with connections that died hours ago and
 * everything they ever loaded still in memory, and that looks like dx.bi frozen (nothing loads, the
 * remote answers late) until someone thinks to force it closed. So after a long time away
 * [MainActivity] hands over to this screen instead of carrying on. It runs in a process of its own
 * (see the manifest), so it outlives the dx.bi it replaces.
 */
class RestartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val old = intent.getIntExtra(EXTRA_PID, -1)
        val dying = old > 0 && old != Process.myPid()
        if (dying) Process.killProcess(old)
        val link = intent.data
        val handler = Handler(Looper.getMainLooper())
        val start = Runnable {
            try {
                startActivity(Intent(this, MainActivity::class.java)
                    .setData(link)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
            } catch (_: Exception) { /* opened again from the home screen instead */ }
            finish()
            Runtime.getRuntime().exit(0)
        }
        // The new screen isn't asked for until the old process is gone (a slow TV takes a while to tear
        // down one that ran for days), and then a moment for Android to notice: a screen asked for sooner
        // can be handed to the dying process. Never more than two seconds.
        val since = SystemClock.elapsedRealtime()
        handler.post(object : Runnable {
            override fun run() {
                if (dying && File("/proc/$old").exists() && SystemClock.elapsedRealtime() - since < 2000) handler.postDelayed(this, 50)
                else handler.postDelayed(start, 100)
            }
        })
    }

    companion object {
        const val EXTRA_PID = "pid"
    }
}
