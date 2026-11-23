package com.notdxbi.dxbi.tv

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Locale
import java.util.zip.GZIPInputStream

/**
 * The parts of Thai subtitles that need neither the network nor Android (so they can be tried on a
 * computer): which of OpenSubtitles' files suits the stream best, and turning what it sends (gzip;
 * Windows-874 or UTF-8; SubRip or SubStation) into a UTF-8 SubRip file the player reads, without the
 * adverts OpenSubtitles puts in.
 */
object SubtitleFiles {

    /** One file from OpenSubtitles' search answer */
    class Candidate(
        /** What it was timed to: the release it was made for, and the subtitle file's own name */
        val release: String,
        /** "srt", "ssa", "ass"… */
        val format: String,
        val downloads: Int,
        val hearingImpaired: Boolean,
        val link: String,
    )

    /** What a release's name says about the file: resolution, where it came from, who put it out */
    class Release(val resolution: Int, val source: String?, val group: String?, val yify: Boolean, val words: Set<String>)

    private val FORMATS = setOf("srt", "ssa", "ass")

    /** Usable files, best first: the closest release, then not for the hard of hearing, then the most downloaded */
    fun rank(candidates: List<Candidate>, streamRelease: String): List<Candidate> {
        val stream = release(streamRelease)
        return candidates
            .filter { it.format.lowercase(Locale.ROOT) in FORMATS && it.link.isNotEmpty() }
            .map { it to score(stream, release(it.release)) }
            .sortedWith(compareByDescending<Pair<Candidate, Int>> { it.second }.thenBy { it.first.hearingImpaired }.thenByDescending { it.first.downloads })
            .map { it.first }
    }

    /**
     * How well a subtitle made for [sub] should fit a stream of [stream]. The same group (or both YIFY)
     * is almost always the same cut and timing; the same kind of source often is; the resolution says
     * least, as one group's 720p and 1080p share their timing.
     */
    fun score(stream: Release, sub: Release): Int {
        var s = 0
        // (a subtitle's name doesn't always set the group off with a dash: "…x264.anoXmous")
        val sameGroup = (stream.group != null && (stream.group == sub.group || (stream.group.length >= 3 && stream.group in sub.words))) ||
            (sub.group != null && sub.group.length >= 3 && sub.group in stream.words)
        if (sameGroup) s += 8
        if (stream.yify && sub.yify) s += 8
        if (stream.source != null && sub.source != null) {
            if (stream.source == sub.source) s += 4 else if (family(stream.source) == family(sub.source)) s += 3
        }
        if (stream.resolution > 0 && stream.resolution == sub.resolution) s += 2
        return s
    }

    private fun family(source: String) = if (source.startsWith("web")) "web" else source

    // Words that end a release name after a dash without being its group ("…WEB-DL", "…BluRay-x264")
    private val NOT_GROUPS = setOf("dl", "rip", "x264", "x265", "h264", "h265", "hevc", "avc", "aac", "ac3", "dts", "hdr", "sdr",
        "2160p", "1080p", "720p", "480p", "web", "bluray", "en", "eng", "th", "tha", "thai", "sub", "subs")

    fun release(name: String): Release {
        val text = name.lowercase(Locale.ROOT)
        val tokens = text.split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.toSet()
        val resolution = when {
            "2160p" in tokens || "4k" in tokens || "uhd" in tokens -> 2160
            "1080p" in tokens || "1080i" in tokens -> 1080
            "720p" in tokens -> 720
            "576p" in tokens || "480p" in tokens -> 480
            else -> 0
        }
        val source = when {
            tokens.any { it in setOf("bluray", "bdrip", "brrip", "bdremux", "remux", "bd25", "bd50") } || ("blu" in tokens && "ray" in tokens) -> "bluray"
            "webrip" in tokens -> "webrip"
            "webdl" in tokens || ("web" in tokens && "dl" in tokens) -> "webdl"
            "web" in tokens -> "web"
            "hdtv" in tokens || "pdtv" in tokens -> "hdtv"
            tokens.any { it in setOf("dvdrip", "dvd", "dvdscr", "dvd5", "dvd9") } -> "dvd"
            "hdrip" in tokens -> "hdrip"
            tokens.any { it in setOf("cam", "hdcam", "ts", "telesync", "hdts") } -> "cam"
            else -> null
        }
        // "…x264-SPARKS.mkv" → sparks: each line on its own (a stream's title adds seeders and size below)
        val group = name.lineSequence().mapNotNull { line ->
            val bare = line.trim()
                .replace(Regex("""\s*\[[^\]]*]\s*$"""), "")
                .replace(Regex("""\.(mkv|mp4|avi|m4v|ts|webm|srt|ssa|ass|sub)$""", RegexOption.IGNORE_CASE), "")
            Regex("""-([A-Za-z0-9]{2,20})$""").find(bare)?.groupValues?.get(1)?.lowercase(Locale.ROOT)
                ?.takeIf { it !in NOT_GROUPS && !it.all(Char::isDigit) }
        }.firstOrNull()
        return Release(resolution, source, group, "yify" in tokens || "yts" in tokens, tokens)
    }

