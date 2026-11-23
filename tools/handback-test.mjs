// Back from dx.bi TV's native player: the page never plays the film itself, and never stays on
// Stremio's player screen. The parts of tv/app/src/main/assets/dxbi-tv.js that see to it, run against
// a stand-in page.
//
//   node tools/handback-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tvSource = readFileSync(join(root, "tv", "app", "src", "main", "assets", "dxbi-tv.js"), "utf8").replace(/\r\n/g, "\n");
const slice = (from, to) => {
  const a = tvSource.indexOf(from);
  const b = tvSource.indexOf(to, a);
  assert.ok(a > 0 && b > a, `found ${from.trim()}`);
  return tvSource.slice(a, b);
};

// The stand-in page: a media element type with play() and a src property, an address, timers
class Media {
  constructor(tag, inPlayer) { this.tagName = tag; this.inPlayer = inPlayer; this.loaded = null; this.played = 0; this.muted = false; this.paused = true; }
  closest(sel) { return this.inPlayer && /player-container/.test(sel) ? {} : null; }
  pause() { this.paused = true; }
}
const proto = Media.prototype;
proto.play = function () { this.played++; this.paused = false; return Promise.resolve(); };
Object.defineProperty(proto, "src", { configurable: true, enumerable: true, get() { return this.loaded || ""; }, set(v) { this.loaded = v; } });

const page = { hash: "#/", timers: [], replaced: [], state: null };
const sandbox = {
  HTMLMediaElement: Media,
  location: { get hash() { return page.hash; }, replace(h) { page.replaced.push(h); page.hash = h; } },
  setTimeout: (fn, ms) => { page.timers.push({ fn, ms }); return page.timers.length; },
  document: { querySelectorAll: () => [] },
  playerState: async () => page.state,
  Object, Promise, encodeURIComponent,
};
const guards = slice("  let handoff = null;", "  function silenceWebPlayer()");
const detail = slice("  // The title's page a player screen belongs to", "  async function startHandoff()");
const back = slice("  // Back from the native player goes back a screen", "  async function closeHandoff(");
const api = vm.runInNewContext(`${guards}\n${detail}\n${back}\n({ setHandoff: (h) => { handoff = h; }, detailOf, leavePlayerScreen })`, sandbox);

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const run = async () => { for (const t of page.timers.splice(0)) await t.fn(); await new Promise((r) => setImmediate(r)); };
const PLAYER = "#/player/eAEBawOU/x/y/movie/tt6751668/tt6751668";

await test("on Stremio's player screen its video neither loads nor plays, with or without a stream handed over", async () => {
  for (const handed of [{ hash: PLAYER }, null]) {
    api.setHandoff(handed);
    page.hash = PLAYER;
    const v = new Media("VIDEO", true);
    v.src = "https://torrentio.example/resolve/film.mkv";
    await v.play();
    assert.equal(v.loaded, null, "no address taken");
    assert.equal(v.played, 0, "not played");
    assert.equal(v.muted, true);
  }
});

await test("anywhere else, video plays as ever (the intro film, a trailer, dx.bi's previews)", async () => {
  api.setHandoff(null);
  page.hash = "#/detail/movie/tt6751668/tt6751668";
  const v = new Media("VIDEO", false);
  v.src = "intro.mp4";
  await v.play();
  assert.equal(v.loaded, "intro.mp4");
  assert.equal(v.played, 1);
});

await test("a title's page from the player screen: its list of streams, or its episode's", () => {
  assert.equal(api.detailOf({ selected: { metaRequest: { path: { type: "movie", id: "tt6751668" } }, streamRequest: { path: { id: "tt6751668" } } } }), "#/detail/movie/tt6751668/tt6751668");
  assert.equal(api.detailOf({ selected: { metaRequest: { path: { type: "series", id: "tt0903747" } }, streamRequest: { path: { id: "tt0903747:1:2" } } } }), "#/detail/series/tt0903747/tt0903747%3A1%3A2");
  assert.equal(api.detailOf(null), "");
});

await test("Back from the native player, and the page still on the player screen a moment later: taken to the title's page", async () => {
  api.setHandoff(null);
  page.hash = PLAYER;
  page.replaced.length = 0;
  api.leavePlayerScreen("#/detail/movie/tt6751668/tt6751668");
  assert.equal(page.timers.length, 1);
  assert.equal(page.timers[0].ms, 1500);
  await run();
  assert.deepEqual(page.replaced, ["#/detail/movie/tt6751668/tt6751668"]);
});

await test("…with nothing kept of the title, it asks Stremio which title the player screen was showing", async () => {
  api.setHandoff(null);
  page.hash = PLAYER;
  page.replaced.length = 0;
  page.state = { selected: { metaRequest: { path: { type: "series", id: "tt0903747" } }, streamRequest: { path: { id: "tt0903747:1:2" } } } };
  api.leavePlayerScreen("");
  await run();
  assert.deepEqual(page.replaced, ["#/detail/series/tt0903747/tt0903747%3A1%3A2"]);
});

await test("left already, or a new stream handed over meanwhile (the next episode): nothing done", async () => {
  page.replaced.length = 0;
  api.setHandoff(null);
  page.hash = "#/detail/movie/tt6751668/tt6751668";
  api.leavePlayerScreen("#/detail/movie/tt6751668/tt6751668");
  await run();
  page.hash = PLAYER;
  api.leavePlayerScreen("#/detail/movie/tt6751668/tt6751668");
  api.setHandoff({ hash: PLAYER, pending: true });
  await run();
  assert.deepEqual(page.replaced, []);
});

await test("the hand-back wiring: a stream remembers its title's page, and closing goes back then checks", () => {
  assert.match(tvSource, /handoff = \{ hash, videoId, started: Date\.now\(\), detail: detailOf\(state\), creditsAt: [^}]+\};/);
  assert.match(tvSource, /history\.back\(\);\n\s+leavePlayerScreen\(detail\);/);
  assert.match(tvSource, /if \(!url\) \{\n\s+handoff = null;\n\s+history\.back\(\);/, "a stream the native player can't take goes back to the list");
});

console.log(`\nALL PASS (${passed} cases)`);
