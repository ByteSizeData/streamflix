# What StreamFlix changes

StreamFlix is [dx.bi](https://github.com/notdxbi/dxbi-stremio) with the changes below. dx.bi's own
changes are in [CHANGELOG.md](../CHANGELOG.md). The entries here were written while the build was
still called "dx.bi, Simkl build", newest first; StreamFlix's own releases are above them.

## StreamFlix 2.38.407

- **Volume boost.** For a film that is quiet with the volume all the way up: 150%, 200% or 300%, in the player's Picture & sound menu on the TV, under More on a phone or tablet, and as its own button on an iPhone or iPad. On Android a loud moment is held back instead of distorting. Sound sent to a receiver as Dolby or DTS can't be changed by the app.
- **The TV's video settings from the phone.** While something plays on the TV through Play on TV, the remote on the phone, tablet or iPad lists the TV player's own settings and changes them: the sound track, the subtitles and their timing, volume boost, sound mode, speed, picture and zoom. The TV's remote isn't needed for any of it.
- **The stream list on phones, tablets and iPad.** The best match is always the first row, framed in gold. Each release's languages are on a line of their own behind their flags. English dubs of an anime, or of a film or show that isn't in English, are framed and labelled in blue, and come right after the best match.
- **The TV's stream list marks English dubs in blue** too, and "English dub first" is on unless it is turned off in the settings.

## StreamFlix 2.38.406

- **"Report a problem" sends nothing.** In dx.bi it sends the app's details (version, device, settings, addon names, recent errors) to a relay its developer runs, for dx.bi's own Discord. StreamFlix's reports don't belong there, so StreamFlix is built without the relay: the screen is still there, and Send says that reporting isn't set up in this version. (The other thing that goes through a dx.bi server is unchanged: with two or more viewers, "Who's watching" keeps them in step across devices through dx.bi's profile sync.)

## StreamFlix 2.38.405

- **Phones and tablets: an update installs without Android asking again.** Android 12 and later let an app update itself without the "Update this app?" question, but only for an app that declares it will; the app asked for no question and never declared it, so Android asked every time. From this version on, tapping Update in the app is all it takes (seen on Android 15: 2.38.398 to 2.38.404 with no question). The first time, Android still sends you to "Install unknown apps" to allow it once.
- **The update's message says what happens.** The app closes when an update is in, and Android doesn't let it open itself again: the message now says to open it, instead of promising it will reopen.

## StreamFlix 2.38.404

- **Play on TV.** The phone, tablet and iPad apps have a TV button beside the cast button. It lists the TVs on your Wi-Fi that have StreamFlix open (or takes a TV's address), and the first time the TV asks on its own screen whether to let that phone in. While a TV is chosen, Play sends the film or episode to it: the TV app opens it as if it had been picked with the TV's remote, so the TV keeps the watch progress, the subtitles and the next episode itself, and the phone can sleep or leave. The phone shows what the TV is playing, with pause, a seek bar, ten seconds back and forward, stop, and the remote's arrows, OK, Back and volume for the TV's own screens. "Play on this device" in a stream's menu plays on the phone anyway. The TV has to be awake with StreamFlix on its screen: behind another app it can't be started, and the phone says to open it. A sleeping TV box usually can't be reached at all (a SHIELD gives a sleeping app no network), so wake it with its remote first; one that still answers while asleep with StreamFlix on top is woken. How the two talk is at the top of `tv/app/src/main/java/com/notdxbi/dxbi/tv/TvReceiver.kt`: plain HTTP on the home network, port 47821, only for phones allowed on the TV's screen.

## 2.38.3-simkl.4 (custom build)

- **TV: what closed the player on a long skip.** Seen happen at last, on a SHIELD with the build before simkl.3: the skip button held for twenty-odd seconds, then "Source error" and the player gone. A held button repeats about twenty times a second and each repeat opened the stream again; after a few hundred of those the stream's server answered 429, "too many requests", and the player gave up. Since simkl.3 a hold goes as one skip when the button is let go, and the same hold (and one of forty seconds) plays on.
- **TV: a held skip button speeds up.** Ten seconds a count for the first second and a half, then thirty seconds, then a minute, then two: twenty minutes is about six seconds of holding and half an hour about eight (simkl.3 had slowed a hold to under a minute of film a second). The label counts along and shows where it will land: "+22 min 10 s   23:23".
- **TV: a skip never lands on the very end.** A held button runs to the end of the film, and a skip that landed there ended the play (marked watched, the next episode starting) or sat there loading. Skips now stop ten seconds short of the end.
- **TV: a busy server is waited for.** When a stream's server answers "too many requests" or "busy", the player says so, waits three seconds (then six, then nine) and carries on from where it stood, three times before it gives up.

## 2.38.3-simkl.3 (custom build)

- **TV: the app no longer runs out of memory while a film plays.** The player keeps what it has loaded of the video in the app's own memory, about 144 MB of it for a 4K film, and a TV box allows an app 192 MB unless it asks for more. With the page's share on top, dx.bi sat at 173 MB of 187 all through a film (measured on a SHIELD TV Pro). Past three quarters of the allowance Android destroys the app's screens that aren't showing, so the main screen and its page were thrown away about half a minute into each film (Back then took twelve seconds while it all loaded again, and nothing reached Stremio or Simkl meanwhile), and a skip that makes the player load from a new place asked for more memory when there was none left. The app now asks for the large allowance (512 MB on a SHIELD) and uses 150 MB of it.
- **TV: the player survives the screen changing.** A TV coming on, an HDMI link settling or the HDR mode changing is a change of the screen to Android, which destroyed the player and made it again, and a player made again closed. The main screen was built again the same way, and its page started over from Home. Both screens take every such change themselves now.
- **TV: skipping forwards and back holds up.** Presses that follow each other quickly add up and go as one skip ("+40 s"), a held button counts a few times a second and not twenty, a debrid stream's link is followed once a play instead of at every skip, and a play that fails after a skip starts again from where it stood (twice at most) before it is given up.
- **TV: going back is remembered.** Leave after skipping back and the next play starts from where you left, not from the furthest point you had reached. (Stremio only moves its saved place forwards for plain progress; a skip is now told to it as a skip.)
- **TV: a title opens with its best match selected.** The best match is selected as the streams come up, so OK plays it with no press before, and it stays on the best match while addons are still answering. Press any button and the selection is yours. Back from the player, the stream you played is selected again.
- **TV: the Trailer is one press away.** Left from any stream goes to the Trailer button, and when the trailer closes the selection is back on the stream you left.
- **TV: the best match and the Trailer stand out.** The best match has a gold frame, an orange quality tile and a gold Best match label; the Trailer button is bright blue.
- **TV: no subtitles start by themselves.** Thai subtitles are still found, but stay off until you pick one, and a release's own subtitle track marked "default" stays off too. dx.bi settings → Subtitles → **Start with Thai subtitles** brings the old behaviour back.
- **TV: Thai and English at the top of the subtitles menu, and only those are fetched.** The player's subtitles button lists Off, then Thai, then English, then the file's own other languages. With **Only Thai and English subtitles** (on in this build) nothing else is handed to the player: it fetches every subtitle file it is handed as a video starts, and two files in each of forty languages was eighty requests at once, most of them answered "too many requests" by the subtitle addon's server.
- **TV: a diary for the next problem.** The app keeps a short log on the device of its screens being made and destroyed, the player opening, skipping, failing and closing, and any crash with its trace (`adb shell cat /sdcard/Android/data/com.notdxbi.dxbi.tv/files/diary.txt`). No titles are in it, and no addresses beyond a host name.

## 2.38.3-simkl.2 (custom build)

- **TV: the stream list no longer freezes the remote.** Going from a title's streams up to the Sort and filter buttons stopped everything for three to four seconds on a title with a few hundred streams (4.4 seconds for one press, measured on a SHIELD TV Pro with 309 streams), and the presses made meanwhile were lost. There were two causes. The browser was told to skip stream rows out of view, and Android's browser lays every skipped row out again, one at a time, whenever a button takes the selection. And the bar's controls were form buttons, which make Android's browser ask every element of the page whether it can take focus. On a TV the rows are no longer skipped (they are drawn a few to a frame, as before) and the bar's controls are plain elements. The same press now takes about 75 ms.
- **TV: the Sort and filter buttons can be reached after scrolling.** On the redesigned title page the bar scrolls away with the list, and Up from the first stream went past it to the addon tabs. It goes to the bar now, wherever the list is.
- **TV: Back closes an open Sort or filter menu** instead of leaving the title.
- **TV: Settings' menu works with the remote.** Left goes from a section into the menu and Right back out (the menu was taken for the top bar, and couldn't be entered from the side at all). dx.bi's entries there look like Stremio's own (they were in capitals), and Back from what an entry opened returns to that entry.

## 2.38.3-simkl.1 (custom build)

- **Up to date with dx.bi 2.38.3.** Everything upstream changed from 2.27 to 2.38.3 is in, with this build's Simkl lists and scrobbling, stream order (a release site first, English dubs first, flags), Thai subtitles and TV engine kept.
- **Title pages work again.** Stremio redesigned its title page in November 2026 (streams in a panel grouped by addon, new buttons, new facts line). The 2.26.0-simkl builds found none of it: no clean stream rows, no sort and filter bar, no Reviews or Hide, no Ends at, no scores. All of it finds its place on the new page, and still on the old one.
- **TV: the remote steps through the new stream list row by row**, in the order shown, across addon groups.
- **TV: dx.bi is back in Settings.** Stremio's new Settings page is a menu on the left with one page at a time, and dx.bi's entries (dx.bi settings, Who's watching?, Simkl, Customise Home, Streaming server, Report a problem) had nowhere to go, so on a TV there was no way to open them. They're a **dx.bi** group at the top of that menu now.
- **TV: a title's page comes up at once.** The new page fades its picture in and slides its content up, stream rows and all; on a TV both are switched off, like every other entrance.
