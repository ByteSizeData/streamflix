package com.notdxbi.dxbi.tv.phone.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.notdxbi.dxbi.tv.phone.Badge
import com.notdxbi.dxbi.tv.phone.Posters
import com.notdxbi.dxbi.tv.phone.Title

val PosterWidth = 112.dp
val Gutter = 16.dp

/** A poster's width in rows: dx.bi settings → Poster size (and bigger again on a tablet) */
@Composable
fun posterWidth(): Dp {
    val look by Posters.look.collectAsState()
    val tablet = androidx.compose.ui.platform.LocalConfiguration.current.smallestScreenWidthDp >= 600
    val base = when (look.size) {
        "standard" -> 112f
        "larger" -> 160f
        "huge" -> 196f
        else -> 136f
    }
    return (if (tablet) base * 1.3f else base).dp
}

/**
 * The narrowest a poster gets in a grid (as many to a line as fit): on a phone three across for Small
 * and Large (a grid's posters already fill the width), two for Larger and Largest
 */
@Composable
fun gridPosterWidth(): Dp {
    val look by Posters.look.collectAsState()
    val tablet = androidx.compose.ui.platform.LocalConfiguration.current.smallestScreenWidthDp >= 600
    val base = when (look.size) {
        "standard" -> 96f
        "larger" -> 150f
        "huge" -> 180f
        else -> 112f
    }
    return (if (tablet) base * 1.3f else base).dp
}

/** Each site's colours: its name's tag, and the text on it */
private fun badgeColours(b: Badge): Pair<Color, Color> = when (b.label) {
    "IMDb" -> Color(0xFFF5C518) to Color.Black
    "RT" -> if ((b.value.trimEnd('%').toIntOrNull() ?: 0) >= 60) Color(0xFFFA320A) to Color.White else Color(0xFF0AC855) to Color.Black
    "MAL" -> Color(0xFF2E51A2) to Color.White
    "AniList" -> Color(0xFF02A9FF) to Color.White
    "Kitsu" -> Color(0xFFF75239) to Color.White
    else -> Color(0xFF3DB4F2) to Color.White
}

/** One score on a poster: the site's tag and the score, on dark glass */
@Composable
fun ScoreChip(b: Badge, small: Boolean = false) {
    val (tag, ink) = badgeColours(b)
    Row(
        Modifier.clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = 0.72f)).padding(start = 2.dp, end = 5.dp, top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            b.label,
            color = ink,
            fontWeight = FontWeight.Black,
            fontSize = if (small) 8.sp else 9.sp,
            lineHeight = 10.sp,
            modifier = Modifier.clip(RoundedCornerShape(2.dp)).background(tag).padding(horizontal = 3.dp, vertical = 1.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(b.value, color = Color.White, fontWeight = FontWeight.Bold, fontSize = if (small) 10.sp else 11.sp, lineHeight = 12.sp)
    }
}

/**
 * The ratings in a poster's corner: IMDb and Rotten Tomatoes (an anime's site score when neither), or
 * what the list brought (Discover anime). Asked for as the poster comes into view.
 */
@Composable
fun PosterBadges(title: Title, width: Dp, modifier: Modifier = Modifier) {
    val look by Posters.look.collectAsState()
    if (!look.ratings) return
    val all by Posters.scores.collectAsState()
    // (asked again when ratings are switched back on)
    LaunchedEffect(title.type, title.id, look.ratings) { if (title.badges.isEmpty()) Posters.want(title) }
    val s = all["${title.type}:${title.id}"]
    // (an anime catalog's "IMDb" rating is its own site's score: Kitsu puts it there)
    val anime = isAnime(title)
    val chips = buildList {
        if (title.badges.isNotEmpty()) addAll(title.badges.take(2))
        else {
            (s?.imdb ?: title.imdb?.takeUnless { anime })?.let { add(Badge("IMDb", it)) }
            s?.rt?.let { add(Badge("RT", "$it%")) }
            if (isEmpty()) s?.anime?.let { add(it) }
        }
    }
    if (chips.isEmpty()) return
    val small = width < 120.dp
    // (side by side when they fit, else one above the other)
    if (width >= 132.dp || chips.size == 1) {
        Row(modifier.padding(5.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) { chips.forEach { ScoreChip(it, small) } }
    } else {
        Column(modifier.padding(5.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) { chips.forEach { ScoreChip(it, small) } }
    }
}

/** A poster in a grid: as wide as its column, with its ratings */
@Composable
fun PosterTile(title: Title, modifier: Modifier = Modifier, onClick: () -> Unit) {
    androidx.compose.foundation.layout.BoxWithConstraints(modifier.fillMaxWidth().aspectRatio(2f / 3f)) {
        Art(title.art, title.name, Modifier.fillMaxSize().combinedClickableCompat(onClick))
        PosterBadges(title, maxWidth, Modifier.align(Alignment.TopStart))
    }
}

/** A placeholder that gently pulses while something loads */
@Composable
fun Modifier.shimmer(): Modifier {
    val pulse by rememberInfiniteTransition(label = "shimmer").animateFloat(
        initialValue = 0.10f,
        targetValue = 0.22f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "shimmer",
    )
    return this.background(Color.White.copy(alpha = pulse))
}

/** A title's art, or its name on a dark card while there's none (or it hasn't loaded) */
@Composable
fun Art(url: String?, name: String, modifier: Modifier, shape: RoundedCornerShape = RoundedCornerShape(6.dp)) {
    // (no artwork: the name on a soft card, set like a title rather than a missing image)
    Box(modifier.clip(shape).background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Dx.Raised, Dx.Surface))), contentAlignment = Alignment.Center) {
        Text(
            name,
            color = Dx.Muted,
            style = MaterialTheme.typography.titleSmall,
            textAlign = TextAlign.Center,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(10.dp),
        )
        if (url != null) AsyncImage(model = url, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PosterCard(title: Title, width: Dp = posterWidth(), onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Box(Modifier.width(width).aspectRatio(2f / 3f)) {
        Art(
            title.art,
            title.name,
            Modifier
                .fillMaxSize()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = onLongClick?.let { { haptics.performHapticFeedback(HapticFeedbackType.LongPress); it() } },
                ),
        )
        PosterBadges(title, width, Modifier.align(Alignment.TopStart))
    }
}

@Composable
fun PosterPlaceholder(width: Dp = posterWidth()) {
    Box(Modifier.width(width).aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp)).shimmer())
}

