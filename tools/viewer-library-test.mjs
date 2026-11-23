// node tools/viewer-library-test.mjs: a library for each viewer, and none of it in the way of a single one
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// (a Windows checkout has CRLF line ends; the markers below are looked for with LF)
const source = readFileSync(join(root, "dxbi.plugin.js"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("  const VIEWER_COLOURS =");
const end = source.indexOf("  function initials(name)");
assert.ok(start > 0 && end > start, "viewers and viewerLibrary found in the plugin");
const code = source.slice(start, end);
const clone = (x) => JSON.parse(JSON.stringify(x));

// A device: dx.bi's saved data, and Stremio's library as its localStorage has it
function device({ viewers: saved, owners, dismissed, library }) {
  const local = new Map([["library", JSON.stringify({ items: library || {} })]]);
  const store = {
    data: {},
    get(k, f) { const e = this.data[k]; return e && e.v !== undefined ? e.v : f; },
    set(k, v) { this.data[k] = { t: Date.now(), v }; },
  };
  if (saved) store.set("viewers", clone(saved));
  if (owners) store.set("libraryOwners", clone(owners));
  for (const [id, times] of Object.entries(dismissed || {})) store.set(`cwDismissed:${id}`, clone(times));
  const events = [];
  const calls = []; // what a switch of viewer does, and as whom
  const timers = [];
  const keptCore = { getState: null, dispatch: null };
  const out = vm.runInNewContext(`let coreHook = null;\n${code}\n({ viewers, viewerLibrary, hook: () => coreHook })`, {
    store, keptCore,
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
    window: { onCoreEvent: (e) => events.push(e.name) },
    core: () => ({ getState: keptCore.getState, dispatch: keptCore.dispatch }),
    stats: { flush() { calls.push(`stats.flush as ${out.viewers.current().id}`); }, load() { calls.push(`stats.load as ${out.viewers.current().id}`); } },
    playback: {}, restrict: { apply() { calls.push("restrict.apply"); } }, hero: { reset() {} },
    preview: { library: { at: 1 } }, libraryWatched: { at: 1 }, episodes: { index: new Map(), at: 1, version: 0 },
    scheduleSync() {}, log() {}, setTimeout: (fn) => { timers.push(fn); return timers.length; },
    Date, JSON, Object, Array, String, Number, Map, Set, Promise,
  });
  return { ...out, store, local, events, calls, keptCore, later: () => { while (timers.length) timers.shift()(); } };
}

// Stremio's core: a fresh copy of its state at each read, and a note of each action it's given
function stremio(states) {
  const done = [];
  const live = { getState: async (model) => clone(states[model]), dispatch: async (action) => { done.push(action.args.action + ":" + (action.args.args.id || action.args.args)); } };
  return { live, done, getState: live.getState, dispatch: live.dispatch };
}

const item = (id, lastWatched = "2026-01-10T00:00:00.000Z") => ({ _id: id, name: id, state: { lastWatched }, removed: false, temp: false });
const card = (id, inLibrary, watched) => ({ id, type: "movie", inLibrary, watched, deepLinks: { player: null } });
const ids = ["tt1", "tt2", "tt3", "tt4", "tt5"];
const states = {
  library: { catalog: ids.map((id) => item(id)) },
  continue_watching_preview: { items: ids.map((id) => ({ libraryItem: item(id) })) },
  board: { catalogs: [{ content: { type: "Ready", content: [card("tt1", true, true), card("tt2", true, true), card("tt9", false, false)] } }] },
  meta_details: { libraryItem: item("tt2"), metaItem: { content: { type: "Ready", content: { id: "tt2", inLibrary: true, watched: true, videos: [{ id: "tt2:1:1", watched: true, progress: 0.5 }] } } } },
};
const library = Object.fromEntries(ids.map((id) => [id, item(id)]));
const family = (current) => ({ list: [{ id: "main", name: "Dad" }, { id: "v2", name: "Mum" }], current });
// tt2 is Mum's, tt3 is shared, nobody has tt5 any more; the rest was there before there were viewers
const owners = { tt2: ["v2"], tt3: ["main", "v2"], tt5: [] };
const titles = (state) => (state.catalog || state.items).map((i) => (i.libraryItem || i)._id);

// One viewer: Stremio's core is left exactly as it was, and isn't asked to read anything again
{
  const d = device({ owners, library });
  const s = stremio(states);
  d.hook()(s.live);
  d.later();
  assert.equal(s.live.getState, s.getState, "its getState is its own");
  assert.equal(s.live.dispatch, s.dispatch, "and its dispatch");
  assert.equal(d.events.length, 0, "nothing read again as dx.bi starts");
  assert.deepEqual(titles(await d.keptCore.getState("library")), ids, "dx.bi's own reads: the whole library");
  assert.equal(d.viewerLibrary.mine("tt2"), true);
  console.log("PASS one viewer: Stremio's core is left alone");

  // …until a second viewer arrives, while dx.bi runs
  const mum = d.viewers.add("Mum");
  d.viewers.select(mum.id);
  d.later();
  assert.notEqual(s.live.getState, s.getState, "Stremio now reads through the viewer's library");
  assert.ok(d.events.includes("NewState"), "and reads its library again");
  assert.deepEqual(titles(await s.live.getState("library")), [], "a new viewer starts with an empty library");
  d.viewers.select("main");
  assert.deepEqual(titles(await s.live.getState("library")), ["tt1", "tt3", "tt4"], "the first viewer keeps what nobody else claimed");
  d.viewers.remove(mum.id);
  assert.deepEqual(titles(await s.live.getState("library")), ids, "one viewer again: everything");
  console.log("PASS a second viewer arriving, and leaving, while dx.bi runs");
}

// Two viewers: each sees their own
{
  const dad = device({ viewers: family("main"), owners, library });
  const s = stremio(states);
  dad.hook()(s.live);
  assert.notEqual(s.live.getState, s.getState, "wrapped from the start");
  dad.later();
  assert.ok(dad.events.includes("NewState"), "what Stremio read before dx.bi started is read again");
  assert.deepEqual(titles(await s.live.getState("library")), ["tt1", "tt3", "tt4"]);
  const board = (await s.live.getState("board")).catalogs[0].content.content;
  assert.deepEqual(board.map((c) => [c.id, c.inLibrary, c.watched]), [["tt1", true, true], ["tt2", false, false], ["tt9", false, false]], "Mum's title isn't marked as his");
  const page = await s.live.getState("meta_details");
  assert.equal(page.libraryItem, null, "nor in his library on its page");
  assert.deepEqual(page.metaItem.content.content.videos[0], { id: "tt2:1:1", watched: false, progress: null }, "nor part-watched");

  const mum = device({ viewers: family("v2"), owners, library });
  const t = stremio(states);
  mum.hook()(t.live);
  assert.deepEqual(titles(await t.live.getState("library")), ["tt2", "tt3"]);
  assert.equal((await t.live.getState("meta_details")).libraryItem._id, "tt2", "her own title's page is as Stremio has it");
  console.log("PASS two viewers: each has their own library and marks");

  // Adding and removing: only what's nobody else's reaches the account's library
  await t.live.dispatch({ action: "Ctx", args: { action: "AddToLibrary", args: { id: "tt1" } } });
  assert.deepEqual(clone(mum.store.get("libraryOwners").tt1), ["main", "v2"], "already the first viewer's: now hers too");
  await s.live.dispatch({ action: "Ctx", args: { action: "RemoveFromLibrary", args: "tt3" } });
  await s.live.dispatch({ action: "Ctx", args: { action: "RemoveFromLibrary", args: "tt4" } });
  assert.deepEqual(s.done, ["RemoveFromLibrary:tt4"], "a shared title stays in the account's library; his own leaves it");
  assert.deepEqual(clone(dad.store.get("libraryOwners").tt3), ["v2"]);
  assert.deepEqual(titles(await s.live.getState("library")), ["tt1"], "and both are gone from his");
  console.log("PASS adding and removing touch the account's library only when nobody else has the title");
}

// The viewer who is watching is removed: her own titles leave the account's library, then the next
// viewer takes over as if picked (her stats were saved over his, and a kids filter stayed on)
{
  const d = device({ viewers: family("v2"), owners: { ...owners, tt5: ["v2"] }, library });
  const s = stremio(states);
  d.hook()(s.live);
  d.later();
  d.calls.length = 0;
  d.events.length = 0;
  d.viewers.remove("v2");
  d.later();
  assert.equal(d.viewers.current().id, "main", "Dad is watching now");
  assert.deepEqual(d.calls, ["stats.flush as v2", "stats.load as main", "restrict.apply"], "her stats saved as hers, his read, the kids filter looked at again");
  assert.ok(d.events.includes("NewState"), "and Stremio reads his library");
  assert.deepEqual(s.done, ["RemoveFromLibrary:tt2", "RemoveFromLibrary:tt5"], "every title that was hers alone leaves the account's library");
  assert.deepEqual(clone(d.store.get("libraryOwners")), { tt3: ["main"] }, "the one they shared stays his");
  assert.deepEqual(d.viewers.list().list.map((x) => x.id), ["main"]);
  console.log("PASS removing the viewer who is watching switches to the next one");
}

// Dismissed from Continue Watching by one viewer, until it's played again. The account's library is read
// through again only when Stremio has saved it anew (it was parsed whole for every dismissed title at every read)
{
  const d = device({ viewers: family("main"), owners: { tt4: ["main", "v2"] }, dismissed: { main: { tt4: Date.parse("2026-02-01T00:00:00.000Z") } }, library });
  const s = stremio(states);
  d.hook()(s.live);
  assert.deepEqual(titles(await s.live.getState("continue_watching_preview")), ["tt1", "tt2", "tt3", "tt5"]);
  const first = d.viewerLibrary.raw();
  assert.equal(d.viewerLibrary.raw(), first, "nothing saved since: the same copy");
  d.local.set("library", JSON.stringify({ items: { ...library, tt4: item("tt4", "2026-03-01T00:00:00.000Z") } }));
  // (a title two viewers share shows in Continue Watching for the one who has a place of their own in it:
  // playing it is what gives him one)
  d.store.set("progress:main", { tt4: { v: "tt4", t: 60000, d: 6000000, at: Date.parse("2026-03-01T00:00:00.000Z") } });
  assert.notEqual(d.viewerLibrary.raw(), first, "saved anew: read through again");
  assert.deepEqual(titles(await s.live.getState("continue_watching_preview")), ["tt4", ...ids.filter((id) => id !== "tt4")], "played again: back at once, the newest first");
  console.log("PASS a dismissed title stays out until it's played again");
}
process.exit(0);
