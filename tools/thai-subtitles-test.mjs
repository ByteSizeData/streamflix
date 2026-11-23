// dx.bi TV's Thai subtitles, the page's half: tv/app/src/main/assets/dxbi-tv.js says which title to look
// up (its IMDb id, and the season and episode) as soon as a film's or an episode's streams are on screen,
// then which release the stream is, as soon as it's known and again in the hand-off to the native player,
// and lists the addons' Thai files first. The app (ThaiSubtitles.kt) does the looking up. Run against
// stand-ins for Stremio's player state and the app.
//
//   node tools/thai-subtitles-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tvSource = readFileSync(join(root, "tv", "app", "src", "main", "assets", "dxbi-tv.js"), "utf8").replace(/\r\n/g, "\n");

const page = { saved: {}, player: null, calls: [], played: [] };
const sandbox = {
  PLUGIN: "dxbi.plugin.js",
  // (dx.bi 2.38.4: the handoff writes a line to the log that Report a problem sends; not under test here)
  note: () => {},
  describeStream: () => "",
  readSettings: (plugin) => (plugin === "dxbi" ? page.saved : {}),
  core: () => ({ getState: async (name) => (name === "player" ? page.player : name === "ctx" ? { profile: { settings: { subtitlesLanguage: "eng" } } } : null) }),
  native: {
    thaiSubtitles: (json) => page.calls.push(JSON.parse(json)),
    play: (json) => page.played.push(JSON.parse(json)),
  },
  // (the TV app's bridge: no streaming-server question of its own, and it can download a torrent itself)
  bridge: { torrentUrl: () => "" },
  TOKEN: "t",
  PHONE: false,
  location: { hash: "" },
  history: { back() {} },
  handoff: null,
  playHereOnce: null,
  partySeen: "",
  tv: {},
  window: {},
  silenceWebPlayer() {},
  playerState: async () => page.player,
  accentFor: async () => "#E50914",
  nextLink: () => null,
  nextTitle: () => "",
  NativeVideo: class {},
  ScrobbleVideo: class {},
  setTimeout,
};
const a = tvSource.indexOf("  function subtitleLabel(lang) {");
const b = tvSource.indexOf("  // Watch party: the party works with a video element", a);
assert.ok(a > 0 && b > a, "the subtitle and hand-off parts found in dxbi-tv.js");
const tv = vm.runInNewContext(`${tvSource.slice(a, b)}\n({ thaiOn, thaiLookup, thaiEarly, pickSubtitles, startHandoff })`, sandbox);

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const reset = () => { page.saved = {}; page.player = null; page.calls.length = 0; page.played.length = 0; sandbox.handoff = null; };
const plain = (x) => JSON.parse(JSON.stringify(x));

// Stremio's player state for a debrid stream, ready on the first look
const playerFor = (videoId, stream, subtitles = []) => ({
  selected: {
    stream: { url: "https://debrid.example/file.mkv", ...stream },
    streamRequest: { path: { type: videoId.includes(":") ? "series" : "movie", id: videoId } },
    metaRequest: { path: { id: videoId.split(":")[0] } },
  },
  stream: { type: "Ready", content: { url: "https://debrid.example/file.mkv" } },
  metaItem: { type: "Ready", content: { id: videoId.split(":")[0], name: "A title", videos: [] } },
  libraryItem: null,
  subtitles,
});

await test("on unless switched off in dx.bi settings", () => {
  reset();
  assert.equal(tv.thaiOn(), true);
  page.saved = { thaiSubtitles: false };
  assert.equal(tv.thaiOn(), false);
  page.saved = { thaiSubtitles: true };
  assert.equal(tv.thaiOn(), true);
});

await test("a film: its IMDb id, and the release from the file's name and the stream's title", () => {
  const stream = { name: "Torrentio\n1080p", title: "V.for.Vendetta.2005.1080p.BluRay.x264-SiNNERS\n👤 40 💾 9 GB", behaviorHints: { filename: "V.for.Vendetta.2005.1080p.BluRay.x264-SiNNERS.mkv" } };
  assert.deepEqual(plain(tv.thaiLookup("tt0434409", stream)), {
    imdb: "tt0434409",
    release: "V.for.Vendetta.2005.1080p.BluRay.x264-SiNNERS.mkv\nV.for.Vendetta.2005.1080p.BluRay.x264-SiNNERS\n👤 40 💾 9 GB\nTorrentio\n1080p",
  });
});

