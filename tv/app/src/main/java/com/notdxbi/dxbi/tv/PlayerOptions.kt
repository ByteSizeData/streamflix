package com.notdxbi.dxbi.tv

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * The player's settings without the player's own menus: what there is to choose from and what is
 * chosen, as data, and one of them changed by name. This is how a phone working the TV (Play on TV,
 * TvReceiver) shows the same choices the remote's menus do, and makes them.
 *
 *   audio, subtitles   the tracks ({id, name, on}); subtitles start with Off
 *   subtitleDelayMs    how far the subtitles are moved
 *   speed, picture, zoom, sound, boost   what is chosen, each with its list of choices
 */
@OptIn(UnstableApi::class)
object PlayerOptions {
    private val SPEEDS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
    private val PICTURES = listOf(
        "Fit" to AspectRatioFrameLayout.RESIZE_MODE_FIT,
        "Crop" to AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        "Stretch" to AspectRatioFrameLayout.RESIZE_MODE_FILL,
    )

    private fun channelName(count: Int) = when (count) {
        1 -> "Mono"
        2 -> "Stereo"
        6 -> "5.1"
        8 -> "7.1"
        else -> "$count channels"
    }

    private fun audioKind(mime: String?) = when (mime) {
        MimeTypes.AUDIO_AC3 -> " · Dolby Digital"
        MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> " · Dolby Digital+"
        MimeTypes.AUDIO_TRUEHD -> " · Dolby TrueHD"
        MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_EXPRESS -> " · DTS"
        MimeTypes.AUDIO_DTS_HD -> " · DTS-HD"
        else -> ""
    }

    private fun tracks(exo: ExoPlayer, type: Int): JSONArray {
        val out = JSONArray()
        val groups = exo.currentTracks.groups
        if (type == C.TRACK_TYPE_TEXT) {
            out.put(JSONObject().put("id", "off").put("name", "Off").put("on", groups.none { it.type == type && it.isSelected }))
        }
        var number = 0
        groups.forEachIndexed { g, group ->
            if (group.type != type) return@forEachIndexed
            for (i in 0 until group.length) {
                if (!group.isTrackSupported(i)) continue
                number++
                val format = group.getTrackFormat(i)
                val name = format.label
                    ?: format.language?.let { Locale.forLanguageTag(it).displayLanguage }?.takeIf { it.isNotEmpty() }
                    ?: "Track $number"
                val more = if (type == C.TRACK_TYPE_AUDIO) (if (format.channelCount > 0) " · ${channelName(format.channelCount)}" else "") + audioKind(format.sampleMimeType) else ""
                out.put(JSONObject().put("id", "$g:$i").put("name", name + more).put("on", group.isTrackSelected(i)))
            }
        }
        return out
    }

    private fun choices(pairs: List<Pair<String, String>>, chosen: String): JSONArray {
        val out = JSONArray()
        for ((id, name) in pairs) out.put(JSONObject().put("id", id).put("name", name).put("on", id == chosen))
        return out
    }

    private fun number(f: Float) = if (f == f.toInt().toFloat()) f.toInt().toString() else f.toString()

    fun read(exo: ExoPlayer, playerView: PlayerView, sound: SoundMode, zoom: PictureZoom, subtitleDelayMs: Long): JSONObject {
        val speed = exo.playbackParameters.speed
        val picture = PICTURES.firstOrNull { it.second == playerView.resizeMode }?.first ?: "Fit"
        val zooms = listOfNotNull("off" to "Off", ("auto" to "Remove black bars").takeIf { zoom.canMeasure }, "1.1" to "110%", "1.25" to "125%", "1.33" to "133%")
        return JSONObject()
            .put("audio", tracks(exo, C.TRACK_TYPE_AUDIO))
            .put("subtitles", tracks(exo, C.TRACK_TYPE_TEXT))
            .put("subtitleDelayMs", subtitleDelayMs)
            .put("speed", choices(SPEEDS.map { number(it) to (if (it == 1f) "Normal" else "${number(it)}x") }, number(speed)))
            .put("picture", choices(PICTURES.map { it.first to it.first }, picture))
            .put("zoom", choices(zooms, zoom.mode))
            .put("sound", choices(SoundMode.MODES.map { it.label to it.label }, sound.mode.label))
            .put("boost", choices(SoundMode.BOOSTS.map { number(it) to SoundMode.boostLabel(it) }, number(sound.boost)))
    }

    /** Changes one setting; false when [name] or [value] isn't one of the choices */
    fun set(exo: ExoPlayer, playerView: PlayerView, sound: SoundMode, zoom: PictureZoom, shiftSubtitles: (Long) -> Long, name: String, value: String): Boolean {
        when (name) {
            "audio", "subtitles" -> {
                val type = if (name == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
                if (value == "off") {
                    if (type != C.TRACK_TYPE_TEXT) return false
                    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(type).setTrackTypeDisabled(type, true).build()
                    return true
                }
                val g = value.substringBefore(':').toIntOrNull() ?: return false
                val i = value.substringAfter(':', "").toIntOrNull() ?: return false
                val group = exo.currentTracks.groups.getOrNull(g)?.takeIf { it.type == type && i in 0 until it.length && it.isTrackSupported(i) } ?: return false
                exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(type, false)
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, i))
                    .build()
            }
            // (moved by this much: a quarter of a second earlier or later at a time, as the remote's menu does; 0 puts them back)
            "subtitleDelay" -> {
                val by = value.toLongOrNull()?.takeIf { it in -60_000..60_000 } ?: return false
                if (by == 0L) shiftSubtitles(-shiftSubtitles(0)) else shiftSubtitles(by)
            }
            "speed" -> exo.setPlaybackSpeed(SPEEDS.firstOrNull { number(it) == value } ?: return false)
            "picture" -> playerView.resizeMode = PICTURES.firstOrNull { it.first == value }?.second ?: return false
            "zoom" -> {
                if (value !in setOf("off", "auto", "1.1", "1.25", "1.33") || (value == "auto" && !zoom.canMeasure)) return false
                zoom.set(value)
            }
            "sound" -> sound.mode = SoundMode.MODES.firstOrNull { it.label == value } ?: return false
            "boost" -> sound.boost = SoundMode.BOOSTS.firstOrNull { number(it) == value } ?: return false
            else -> return false
        }
        return true
    }
}
