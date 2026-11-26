package com.notdxbi.dxbi.tv.phone.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.VolumeDown
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.ConnectedTv
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.notdxbi.dxbi.tv.TvRemote
import kotlinx.coroutines.delay

// Play on TV (TvRemote.kt): the button that opens it, the sheet with the TVs to pick from, which
// becomes that TV's remote once one is picked, and the strip that says what the TV is playing.

/** In the top bar, beside the Chromecast button: lit while a TV is chosen */
@Composable
fun TvButton(modifier: Modifier = Modifier) {
    val tv by TvRemote.tv.collectAsState()
    IconButton(onClick = { TvRemote.sheet.value = true }, modifier = modifier) {
        Icon(
            if (tv != null) Icons.Filled.ConnectedTv else Icons.Filled.Tv,
            contentDescription = tv?.let { "Playing on ${it.name}" } ?: "Play on TV",
            tint = if (tv != null) Dx.Accent else Color.White,
        )
    }
}

/** What the chosen TV is playing, over the bottom of the screen: a tap opens the remote */
@Composable
fun TvBar(modifier: Modifier = Modifier) {
    val tv by TvRemote.tv.collectAsState()
    val status by TvRemote.status.collectAsState()
    val context = LocalContext.current
    val on = tv ?: return
    val now = status?.takeIf { it.open } ?: return
    Row(
        modifier
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Dx.Raised)
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
            .clickable { TvRemote.sheet.value = true }
            .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.ConnectedTv, contentDescription = null, tint = Dx.Accent, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(now.title.ifBlank { "Playing" }, color = Dx.Text, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("On ${on.name}", color = Dx.Muted, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { TvRemote.control(context, "toggle") }) {
            Icon(if (now.paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, contentDescription = if (now.paused) "Play" else "Pause", tint = Dx.Text)
        }
    }
}

/** The sheet, wherever the app is: the TVs to pick from, or the chosen TV's remote */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TvSheetHost() {
    val open by TvRemote.sheet.collectAsState()
    if (!open) return
    val context = LocalContext.current
    val tv by TvRemote.tv.collectAsState()
    val problem by TvRemote.problem.collectAsState()
    ModalBottomSheet(
        onDismissRequest = { TvRemote.sheet.value = false },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Dx.Surface,
    ) {
        Column(
            Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = Gutter)
                .windowInsetsPadding(WindowInsets.navigationBars).padding(bottom = 20.dp),
        ) {
            val on = tv
            if (on == null) Chooser(context) else Remote(context, on)
            problem?.let {
                Spacer(Modifier.height(14.dp))
                Text(it, color = Dx.Accent, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun Chooser(context: Context) {
    val found by TvRemote.found.collectAsState()
    val searching by TvRemote.searching.collectAsState()
    val connecting by TvRemote.connecting.collectAsState()
    var typing by remember { mutableStateOf(false) }
    var address by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { TvRemote.search(context) }

    Text("Play on TV", style = MaterialTheme.typography.headlineMedium, color = Dx.Text)
    Text(
        "Open StreamFlix on your TV, then pick it here. What you play goes to the TV, and this becomes its remote.",
        color = Dx.Muted, style = MaterialTheme.typography.bodyMedium,
    )
    Spacer(Modifier.height(16.dp))
    val asking = connecting
    if (asking != null) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 10.dp)) {
            CircularProgressIndicator(color = Dx.Accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Text("Look at $asking: the first time, it asks there whether to let this in. Pick Allow.", color = Dx.Text, style = MaterialTheme.typography.bodyMedium)
        }
        return
    }
    found.forEach { tv ->
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { TvRemote.connect(context, tv) }.padding(vertical = 12.dp, horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Tv, contentDescription = null, tint = Dx.Text, modifier = Modifier.size(28.dp))
            Column(Modifier.padding(start = 14.dp)) {
                Text(tv.name, color = Dx.Text, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(tv.host, color = Dx.Faint, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    when {
        searching -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 10.dp)) {
            CircularProgressIndicator(color = Dx.Accent, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(12.dp))
            Text("Looking for TVs on your Wi-Fi…", color = Dx.Muted, style = MaterialTheme.typography.bodyMedium)
        }
        found.isEmpty() -> Text(
            "No TV found. The app has to be open on the TV's screen, and this has to be on the same Wi-Fi as the TV.",
            color = Dx.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 10.dp),
        )
    }
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        if (!searching) Text("Look again", color = Dx.Text, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { TvRemote.search(context) }.padding(vertical = 10.dp))
        if (!typing) Text("Type the TV's address", color = Dx.Text, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { typing = true }.padding(vertical = 10.dp))
    }
    if (typing) {
        Text("It's in the TV's own Settings, under Network: four numbers with dots.", color = Dx.Muted, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = address,
                onValueChange = { address = it.take(60) },
                singleLine = true,
                placeholder = { Text("192.168.1.20") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { TvRemote.connectTo(context, address) }),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "Connect", color = Color.Black, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White).clickable { TvRemote.connectTo(context, address) }.padding(horizontal = 16.dp, vertical = 14.dp),
            )
        }
    }
}

@Composable
private fun Remote(context: Context, tv: TvRemote.Tv) {
    val status by TvRemote.status.collectAsState()
    val lost by TvRemote.lost.collectAsState()
    val starting by TvRemote.starting.collectAsState()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.ConnectedTv, contentDescription = null, tint = Dx.Accent, modifier = Modifier.size(26.dp))
        Spacer(Modifier.width(10.dp))
        Text(tv.name, style = MaterialTheme.typography.headlineMedium, color = Dx.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("Disconnect", color = Dx.Muted, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { TvRemote.disconnect() }.padding(8.dp))
    }
    Spacer(Modifier.height(10.dp))
    val now = status
    when {
        lost -> Text("${tv.name} isn't answering. Is the app still open on the TV?", color = Dx.Muted, style = MaterialTheme.typography.bodyMedium)
        now?.open == true -> Playing(context, now)
        starting > 0 -> Starting(context, tv)
        now == null -> Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Dx.Accent) }
        else -> Text(
            "Nothing is playing on the TV. Pick a film or an episode here and press Play: it opens on ${tv.name}.",
            color = Dx.Muted, style = MaterialTheme.typography.bodyMedium,
        )
    }
    Spacer(Modifier.height(18.dp))
    Pad(context)
}