await test("an episode: the series' IMDb id, season and episode", () => {
  assert.deepEqual(plain(tv.thaiLookup("tt0903747:1:1", { name: "RD+" })), { imdb: "tt0903747", season: 1, episode: 1, release: "RD+" });
  assert.deepEqual(plain(tv.thaiLookup("tt0903747:0:3", {})), { imdb: "tt0903747", season: 0, episode: 3, release: "" });
});

await test("nothing to look up without an IMDb id: anime ids, a link, nothing", () => {
  for (const id of ["kitsu:1376:1", "mal:20:5", "tmdb:1234", "tt12", "https://example.com/film.mp4", "", undefined, null]) {
    assert.equal(tv.thaiLookup(id, {}), null, String(id));
  }
});

// The page asks as a title's streams come up, before any is picked (the stream page's address)
const early = (hash) => { sandbox.location.hash = hash; tv.thaiEarly(); };

await test("a film's streams on screen: looked up at once, with no stream picked yet", () => {
  reset();
  early("#/detail/movie/tt0434409/tt0434409");
  assert.deepEqual(page.calls, [{ imdb: "tt0434409", release: "" }]);
});

await test("…once per film while the page is open (back to its streams: no second ask)", () => {
  reset();
  early("#/detail/movie/tt0434409/tt0434409");
  early("#/detail/movie/tt0434409/tt0434409?from=search");
  assert.deepEqual(page.calls, []);
});

await test("a film opened without its video in the address (the billboard's More info): asked too, and once", () => {
  reset();
  early("#/detail/movie/tt0111161");
  early("#/detail/movie/tt0111161/tt0111161");
  assert.deepEqual(page.calls, [{ imdb: "tt0111161", release: "" }]);
});

await test("an episode's streams: the series' id, season and episode, as Stremio writes the address", () => {
  reset();
  early("#/detail/series/tt0903747/tt0903747%3A1%3A2");
  early("#/detail/series/tt0903747/tt0903747:1:3");
  assert.deepEqual(page.calls, [{ imdb: "tt0903747", season: 1, episode: 2, release: "" }, { imdb: "tt0903747", season: 1, episode: 3, release: "" }]);
});

await test("nothing asked without a film's or an episode's IMDb id: a series page, anime, a channel, other pages", () => {
  reset();
  for (const hash of ["#/detail/series/tt0903747", "#/detail/series/tt0903747/", "#/detail/series/kitsu%3A1376/kitsu%3A1376%3A1", "#/detail/movie/tmdb%3A1234/tmdb%3A1234",
    "#/detail/tv/tt0000011/tt0000011", "#/detail/channel/tt0000012/tt0000012", "#/discover/x", "#/", "#/detail/movie/tt1/%E0%A4%A"]) early(hash);
  assert.deepEqual(page.calls, []);
});

await test("Thai subtitles off: nothing asked (and asked once they're back on)", () => {
  reset();
  page.saved = { thaiSubtitles: false };
  early("#/detail/movie/tt6751668/tt6751668");
  assert.deepEqual(page.calls, []);
  page.saved = {};
  early("#/detail/movie/tt6751668/tt6751668");
  assert.deepEqual(page.calls, [{ imdb: "tt6751668", release: "" }]);
});

