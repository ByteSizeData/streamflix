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

/** The anime sites and their lists, as StreamFlix has them (used until the page says otherwise) */
val ANIME_SOURCES = listOf(
    AnimeSource("anilist", "AniList", listOf("trending" to "Trending now", "season" to "Popular this season", "next" to "Coming next season", "top" to "Top rated", "popular" to "All-time popular", "movies" to "Top films")),
    AnimeSource("mal", "MyAnimeList", listOf("airing" to "Top airing", "top" to "Top anime", "popular" to "Most popular", "movies" to "Top films", "upcoming" to "Most anticipated")),
    AnimeSource("kitsu", "Kitsu", listOf("trending" to "Trending", "airing" to "Top airing", "popular" to "Most popular", "top" to "Highest rated")),
)

/** Home's Anime tab: these lists first, each a row (See All opens it in Discover anime) */
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
 * Discover anime: the lists of the big anime sites (AniList, MyAnimeList, Kitsu), with each site's
 * scores on the posters. Titles open through the anime addons, by their Kitsu id.
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
    val scope = rememberCoroutineScope()
    val account by stremio.account.collectAsState()

    LaunchedEffect(Unit) { stremio.animeSources().takeIf { it.isNotEmpty() }?.let { sources = it } }

    fun load(next: Int) {
        if (loading) return
        loading = true
        val want = source to list
        scope.launch {
            val got = stremio.anime(want.first, want.second, next)
            // (another list was picked meanwhile)
            if (want != (source to list)) return@launch
            items = if (next == 1) got.items else (items + got.items).distinctBy { it.id }
            page = next
            more = got.more && got.items.isNotEmpty()
            error = if (items.isEmpty()) got.error ?: "Nothing here right now." else null
            loading = false
        }
    }

    LaunchedEffect(source, list) {
        items = emptyList()
        page = 0
        error = null
        loading = false
        load(1)
    }

    Column(Modifier.fillMaxSize().background(Dx.Background).windowInsetsPadding(WindowInsets.safeDrawing)) {
        ScreenTitle("Discover anime", onBack)
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
