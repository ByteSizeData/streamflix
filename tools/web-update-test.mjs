// dx.bi TV takes Stremio's web updates itself: the `webUpdate` part of tv/app/src/main/assets/dxbi-tv.js,
// run against a stand-in page. Stremio shows "A new version of Stremio is available · Reload the user
// interface" when its service worker has a new build waiting; the TV hides the bar and presses its button
// when nobody is in the middle of anything (as the page starts, when the app says dx.bi has left the
// screen, when the remote has been down for a while), never while the native player has a stream, and
// looks for a new build itself when dx.bi comes back to the front and every few hours.
//
//   node tools/web-update-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tvSource = readFileSync(join(root, "tv", "app", "src", "main", "assets", "dxbi-tv.js"), "utf8").replace(/\r\n/g, "\n");

// The page's stand-in: the bar (with its button and ×) is there or not
const page = { banner: null, clicks: [], storage: new Map(), open: null, listeners: {}, updates: 0, now: 1_000_000_000 };
const element = (name) => ({ name, click() { page.clicks.push(name); } });
const bar = () => ({
  querySelector: (sel) => (/not\(\[class\*="close"\]\)/.test(sel) ? element("Reload the user interface") : element("×")),
});
// (the clock is the test's, so "four minutes later" is one line)
const clock = { now: () => page.now };
const timers = [];
const sandbox = {
  document: { querySelector: (sel) => (sel === '[class*="web-update-banner"] [role="status"]' ? page.banner : sel === ".dxe-modal, .dxe-who, .dxe-theatre, .dxe-trailer" ? page.open : null) },
  localStorage: { getItem: (k) => (page.storage.has(k) ? page.storage.get(k) : null), setItem: (k, v) => page.storage.set(k, v) },
  console: { log() {} },
  Date: clock,
  location: { hash: "#/" },
  navigator: { serviceWorker: { getRegistration: () => ({ then(fn) { fn({ update() { page.updates++; } }); return { catch() {} }; } }) } },
  window: { addEventListener: (type, fn) => { page.listeners[type] = fn; } },
  handoff: null,
  resuming: false,
  openModal: null,
  native: { activePlayback: () => "" },
  tv: {},
  setInterval: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length; },
  clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].on = false; },
};
const a = tvSource.indexOf("  const webUpdate = {");
const b = tvSource.indexOf("  // ---------------------------------------------------------------------------\n  // Load the built-in dx.bi plugin", a);
assert.ok(a > 0 && b > a, "webUpdate found in dxbi-tv.js");
const webUpdate = vm.runInNewContext(`${tvSource.slice(a, b)}\nwebUpdate`, sandbox);

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };
const reset = () => {
  page.banner = null; page.clicks.length = 0; page.storage.clear(); page.open = null; page.updates = 0; timers.length = 0;
  sandbox.handoff = null; sandbox.resuming = false; sandbox.openModal = null; sandbox.location.hash = "#/"; sandbox.native.activePlayback = () => "";
  delete sandbox.navigator.onLine; delete sandbox.window.__dxbi;
  webUpdate.used = page.now; webUpdate.checked = page.now;
};
const later = (ms) => { page.now += ms; };

test("nothing waiting: nothing pressed", () => {
  reset();
  assert.equal(webUpdate.apply("background"), false);
  assert.deepEqual(page.clicks, []);
});

test("an update waiting and nobody watching: the bar's button is pressed, not its ×", () => {
  reset();
  page.banner = bar();
  assert.equal(webUpdate.apply("background"), true);
  assert.deepEqual(page.clicks, ["Reload the user interface"]);
  assert.ok(Number(page.storage.get("dxtv-web-update")) > 0, "the time is kept");
});

test("a build that keeps coming back isn't pressed again within half an hour", () => {
  reset();
  page.banner = bar();
  assert.equal(webUpdate.apply("start"), true);
  assert.equal(webUpdate.apply("background"), false);
  assert.equal(page.clicks.length, 1);
  later(webUpdate.HOLD_MS + 1);
  assert.equal(webUpdate.apply("background"), true);
  assert.equal(page.clicks.length, 2);
});

test("never while the native player has a stream (the page keeps its watch progress)", () => {
  reset();
  page.banner = bar();
  sandbox.handoff = { hash: "#/player/x" };
  assert.equal(webUpdate.apply("background"), false);
  sandbox.handoff = null;
  sandbox.resuming = true;
  assert.equal(webUpdate.apply("start"), false);
  sandbox.resuming = false;
  sandbox.native.activePlayback = () => '{"hash":"#/player/x"}';
  assert.equal(webUpdate.apply("start"), false);
  assert.deepEqual(page.clicks, []);
  sandbox.native.activePlayback = () => "";
  assert.equal(webUpdate.apply("background"), true);
});

test("as the page starts: taken as soon as Stremio shows it, and only while the page is still starting", () => {
  reset();
  webUpdate.watch();
  const [starting] = timers;
  starting.fn();
  assert.equal(starting.on, true, "nothing yet: keeps watching");
  page.banner = bar();
  starting.fn();
  assert.deepEqual(page.clicks, ["Reload the user interface"]);
  assert.equal(starting.on, false, "taken: the watch stops");

  reset();
  webUpdate.watch();
  later(webUpdate.START_MS + 1);
  page.banner = bar();
  timers[0].fn();
  assert.deepEqual(page.clicks, [], "found once the page is in use: not now");
  assert.equal(timers[0].on, false);
});

