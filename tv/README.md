# dx.bi TV

dx.bi for Android TV, Google TV and Fire TV (Fire OS). For what it does and how to install it, see the [main README](../README.md#dxbi-tv-android-tv-google-tv-and-fire-tv).

How it works:

- `MainActivity` shows Stremio's web app (web.stremio.com) in a WebView laid out 1280 CSS pixels wide, with a desktop browser's identity plus `dxbi-tv/<version>` (the plugin recognises it and switches to its TV mode).

- `assets/dxbi-tv.js` runs in the page before Stremio's own scripts. It stands in for Stremio Enhanced's plugin API (settings, alerts, prompts), loads the dx.bi plugin, adds a remote-friendly *dx.bi settings* entry to Stremio's Settings, and handles the remote's Back button.

- Playback: when Stremio opens its player, the stream (with its headers, subtitles and saved position) is handed to `PlayerActivity`, a Media3/ExoPlayer player. Stremio's player screen stays underneath, silent, and gets `TimeChanged` / `PausedChanged` / `Ended` from the native player, so Continue Watching and watched marks work as usual.

- Thai subtitles (dx.bi settings → Thai subtitles, on by default): as soon as a film's or an episode's streams are on screen, `ThaiSubtitles` asks OpenSubtitles' REST API (rest.opensubtitles.org, as `dxbi-tv/<version>`) for its Thai files by its IMDb id, and nothing else; the stream's release name, when it's known in time, only picks between the answers on the TV. The best one or two are kept for the title in the app's cache (20 MB at most), without the adverts OpenSubtitles puts in them, and the player starts with Thai on whenever there's a Thai file. One that comes after the video started is added once, with a short wait for the picture.

- The dx.bi plugin is the one at the repository root, copied in at build time. `Updates` keeps a newer copy from GitHub between app releases, and offers new app releases (downloaded and handed to Android's installer). A custom build, whose plugin `@version` carries a suffix (`2.26.0-simkl.1`), is left alone: the suffix goes into the app's version name, and `Updates` then fetches and offers nothing, so upstream's plugin never replaces the custom one.

- Torrents need a Stremio streaming server elsewhere on the network (Settings → Streaming); debrid streams play directly.

## dx.bi for Android phones

The same code builds a second app, `com.notdxbi.dxbi.mobile`, as the `mobile` product flavor (`tv` is dx.bi TV). They're released and updated separately: `dxbi-tv.apk` and `dxbi-mobile.apk`, from the same release.

- dx.bi TV is unchanged by it. The phone app's code, resources, libraries and manifest additions are all in `app/src/mobile/`; dx.bi TV's code calls into it at a few places through a `Phone` object (see `PhoneHooks.kt`), which `app/src/tv/` defines as doing nothing. dx.bi TV's APK has none of the phone app in it.
- The page still does Stremio's work underneath, laid out but covered by native Compose screens (`src/mobile/…/phone/`): `Phone.attach` adds them to `MainActivity`, and `src/mobile/assets/dxbi-engine.js` to the page.
- `dxbi-engine.js` is the screens' way into the page: they ask it to load Stremio's models and dispatch actions (`__dxbiEngine.handle({id, op, args})`), and it sends back the models they watch, trimmed to what they show, through `DxbiTV.engine`. dx.bi's own features come from the plugin's `api.phone` (billboard, rows, stream choices, reviews, cast, stats, watch party). The iPhone app uses the same script.
- Playing still goes through Stremio's player route and `dxbi-tv.js`'s handoff, so watch progress, up next and the watch party work as on a TV. On a phone `PlayerActivity` gets `PhonePlayer` (its `PlayerHooks`): `PhoneControls`, `PlayerGestures`, picture-in-picture and a media session. `Phone.Target` sends a stream to another app, a Chromecast (`Cast`) or `Downloads` instead.
- `tools/engine-test.mjs` tests the engine, and `tools/engine-contract-test.mjs` checks the plugin, `dxbi-tv.js` and the bridge still offer what the phone screens rely on.

## Building

Needs JDK 17 or 21 and the Android SDK (platform 35).

```sh
cd tv
./gradlew assembleTvDebug          # dx.bi TV: app/build/outputs/apk/tv/debug/app-tv-debug.apk
./gradlew assembleMobileDebug      # the phone app: app/build/outputs/apk/mobile/debug/app-mobile-debug.apk
./gradlew assembleTvRelease assembleMobileRelease   # signed when tv/keystore.properties (or the DXBI_TV_* variables) exist
adb install -r app/build/outputs/apk/tv/debug/app-tv-debug.apk
```

The phone app also has `assembleMobilePreview`: a release build (as fast, shrunk) signed with the debug key, for trying it on a phone. Its test builds install as `com.notdxbi.dxbi.mobile.dev`, next to the released app, and don't update themselves.

Debug builds can be inspected from `chrome://inspect` on a computer. `tv/keystore.properties` (not in git) points at the release key:

```
storeFile=/path/to/dxbi-tv-release.jks
storePassword=…
keyAlias=dxbi-tv
keyPassword=…
```

Keep that key safe: every update must be signed with the same one, or Android won't install it over the old version. Publishing a release builds `dxbi-tv.apk` and `dxbi-mobile.apk` on GitHub when the key is in the repository's secrets (see `.github/workflows/tv.yml`). The phone app is signed with the same key; as a different app, it updates separately.