await test("every address change reaches it: onRoute asks on a title's page", () => {
  const at = tvSource.indexOf("  function onRoute() {");
  const body = tvSource.slice(at, tvSource.indexOf("\n  }\n", at));
  assert.ok(at > 0 && /if \(\/\^#\\\/detail\\\/\/\.test\(location\.hash\)\) thaiEarly\(\);/.test(body), body);
  assert.ok(tvSource.includes('window.addEventListener("hashchange", onRoute);'));
});

await test("the addons' Thai files go first, numbered as one language", async () => {
  reset();
  const out = await tv.pickSubtitles([
    { url: "e1", lang: "eng" }, { url: "f1", lang: "fre" }, { url: "t1", lang: "tha" }, { url: "t2", lang: "th" }, { url: "e2", lang: "eng" },
  ]);
  // (only Thai and English are handed over, this build's default: the French file stays behind)
  assert.deepEqual(plain(out).map((s) => `${s.url} ${s.lang} ${s.label}`), ["t1 tha Thai", "t2 th Thai 2", "e1 eng English", "e2 eng English 2"]);
});

await test("every language, with Only Thai and English subtitles off: Thai first, then English, then the rest", async () => {
  reset();
  page.saved = { subtitlesThaiEnglish: false };
  const out = await tv.pickSubtitles([
    { url: "e1", lang: "eng" }, { url: "f1", lang: "fre" }, { url: "t1", lang: "tha" }, { url: "t2", lang: "th" }, { url: "e2", lang: "eng" },
  ]);
  assert.deepEqual(plain(out).map((s) => `${s.url} ${s.lang} ${s.label}`), ["t1 tha Thai", "t2 th Thai 2", "e1 eng English", "e2 eng English 2", "f1 fre French"]);
});

await test("Thai subtitles off: the order is Stremio's subtitle language, then English, as before", async () => {
  reset();
  page.saved = { thaiSubtitles: false, subtitlesThaiEnglish: false };
  const out = await tv.pickSubtitles([{ url: "f1", lang: "fre" }, { url: "t1", lang: "tha" }, { url: "e1", lang: "eng" }]);
  assert.deepEqual(plain(out).map((s) => s.url), ["e1", "f1", "t1"]);
});

await test("a skip is told to Stremio as a skip, so going back is kept as the place to resume from", async () => {
  const at = tvSource.indexOf("tv.onProgress = (timeMs, durationMs, paused, buffering) => {");
  assert.ok(at > 0);
  const body = tvSource.slice(at, at + 1800);
  assert.ok(body.includes("const jumped = !!before && Math.abs(timeMs - (before.time + (before.still ? 0 : gone))) > Math.max(3000, gone * 1.5);"));
  assert.ok(body.includes('action: jumped ? "Seek" : "TimeChanged"'));
});

await test("a film's hand-off: looked up as soon as the stream is known, and the player is told too", async () => {
  reset();
  sandbox.location.hash = "#/player/abc/def/ghi/movie/tt0434409/tt0434409";
  page.player = playerFor("tt0434409", { behaviorHints: { filename: "V.for.Vendetta.2005.720p.BluRay.x264-SiNNERS.mkv" } }, [{ url: "x", lang: "tha" }, { url: "y", lang: "eng" }]);
  await tv.startHandoff();
  assert.deepEqual(page.calls, [{ imdb: "tt0434409", release: "V.for.Vendetta.2005.720p.BluRay.x264-SiNNERS.mkv" }]);
  assert.equal(page.played.length, 1);
  const handed = page.played[0];
  assert.equal(handed.thaiSubtitles, true);
  assert.deepEqual(handed.thaiLookup, page.calls[0]);
  assert.deepEqual(handed.subtitles.map((s) => s.label), ["Thai", "English"]);
});

await test("streams page, then the hand-off: asked first with no stream, then with the stream's name (the app joins them)", async () => {
  reset();
  early("#/detail/movie/tt1375666/tt1375666");
  sandbox.location.hash = "#/player/abc/def/ghi/movie/tt1375666/tt1375666";
  page.player = playerFor("tt1375666", { behaviorHints: { filename: "Inception.2010.1080p.BluRay.x264-anoXmous.mkv" } });
  await tv.startHandoff();
  assert.deepEqual(page.calls, [{ imdb: "tt1375666", release: "" }, { imdb: "tt1375666", release: "Inception.2010.1080p.BluRay.x264-anoXmous.mkv" }]);
  assert.deepEqual(page.played[0].thaiLookup, page.calls[1]);
});

await test("an episode's hand-off", async () => {
  reset();
  sandbox.location.hash = "#/player/abc/def/ghi/series/tt0903747/tt0903747%3A1%3A1";
  page.player = playerFor("tt0903747:1:1", { title: "Breaking.Bad.S01E01.1080p.WEB-DL-BS" });
  await tv.startHandoff();
  assert.deepEqual(page.calls, [{ imdb: "tt0903747", season: 1, episode: 1, release: "Breaking.Bad.S01E01.1080p.WEB-DL-BS" }]);
  assert.deepEqual(page.played[0].thaiLookup, page.calls[0]);
});

await test("an anime with a kitsu id: nothing looked up, but Thai still starts on if an addon has it", async () => {
  reset();
  sandbox.location.hash = "#/player/abc/def/ghi/series/kitsu:1376/kitsu%3A1376%3A1";
  page.player = playerFor("kitsu:1376:1", {}, [{ url: "x", lang: "tha" }]);
  await tv.startHandoff();
  assert.deepEqual(page.calls, []);
  assert.equal(page.played[0].thaiSubtitles, true);
  assert.equal(page.played[0].thaiLookup, null);
});

await test("Thai subtitles off: nothing looked up, and the player is told so", async () => {
  reset();
  page.saved = { thaiSubtitles: false };
  sandbox.location.hash = "#/player/abc/def/ghi/movie/tt6751668/tt6751668";
  page.player = playerFor("tt6751668", {});
  await tv.startHandoff();
  assert.deepEqual(page.calls, []);
  assert.equal(page.played[0].thaiSubtitles, false);
  assert.equal(page.played[0].thaiLookup, null);
});

console.log(`${passed} passed`);