test("found while dx.bi is on: taken once the remote has been down for a while, with nothing open", () => {
  reset();
  webUpdate.watch();
  const idle = timers[1];
  page.banner = bar();
  later(webUpdate.IDLE_MS - 1000);
  idle.fn();
  assert.deepEqual(page.clicks, [], "the remote was in use a moment ago");
  page.listeners.keydown();
  later(webUpdate.IDLE_MS + 1);
  sandbox.location.hash = "#/player/abc";
  idle.fn();
  assert.deepEqual(page.clicks, [], "a stream is on");
  sandbox.location.hash = "#/detail/movie/tt1";
  sandbox.openModal = {};
  idle.fn();
  assert.deepEqual(page.clicks, [], "a dialog is open");
  sandbox.openModal = null;
  page.open = {};
  idle.fn();
  assert.deepEqual(page.clicks, [], "one of dx.bi's own (Simkl, a trailer, Who's watching) is open");
  page.open = null;
  idle.fn();
  assert.deepEqual(page.clicks, ["Reload the user interface"]);
});

test("never on a player screen, even once the stream is handed back (Up next still looking for the next episode)", () => {
  reset();
  page.banner = bar();
  sandbox.location.hash = "#/player/finished-episode";
  assert.equal(webUpdate.apply("background"), false, "the page would come back on it and play it again");
  assert.equal(webUpdate.apply("start"), false);
  assert.equal(sandbox.tv.hidden(), false, "Home pressed in those seconds");
  assert.deepEqual(page.clicks, []);
  sandbox.location.hash = "#/detail/series/tt1";
  assert.equal(sandbox.tv.hidden(), true);
});

test("never while the browser says there's no network (the page would come back with every row failing)", () => {
  reset();
  page.banner = bar();
  sandbox.navigator.onLine = false;
  assert.equal(webUpdate.apply("background"), false);
  assert.equal(webUpdate.apply("idle"), false);
  assert.deepEqual(page.clicks, []);
  sandbox.navigator.onLine = true;
  assert.equal(webUpdate.apply("background"), true);
});

test("never in a watch party (the reload would leave it)", () => {
  reset();
  page.banner = bar();
  sandbox.window.__dxbi = { partyInfo: () => ({ code: "ABC-DEF", people: ["Sam"] }) };
  assert.equal(webUpdate.apply("idle"), false, "waited in on Home for minutes, nobody pressing anything");
  assert.equal(sandbox.tv.hidden(), false);
  assert.deepEqual(page.clicks, []);
  sandbox.window.__dxbi = { partyInfo: () => null };
  assert.equal(webUpdate.apply("idle"), true, "out of the party");
});

test("leaving the screen with something open keeps it for the way back", () => {
  reset();
  page.banner = bar();
  sandbox.openModal = {};
  assert.equal(sandbox.tv.hidden(), false, "a dialog");
  sandbox.openModal = null;
  page.open = {};
  assert.equal(sandbox.tv.hidden(), false, "one of dx.bi's own");
  assert.deepEqual(page.clicks, []);
  page.open = null;
  assert.equal(sandbox.tv.hidden(), true);
});

test("the TV looks for a new build itself: back at the front, and every few hours", () => {
  reset();
  webUpdate.watch();
  const idle = timers[1];
  idle.fn();
  assert.equal(page.updates, 0, "looked a moment ago");
  later(webUpdate.CHECK_MS + 1);
  idle.fn();
  assert.equal(page.updates, 1);
  idle.fn();
  assert.equal(page.updates, 1, "not again until the next few hours are up");
  later(60 * 1000);
  sandbox.tv.shown();
  assert.equal(page.updates, 2, "dx.bi is back on screen");
  assert.equal(webUpdate.used, page.now, "and coming back counts as using it");
});

test("the page hides the bar, and the app says when dx.bi leaves and comes back", () => {
  assert.match(tvSource, /\[class\*="web-update-banner"\] \{ display: none !important; \}/);
  page.banner = bar();
  reset();
  page.banner = bar();
  assert.equal(sandbox.tv.hidden(), true, "leaving the screen takes a waiting update");
  assert.match(tvSource, /^\s+webUpdate\.watch\(\);$/m, "watched from the page's start");
  const activity = readFileSync(join(root, "tv", "app", "src", "main", "java", "com", "notdxbi", "dxbi", "tv", "MainActivity.kt"), "utf8");
  const onStop = activity.slice(activity.indexOf("override fun onStop()"));
  assert.match(onStop, /PlaybackBus\.activePlayback == null[\s\S]{0,200}?__dxbiTv\.hidden\(\)/, "onStop tells the page, unless a stream plays");
  assert.match(activity, /__dxbiTv\.shown\(\)/, "and the page hears when dx.bi is back");
});

console.log(`\nALL PASS (${passed} cases)`);
