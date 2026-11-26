package com.notdxbi.dxbi.tv

import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.util.Consumer
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.text.CuesWithTiming
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import androidx.media3.extractor.text.SubtitleParser

/**
 * Subtitles inside a file are read as the file loads, every track of them, shown or not. An anime's
 * release nearly always carries ASS tracks ("Signs & Songs", "Full Subtitles"), and a line in one of
 * them that Media3's ASS reader can't make sense of threw while the file loaded: the whole video
 * stopped a few seconds in ("Unexpected IllegalStateException"), and again at every try, on every
 * release of the episode. Media3 can't leave out one track of a file it is reading: the line is
 * skipped instead, and a track whose heading can't be read shows nothing. The video, its sound and
 * the other subtitle tracks play on either way.
 */
@OptIn(UnstableApi::class)
class SafeSubtitles(private val inner: SubtitleParser.Factory = DefaultSubtitleParserFactory()) : SubtitleParser.Factory {
    override fun supportsFormat(format: Format): Boolean = inner.supportsFormat(format)

    override fun getCueReplacementBehavior(format: Format): Int = inner.getCueReplacementBehavior(format)

    override fun create(format: Format): SubtitleParser {
        val behavior = inner.getCueReplacementBehavior(format)
        val parser = try {
            inner.create(format)
        } catch (e: RuntimeException) {
            note(format, "its heading", e)
            null
        }
        return Guarded(parser, behavior, format)
    }

    private class Guarded(private val parser: SubtitleParser?, private val behavior: Int, private val format: Format) : SubtitleParser {
        private var skipped = 0

        override fun parse(data: ByteArray, offset: Int, length: Int, outputOptions: SubtitleParser.OutputOptions, output: Consumer<CuesWithTiming>) {
            val inner = parser ?: return
            try {
                inner.parse(data, offset, length, outputOptions, output)
            } catch (e: RuntimeException) {
                // (one note a track: an episode can have hundreds of lines like it)
                if (skipped++ == 0) note(format, "a line", e)
            }
        }

        override fun reset() {
            try { parser?.reset() } catch (_: RuntimeException) { /* nothing kept to clear */ }
        }

        override fun getCueReplacementBehavior(): Int = parser?.cueReplacementBehavior ?: behavior
    }

    private companion object {
        fun note(format: Format, what: String, e: RuntimeException) {
            val track = listOfNotNull(format.codecs ?: format.sampleMimeType, format.language, format.label).joinToString(", ")
            Log.w("dxbi", "subtitles ($track): $what couldn't be read, left out", e)
            Diary.note("subtitles ($track): $what couldn't be read (${e.javaClass.simpleName}), left out, the video plays on")
        }
    }
}
