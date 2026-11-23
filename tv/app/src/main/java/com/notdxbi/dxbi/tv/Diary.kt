package com.notdxbi.dxbi.tv

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A short diary of what happened to the app and its player, kept on the device: the app starting,
 * its screens being made and destroyed (and by whom), the player opening, skipping, failing and
 * closing, Android asking for memory back, and any crash with its trace. Android's own log is gone
 * within hours, and "it crashed last night" then has nothing to go by.
 *
 * It holds no titles and no addresses beyond a host name. Read it with
 * `adb shell cat /sdcard/Android/data/<package>/files/diary.txt`.
 */
object Diary {
    private const val MAX_BYTES = 128 * 1024
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US)
    @Volatile private var file: File? = null

    fun start(context: Context) {
        if (file != null) return
        synchronized(this) {
            if (file != null) return
            val app = context.applicationContext
            file = File(app.getExternalFilesDir(null) ?: app.filesDir, "diary.txt")
            val before = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, error ->
                note("CRASH on ${thread.name}: ${Log.getStackTraceString(error).take(8000)}")
                before?.uncaughtException(thread, error)
            }
        }
        note("app started, version ${BuildConfigVersion.name(context)}, memory allowed ${Runtime.getRuntime().maxMemory() / 1048576} MB")
    }

    /** How much of its allowed memory the app is using, for a note */
    fun memory(): String {
        val r = Runtime.getRuntime()
        return "${(r.totalMemory() - r.freeMemory()) / 1048576} of ${r.maxMemory() / 1048576} MB"
    }

    /** One line, with the time. Addresses are cut down to their host */
    fun note(text: String) {
        val f = file ?: return
        val line = text.replace(Regex("""(https?://[^/\s]+)/\S*"""), "$1/…")
        synchronized(this) {
            try {
                if (f.length() > MAX_BYTES) f.writeText(f.readText().takeLast(MAX_BYTES / 2).substringAfter('\n'))
                f.appendText("${stamp.format(Date())} $line\n")
            } catch (_: Exception) {
                // (no room, or the folder is gone: the diary is not worth a crash of its own)
            }
        }
    }
}
