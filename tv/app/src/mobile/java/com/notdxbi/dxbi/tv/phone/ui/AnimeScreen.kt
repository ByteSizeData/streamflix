package com.notdxbi.dxbi.tv.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.notdxbi.dxbi.tv.phone.AnimeSource
import com.notdxbi.dxbi.tv.phone.Stremio
import com.notdxbi.dxbi.tv.phone.Title
import kotlinx.coroutines.launch

/** The anime sites and their lists, as dx.bi has them (used until the page says otherwise) */
val ANIME_SOURCES = listOf(
    AnimeSource("anilist", "AniList", listOf("trending" to "Popular right now", "season" to "New this season", "top" to "Best of all time", "popular" to "Most popular ever", "next" to "Coming next season", "movies" to "Best films"), filters = true),
    AnimeSource("mal", "MyAnimeList", listOf("airing" to "Top airing", "top" to "Top anime", "popular" to "Most popular", "movies" to "Top films", "upcoming" to "Most anticipated")),
    AnimeSource("kitsu", "Kitsu", listOf("trending" to "Trending", "airing" to "Top airing", "popular" to "Most popular", "top" to "Highest rated")),
)

/** Anime Ultra's filters until the page says otherwise: AniList's genres, and kinds of release */
val ANIME_FILTERS = com.notdxbi.dxbi.tv.phone.AnimeFilters(
    listOf("Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"),
    listOf("tv" to "Series", "movie" to "Films", "ova" to "OVA, ONA & specials"),
)

/** Home's Anime tab: these lists first, each a row (See All opens it in Anime Ultra) */
val ANIME_HOME = listOf("anilist" to "trending", "anilist" to "season", "mal" to "airing", "kitsu" to "top", "anilist" to "movies", "anilist" to "next")

fun animeListName(source: String, list: String): String {
    val s = ANIME_SOURCES.firstOrNull { it.id == source } ?: return list
    return "${s.lists.firstOrNull { it.first == list }?.second ?: list} · ${s.name}"
}

/**
 * Anime Kitsu is there: the addon that opens titles by their Kitsu id (their episodes, their art).
 * Anime Catalogs can too, but its server often doesn't answer (it timed out all of November 2026).
 */
fun hasAnimeAddon(names: List<String>) = names.any { it.contains("kitsu", true) }

const val ANIME_KITSU_ADDON = "https://anime-kitsu.strem.fun/manifest.json"

/**
 * Anime Ultra (Discover, and Home's Anime tab): the lists of the big anime sites (AniList, MyAnimeList,
 * Kitsu), with each site's scores on the posters; AniList's by genre and kind too. Titles open through
 * the anime addons, by their Kitsu id.
 */