    /** Reads at most [limit] bytes; null when there's more (a subtitle file is never that big) */
    fun readLimited(input: InputStream, limit: Int): ByteArray? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            if (out.size() > limit) return null
        }
        return out.toByteArray()
    }

    /** OpenSubtitles sends its files gzipped; anything else is taken as it is. Null: broken */
    fun gunzip(bytes: ByteArray, limit: Int = 8 shl 20): ByteArray? {
        if (bytes.size < 2 || bytes[0] != 0x1f.toByte() || bytes[1] != 0x8b.toByte()) return bytes
        return try {
            GZIPInputStream(bytes.inputStream()).use { readLimited(it, limit) }
        } catch (_: IOException) {
            null
        }
    }

    /**
     * The file's text. A byte-order mark says what it is. Otherwise the uploader's label is only a
     * guess: a file that is valid UTF-8 is UTF-8, and Thai written in Windows-874 (CP874, TIS-620)
     * never is, so the rest is read as Windows-874.
     */
    fun decode(bytes: ByteArray): String {
        val text = when {
            bytes.startsWith(0xEF, 0xBB, 0xBF) -> String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
            bytes.startsWith(0xFF, 0xFE) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
            bytes.startsWith(0xFE, 0xFF) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
            else -> utf8(bytes) ?: windows874(bytes)
        }
        return text.replace("\r\n", "\n").replace('\r', '\n')
    }

    private fun ByteArray.startsWith(vararg b: Int) = size >= b.size && b.indices.all { this[it] == b[it].toByte() }

    private fun utf8(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString()
    } catch (_: CharacterCodingException) {
        null
    }

    /** Windows-874: ASCII, a few punctuation marks, and Thai at U+0E01–U+0E5B (TIS-620's letters) */
    fun windows874(bytes: ByteArray): String {
        val out = StringBuilder(bytes.size)
        for (byte in bytes) {
            val b = byte.toInt() and 0xFF
            out.append(
                when (b) {
                    in 0x00..0x7F -> b.toChar()
                    0x80 -> '€'
                    0x85 -> '…'
                    0x91 -> '‘'
                    0x92 -> '’'
                    0x93 -> '“'
                    0x94 -> '”'
                    0x95 -> '•'
                    0x96 -> '–'
                    0x97 -> '—'
                    0xA0 -> ' '
                    in 0xA1..0xDA, in 0xDF..0xFB -> (0x0E00 + b - 0xA0).toChar()
                    else -> '�'
                },
            )
        }
        return out.toString()
    }

    private val SRT_TIMING = Regex("""^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3}).*$""")

    /** One subtitle on screen: from and to (ms), and its words */
    class Cue(val startMs: Long, val endMs: Long, val text: String)

    /**
     * The file as SubRip, whatever OpenSubtitles called it (going by what's in it), without the adverts
     * put in it, or null when it's neither SubRip nor SubStation. SubStation's own placing and styles go:
     * the player draws every subtitle the way Stremio's settings say, at the bottom.
     */
    fun toSrt(text: String): String? {
        val ssa = Regex("""(?im)^\s*\[events]\s*$""").containsMatchIn(text) && Regex("""(?im)^\s*dialogue\s*:""").containsMatchIn(text)
        return srt(withoutAdverts(if (ssa) ssaCues(text) else srtCues(text)))
    }

    /** SubStation Alpha (.ssa) and Advanced SubStation (.ass) as SubRip, without the adverts */
    fun ssaToSrt(text: String): String? = srt(withoutAdverts(ssaCues(text)))

    /** SubRip as the player's reader wants it: numbered from 1, "00:01:02,345 --> …" (some files write a full stop, or add a position) */
    private fun srt(cues: List<Cue>): String? {
        if (cues.isEmpty()) return null
        return cues.mapIndexed { i, c -> "${i + 1}\n${clock(c.startMs)} --> ${clock(c.endMs)}\n${c.text}\n" }.joinToString("\n")
    }

    /**
     * A SubRip file's cues, read as the player's reader does: a timing line, then its words up to a blank
     * line (or, in a file that leaves the blank lines out, up to the next number and timing line)
     */
    fun srtCues(text: String): List<Cue> {
        val lines = text.lines()
        val cues = mutableListOf<Cue>()
        var i = 0
        while (i < lines.size) {
            val m = SRT_TIMING.matchEntire(lines[i++]) ?: continue
            val v = m.groupValues
            val words = mutableListOf<String>()
            while (i < lines.size && lines[i].isNotBlank() && SRT_TIMING.matchEntire(lines[i]) == null &&
                !(lines[i].trim().all(Char::isDigit) && i + 1 < lines.size && SRT_TIMING.matchEntire(lines[i + 1]) != null)
            ) {
                words += lines[i++].trimEnd()
            }
            if (words.isNotEmpty()) cues += Cue(time(v[1], v[2], v[3], v[4]), time(v[5], v[6], v[7], v[8]), words.joinToString("\n"))
        }
        return cues
    }

    private fun time(h: String, m: String, s: String, fraction: String) =
        ((h.toLong() * 60 + m.toLong()) * 60 + s.toLong()) * 1000 + fraction.padEnd(3, '0').toLong()

    // OpenSubtitles writes adverts into some files, in the first seconds and the last minute: an app that
    // makes subtitles (a Thai line, ending getray.app or tryray.app), "Advertise your product or brand
    // here", a link to rate the file. These are never something said on screen, wherever they are
    private val ADVERT = Regex(
        """opensubtitles|osdb\.link|getray\.app|tryray\.app|advertise your product|remove all ads|become vip member|rate this subtitle|help other users to choose""",
        RegexOption.IGNORE_CASE,
    )
    // A web address: www.…, http(s)://…, or a name ending .com, .app… (not "Mr." or "a.m."). The people
    // who make a file sign it with their site's address at either end too; in the middle of the film, a
    // line with an address is more likely something said or written on screen, so it stays
    private val WEB_ADDRESS = Regex(
        """(?:https?://|www\.)\S|(?<![a-z0-9@._-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|app|link|info|xyz|biz|co\.th|in\.th)(?![a-z0-9-])""",
        RegexOption.IGNORE_CASE,
    )
    private const val EDGE_MS = 5 * 60_000L

    // The words as shown: <i>, <font> and {\…} codes left out. (Every "}" in these patterns is escaped:
    // Android's regular expressions are ICU's, which refuse a bare "}" that Java on a computer accepts,
    // and a pattern refused there threw on every file.)
    private val MARKUP = Regex("""<[^>]*>|\{[^}]*\}""")
    private val SSA_DRAWING = Regex("""\{[^}]*\\p[1-9][^}]*\}""")
    private val SSA_CODES = Regex("""\{[^}]*\}""")

    /** [cues] without the adverts and site signatures in them (and without empty ones) */
    fun withoutAdverts(cues: List<Cue>): List<Cue> {
        if (cues.isEmpty()) return cues
        val last = cues.maxOf { it.endMs }
        return cues.filter { cue ->
            val words = cue.text.replace(MARKUP, "")
            val atAnEnd = cue.startMs < EDGE_MS || cue.endMs > last - EDGE_MS
            words.isNotBlank() && !ADVERT.containsMatchIn(words) && !(atAnEnd && WEB_ADDRESS.containsMatchIn(words))
        }
    }

    private fun clock(ms: Long) =
        "%02d:%02d:%02d,%03d".format(Locale.ROOT, ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)

    private val SSA_TIME = Regex("""^\s*(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})\s*$""")

    private fun ssaTime(value: String): Long? {
        val v = SSA_TIME.matchEntire(value)?.groupValues ?: return null
        return ((v[1].toLong() * 60 + v[2].toLong()) * 60 + v[3].toLong()) * 1000 + v[4].padEnd(3, '0').toLong()
    }

    /** A SubStation Alpha (.ssa) or Advanced SubStation (.ass) file's cues, in time order: each Dialogue line's times and words */
    fun ssaCues(text: String): List<Cue> {
        var events = false
        // (SubStation's own order when a file leaves out its Format line; .ass has Layer where .ssa has Marked)
        var fields = listOf("marked", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text")
        val cues = mutableListOf<Cue>()
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("[")) {
                events = line.equals("[Events]", ignoreCase = true)
                continue
            }
            if (!events) continue
            if (line.startsWith("Format:", ignoreCase = true)) {
                fields = line.substringAfter(':').split(',').map { it.trim().lowercase(Locale.ROOT) }
                continue
            }
            if (!line.startsWith("Dialogue:", ignoreCase = true)) continue
            val start = fields.indexOf("start")
            val end = fields.indexOf("end")
            val words = fields.indexOf("text")
            if (start < 0 || end < 0 || words != fields.size - 1) continue
            // (the words come last and may have commas of their own)
            val values = line.substringAfter(':').split(',', limit = fields.size)
            if (values.size < fields.size) continue
            val from = ssaTime(values[start]) ?: continue
            val to = ssaTime(values[end]) ?: continue
            val body = ssaWords(values[words]) ?: continue
            if (to > from) cues += Cue(from, to, body)
        }
        return cues.sortedBy { it.startMs }
    }

    /** A Dialogue line's words without SubStation's {\…} codes; null for a drawing or nothing to read */
    private fun ssaWords(value: String): String? {
        if (SSA_DRAWING.containsMatchIn(value)) return null
        val words = value.replace(SSA_CODES, "")
            .replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
            .lines().map { it.trim() }.filter { it.isNotEmpty() }
            .joinToString("\n")
        return words.ifEmpty { null }
    }
}