/** A thin progress line, the way streaming apps show how far into something you are */
@Composable
fun ProgressLine(progress: Float, modifier: Modifier = Modifier) {
    Box(modifier.height(3.dp).background(Color.White.copy(alpha = 0.25f))) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0.02f, 1f)).background(Dx.Accent))
    }
}

/** A Home row's heading, with See All when there's more */
@Composable
fun RowHeader(title: String, onMore: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(start = Gutter, end = 8.dp, bottom = 8.dp).then(
            if (onMore != null) Modifier.combinedClickableCompat(onMore) else Modifier,
        ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Dx.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (onMore != null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "See all", tint = Dx.Muted)
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit) = this.combinedClickable(onClick = onClick)

/** A titled row of posters, or placeholders while it loads */
@Composable
fun PosterRow(title: String, items: List<Title>, loading: Boolean = false, onMore: (() -> Unit)? = null, onLongClick: ((Title) -> Unit)? = null, onOpen: (Title) -> Unit) {
    Column(Modifier.padding(bottom = 16.dp)) {
        RowHeader(title, onMore)
        LazyRow(contentPadding = PaddingValues(horizontal = Gutter), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (items.isEmpty() && loading) items(5) { PosterPlaceholder() }
            items(items, key = { "${it.type}:${it.id}" }) { t ->
                PosterCard(t, onLongClick = onLongClick?.let { { it(t) } }) { onOpen(t) }
            }
        }
    }
}

/** IMDb's yellow badge with the rating */
@Composable
fun ImdbBadge(rating: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "IMDb",
            color = Color.Black,
            fontWeight = FontWeight.Black,
            fontSize = 10.sp,
            modifier = Modifier.clip(RoundedCornerShape(3.dp)).background(Dx.Imdb).padding(horizontal = 4.dp, vertical = 1.dp),
        )
        Spacer(Modifier.width(5.dp))
        Text(rating, color = Dx.Text, style = MaterialTheme.typography.labelMedium)
    }
}

/** Darkens the bottom of art so text over it reads */
fun bottomScrim(strength: Float = 0.92f) = Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color.Black.copy(alpha = strength))

/** A viewer's round badge: their colour and first letter */
@Composable
fun ViewerBadge(name: String, colour: String?, size: Dp = 30.dp) {
    val tint = colour?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: Dx.Accent
    Box(Modifier.size(size).clip(RoundedCornerShape(size / 5)).background(tint), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Black, fontSize = (size.value * 0.45f).sp)
    }
}

@Composable
fun Dot() = Box(Modifier.padding(horizontal = 6.dp).size(3.dp).clip(CircleShape).background(Dx.Muted))

/** The cast button (Google's own: it opens the device list, and shows when one is connected) */
@Composable
fun CastButton(modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // (no button without Google Play services: nothing to cast with)
    val available = androidx.compose.runtime.remember { com.notdxbi.dxbi.tv.Cast.context(context) != null }
    if (!available) return
    androidx.compose.ui.viewinterop.AndroidView(
        factory = { ctx ->
            androidx.mediarouter.app.MediaRouteButton(android.view.ContextThemeWrapper(ctx, androidx.mediarouter.R.style.Theme_MediaRouter)).also {
                com.google.android.gms.cast.framework.CastButtonFactory.setUpMediaRouteButton(ctx, it)
            }
        },
        modifier = modifier.size(48.dp),
    )
}