/** Play was just sent: the TV is opening it (a torrent can take a while), and the buttons are ready */
@Composable
private fun Starting(context: Context, tv: TvRemote.Tv) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(color = Dx.Accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Text("Starting on ${tv.name}…", color = Dx.Text, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Spacer(Modifier.height(4.dp))
    Text("Pause, subtitles and the rest come up here as soon as it plays. A torrent can take a minute to start.", color = Dx.Muted, style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(12.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        Round(Icons.Filled.Replay10, "Back 10 seconds") { TvRemote.control(context, "seekBy", -10_000) }
        Round(Icons.Filled.Pause, "Pause", big = true) { TvRemote.control(context, "toggle") }
        Round(Icons.Filled.Forward10, "Forward 10 seconds") { TvRemote.control(context, "seekBy", 10_000) }
        Round(Icons.Filled.Stop, "Stop") { TvRemote.control(context, "close") }
    }
    Settings(context)
}

@Composable
private fun Playing(context: Context, now: TvRemote.Status) {
    // (while the knob is held it stays under the finger, not where the TV last said it was)
    var held by remember { mutableStateOf<Float?>(null) }
    val length = now.durationMs.coerceAtLeast(0L)
    val at = held ?: if (length > 0) (now.positionMs.toFloat() / length).coerceIn(0f, 1f) else 0f
    Text(now.title.ifBlank { "Playing" }, color = Dx.Text, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
    if (now.subtitle.isNotBlank()) Text(now.subtitle, color = Dx.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Slider(
        value = at,
        onValueChange = { held = it },
        onValueChangeFinished = {
            held?.let { if (length > 0) TvRemote.control(context, "seek", (it * length).toLong()) }
            held = null
        },
        enabled = length > 0,
        colors = SliderDefaults.colors(thumbColor = Dx.Accent, activeTrackColor = Dx.Accent, inactiveTrackColor = Dx.Line),
        modifier = Modifier.fillMaxWidth(),
    )
    Row(Modifier.fillMaxWidth()) {
        Text(clock((at * length).toLong()), color = Dx.Muted, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.weight(1f))
        Text(if (now.buffering) "Loading…" else clock(length), color = Dx.Muted, style = MaterialTheme.typography.labelMedium)
    }
    Spacer(Modifier.height(6.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        Round(Icons.Filled.Replay10, "Back 10 seconds") { TvRemote.control(context, "seekBy", -10_000) }
        Round(if (now.paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, if (now.paused) "Play" else "Pause", big = true) { TvRemote.control(context, "toggle") }
        Round(Icons.Filled.Forward10, "Forward 10 seconds") { TvRemote.control(context, "seekBy", 10_000) }
        Round(Icons.Filled.Stop, "Stop") { TvRemote.control(context, "close") }
    }
    Settings(context)
}

/**
 * The TV player's own settings, the ones its remote's menus have: sound track, subtitles and their
 * timing, speed, picture, zoom, sound mode and volume boost. Chosen here, they change on the TV.
 */
@Composable
private fun Settings(context: Context) {
    val options by TvRemote.options.collectAsState()
    // (asked for again every few seconds: the tracks change with the episode, and the TV's remote may change the rest)
    LaunchedEffect(Unit) {
        while (true) {
            TvRemote.loadOptions(context)
            delay(4000)
        }
    }
    val o = options ?: return
    Spacer(Modifier.height(14.dp))
    Text("Video settings", color = Dx.Text, style = MaterialTheme.typography.titleMedium)
    Chips("Audio", o.audio) { TvRemote.setOption(context, "audio", it) }
    Chips("Subtitles", o.subtitles) { TvRemote.setOption(context, "subtitles", it) }
    if (o.subtitles.any { it.on && it.id != "off" }) {
        val moved = if (o.subtitleDelayMs == 0L) "on time" else "%+.2f s".format(o.subtitleDelayMs / 1000f)
        Chips("Subtitle timing · $moved", listOf(
            TvRemote.Choice("-250", "Earlier", false), TvRemote.Choice("250", "Later", false), TvRemote.Choice("0", "Reset", o.subtitleDelayMs == 0L),
        )) { TvRemote.setOption(context, "subtitleDelay", it) }
    }
    Chips("Volume boost", o.boost) { TvRemote.setOption(context, "boost", it) }
    Chips("Sound", o.sound) { TvRemote.setOption(context, "sound", it) }
    Chips("Speed", o.speed) { TvRemote.setOption(context, "speed", it) }
    Chips("Picture", o.picture) { TvRemote.setOption(context, "picture", it) }
    Chips("Zoom", o.zoom) { TvRemote.setOption(context, "zoom", it) }
}

/** One setting: its name, then what there is to choose from in a row that slides sideways */
@Composable
private fun Chips(label: String, choices: List<TvRemote.Choice>, onPick: (String) -> Unit) {
    if (choices.isEmpty()) return
    Spacer(Modifier.height(10.dp))
    Text(label, color = Dx.Faint, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(6.dp))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(end = 8.dp)) {
        items(choices) { c ->
            Text(
                c.name,
                color = if (c.on) Color.Black else Dx.Text,
                fontWeight = if (c.on) FontWeight.Bold else FontWeight.Medium,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(if (c.on) Color.White else Dx.Raised)
                    .clickable { onPick(c.id) }.padding(horizontal = 14.dp, vertical = 9.dp),
            )
        }
    }
}

/** The TV remote's arrows, for the TV's own screens: its menus, a question it asks */
@Composable
private fun Pad(context: Context) {
    Text("TV remote", color = Dx.Faint, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(8.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Round(Icons.AutoMirrored.Filled.ArrowBack, "Back") { TvRemote.press(context, "back") }
            Round(Icons.AutoMirrored.Filled.VolumeDown, "Volume down") { TvRemote.press(context, "voldown") }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Round(Icons.Filled.KeyboardArrowUp, "Up") { TvRemote.press(context, "up") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Round(Icons.Filled.KeyboardArrowLeft, "Left") { TvRemote.press(context, "left") }
                Box(
                    Modifier.padding(8.dp).size(64.dp).clip(CircleShape).background(Color.White).clickable { TvRemote.press(context, "ok") },
                    contentAlignment = Alignment.Center,
                ) { Text("OK", color = Color.Black, fontWeight = FontWeight.Black, textAlign = TextAlign.Center) }
                Round(Icons.Filled.KeyboardArrowRight, "Right") { TvRemote.press(context, "right") }
            }
            Round(Icons.Filled.KeyboardArrowDown, "Down") { TvRemote.press(context, "down") }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Spacer(Modifier.size(52.dp))
            Round(Icons.AutoMirrored.Filled.VolumeUp, "Volume up") { TvRemote.press(context, "volup") }
        }
    }
}

@Composable
private fun Round(icon: ImageVector, label: String, big: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.size(if (big) 68.dp else 52.dp).clip(CircleShape).background(if (big) Color.White else Dx.Raised).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = label, tint = if (big) Color.Black else Dx.Text, modifier = Modifier.size(if (big) 38.dp else 28.dp)) }
}

private fun clock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s % 3600 / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}
