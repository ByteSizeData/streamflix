package com.notdxbi.dxbi.tv.phone

import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/**
 * What a poster carries beside its art, wherever one is drawn: the ratings on it (dx.bi settings →
 * Ratings on posters) and how big posters are (Poster size). [Stremio] fills both in: the look from
 * dx.bi's settings, the scores as posters come into view (window.__dxbi.phone.scores, a batch at a time).
 */
object Posters {
    data class Look(val ratings: Boolean = true, val size: String = "large") {
        companion object {
            fun from(o: JSONObject?) = if (o == null) null else Look(o.optBoolean("ratings", true), o.optString("posterSize").ifEmpty { "large" })
        }
    }

    /** A title's scores: IMDb's ("7.9"), Rotten Tomatoes' Tomatometer (93), or an anime site's */
    data class Scores(val imdb: String?, val rt: Int?, val anime: Badge?) {
        companion object {
            fun from(o: JSONObject?) = Scores(
                o?.text("imdb"),
                o?.takeIf { it.has("rt") && !it.isNull("rt") }?.optInt("rt"),
                o?.optJSONObject("anime")?.let { a -> a.text("value")?.let { Badge(a.optString("label"), it) } },
            )
        }
    }

    val look = MutableStateFlow(Look())
    /** By "type:id" */
    val scores = MutableStateFlow<Map<String, Scores>>(emptyMap())

    /** Asks for a title's scores (set by [Stremio]) */
    internal var asker: ((Title) -> Unit)? = null

    fun want(title: Title) {
        asker?.invoke(title)
    }
}