@Composable
fun AnimeScreen(stremio: Stremio, startSource: String, startList: String, onBack: () -> Unit, onOpen: (Title) -> Unit) {
    var sources by remember { mutableStateOf(ANIME_SOURCES) }
    var source by rememberSaveable { mutableStateOf(startSource.ifEmpty { "anilist" }) }
    var list by rememberSaveable { mutableStateOf(startList.ifEmpty { "trending" }) }
    var items by remember { mutableStateOf<List<Title>>(emptyList()) }
    var page by remember { mutableIntStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var filters by remember { mutableStateOf(ANIME_FILTERS) }
    var genre by rememberSaveable { mutableStateOf<String?>(null) }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val account by stremio.account.collectAsState()

    LaunchedEffect(Unit) {
        stremio.animeSources().takeIf { it.isNotEmpty() }?.let { sources = it }
        stremio.animeFilters()?.takeIf { it.genres.isNotEmpty() }?.let { filters = it }
    }
    // (the filters are AniList's: another site's lists are as the site has them)
    val filtered = sources.firstOrNull { it.id == source }?.filters == true
    val g = genre.takeIf { filtered }
    val k = kind.takeIf { filtered && list != "movies" }

    // (each list picked is a new round: an answer for one left behind is dropped, even when it was
    // picked again since)
    var round by remember { mutableIntStateOf(0) }

    fun load(next: Int) {
        if (loading) return
        loading = true
        val mine = round
        val key = "$source/$list/$g/$k"
        scope.launch {
            val got = stremio.anime(source, list, next, g, k)
            if (mine != round) return@launch
            items = if (next == 1) got.items else (items + got.items).distinctBy { it.id }
            page = next
            more = got.more && got.items.isNotEmpty()
            error = if (items.isEmpty()) got.error ?: "Nothing here right now." else null
            loading = false
            if (items.isNotEmpty()) stremio.animeBrowse[key] = Stremio.AnimeBrowse(items, page, more)
        }
    }

    LaunchedEffect(source, list, g, k) {
        round++
        loading = false
        error = null
        // Back from a title: the list as it was, not page one again
        val kept = stremio.animeBrowse["$source/$list/$g/$k"]
        if (kept != null) {
            items = kept.items
            page = kept.page
            more = kept.more
        } else {
            items = emptyList()
            page = 0
            load(1)
        }
    }

    Column(Modifier.fillMaxSize().background(Dx.Background).windowInsetsPadding(WindowInsets.safeDrawing)) {
        ScreenTitle("Anime Ultra", onBack)
        LazyRow(contentPadding = PaddingValues(horizontal = Gutter, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(sources) { s ->
                Pill(selected = s.id == source, onClick = {
                    if (s.id != source) {
                        source = s.id
                        if (s.lists.none { it.first == list }) list = s.lists.firstOrNull()?.first ?: "trending"
                    }
                }) { Text(s.name, color = Dx.Text, style = MaterialTheme.typography.labelMedium) }
            }
        }
        val lists = sources.firstOrNull { it.id == source }?.lists.orEmpty()
        LazyRow(contentPadding = PaddingValues(horizontal = Gutter, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(lists) { (id, name) ->
                Pill(selected = id == list, onClick = { list = id }) { Text(name, color = Dx.Text, style = MaterialTheme.typography.labelMedium) }
            }
        }
        // AniList's lists: by genre, and by kind of release (a list of films is films)
        if (filtered) LazyRow(contentPadding = PaddingValues(horizontal = Gutter, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                PickMenu(genre ?: "All genres", listOf("All genres" to "") + filters.genres.map { it to it }) { genre = it.ifEmpty { null } }
            }
            if (list != "movies") {
                item { Pill(selected = kind == null, onClick = { kind = null }) { Text("Everything", color = Dx.Text, style = MaterialTheme.typography.labelMedium) } }
                items(filters.kinds) { (id, name) ->
                    Pill(selected = kind == id, onClick = { kind = if (kind == id) null else id }) { Text(name, color = Dx.Text, style = MaterialTheme.typography.labelMedium) }
                }
            }
        }
        val names = account?.addons.orEmpty()
        if (account != null && !hasAnimeAddon(names)) AddAnimeAddon(stremio)
        Spacer(Modifier.height(6.dp))
        val problem = error
        if (problem != null && items.isEmpty() && !loading) {
            Box(Modifier.fillMaxWidth().padding(Gutter)) { Text(problem, color = Dx.Muted, style = MaterialTheme.typography.bodyMedium) }
        } else {
            PosterGrid(items, loading = loading, onEnd = { if (more && !loading && page > 0) load(page + 1) }, onOpen = onOpen)
        }
    }
}

/** Without an anime addon nothing could open these titles: one tap adds Anime Kitsu */
@Composable
fun AddAnimeAddon(stremio: Stremio) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var said by remember { mutableStateOf<String?>(null) }
    Column(Modifier.padding(horizontal = Gutter, vertical = 6.dp)) {
        Text(
            said ?: "Anime open through the Anime Kitsu addon (their episodes and details), and it isn't added yet. It's free and needs no account.",
            color = Dx.Muted, style = MaterialTheme.typography.bodySmall,
        )
        if (said == null) {
            Spacer(Modifier.height(6.dp))
            OutlineButton(if (busy) "Adding…" else "Add Anime Kitsu", Modifier.width(200.dp), filled = true) {
                if (busy) return@OutlineButton
                busy = true
                scope.launch {
                    val problem = stremio.installFromLink(ANIME_KITSU_ADDON)
                    said = problem ?: "Anime Kitsu is added."
                    busy = false
                }
            }
        }
    }
}
