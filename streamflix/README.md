# StreamFlix

StreamFlix is [dx.bi](https://github.com/notdxbi/dxbi-stremio), a Netflix-style skin and set of apps
for [Stremio](https://www.stremio.com), under another name and with some changes of its own
([CHANGES.md](CHANGES.md)): Simkl, a steadier Android TV app, Thai subtitles. It is free software under
the same licence as dx.bi, the GNU General Public License version 3 or later ([LICENSE](../LICENSE),
[NOTICE.md](../NOTICE.md)). dx.bi's name and logo are dx.bi's; this copy uses neither. StreamFlix is
not affiliated with dx.bi, Stremio or any streaming service.

What you watch and where it comes from is your responsibility: follow the laws where you live.

## The apps

| For | File on the [latest release](https://github.com/ByteSizeData/streamflix/releases/latest) |
|---|---|
| An Android TV, Google TV or Fire TV box | `streamflix-tv.apk` |
| An Android phone or tablet | `streamflix-mobile.apk` |
| An iPad or iPhone (iOS / iPadOS 18 or later) | `streamflix.ipa` |

- **Android TV:** with the Downloader app, open
  `github.com/ByteSizeData/streamflix/releases/latest/download/streamflix-tv.apk` and install it.
- **Android phone or tablet:** open
  `github.com/ByteSizeData/streamflix/releases/latest/download/streamflix-mobile.apk` in the browser
  and install it.
- **iPad or iPhone:** the IPA isn't signed. Give it to a signing service or sideloading app
  (Signulous, SideStore, AltStore, Sideloadly), which signs it for your device and installs it.
  Torrents don't play on the device itself: debrid streams do, and torrents need Stremio's streaming
  server on a computer on the same Wi-Fi.

Then sign in to Stremio in the app, or add your addons to it. Nothing of that is in the app file:
sign-ins, addons and keys are typed on the device and stay there.

## How it keeps itself current

1. **Stremio itself** is never out of date: the apps run Stremio's own web app, which updates on its
   own.
2. **The skin** (the plugin, most of what changes from release to release): every app looks at this
   repository's latest release when it opens, and every few hours after, and fetches a newer plugin
   by itself. It is used from the next start. Nothing to press, on Android and on iPad alike.
3. **The app itself:**
   - *Android:* the app says a new one is out. **Update** downloads it, and Android asks once more
     before it installs (Android gives a TV app no way round that question; the first time it also
     asks to allow StreamFlix to install apps). A phone on Android 12 or later installs without
     asking.
   - *iPad / iPhone:* Apple lets no app replace itself outside the App Store. The app says a new one
     is out and opens the release: sign and install the new `streamflix.ipa` over the old one with
     your signing service, and your sign-in and settings stay. Because of step 2 this is rarely
     urgent: only changes to the app's own code need it.
4. **New dx.bi versions:** the workflow [Follow dx.bi](../.github/workflows/follow-dxbi.yml) looks
   every six hours. When dx.bi has a new release it lays its changes over this branch, checks the
   scripts and runs the tests, publishes a StreamFlix release of it and starts the app builds. When
   dx.bi's changes clash with StreamFlix's own it changes nothing and opens an issue here: that
   merge needs doing by hand.

## How a release is made

The branch `streamflix` keeps dx.bi's name and dx.bi's version lines in its sources, so that dx.bi's
releases merge into it without a clash. A release is that branch with [brand.mjs](brand.mjs) run over
it (the name, the pictures in [art/](art), the version), committed under a tag: the tag holds exactly
the source the apps were built from. [release.mjs](release.mjs) does it:

```sh
node streamflix/release.mjs                 # GitHub builds the apps
node streamflix/release.mjs --apks          # the Android apps are built and signed here
```

Versions are dx.bi's with StreamFlix's own count in the last part: dx.bi 2.38.4 gives 2.38.401,
2.38.402 and so on; dx.bi 2.38.5 gives 2.38.501.

Android only installs an update signed with the same key as the app it replaces. For GitHub to build
the Android apps, the key goes into the repository's secrets (Settings → Secrets and variables →
Actions): `STREAMFLIX_KEYSTORE_B64` (the keystore file, base64-encoded) and
`STREAMFLIX_KEYSTORE_PASSWORD` (alias `streamflix`). Without them the workflow builds nothing and the
APKs are attached from a computer that has the key. The IPA needs no key.

GitHub switches a scheduled workflow off after sixty days in which nothing changed in the
repository, and says so by email: switch Follow dx.bi back on under Actions when that happens.

## What isn't here yet

- The computer app (Windows, macOS, Linux) is still dx.bi's in this branch and isn't released from it.
- "Report a problem" in the phone apps still describes dx.bi's Discord. Problems with StreamFlix
  belong in this repository's issues, not with dx.bi.
- The iPad uses the iPhone app's screens, as dx.bi's does.
