// node tools/simkl-test.mjs: Simkl in dx.bi, against a pretend Simkl. Signing in (device flow and the
// older PIN flow), the requests' retries, the Home rows built from Simkl's lists, and what the player
// sends as you watch, on a computer and through dx.bi TV's stand-in for its native player. No network:
// every fetch is answered here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "dxbi.plugin.js"), "utf8");
const start = source.indexOf("  const SIMKL_API = ");
const end = source.indexOf("  // Customise Home: rows moved, hidden and renamed");
assert.ok(start > 0 && end > start, "Simkl section found");

// --- a small world for the section to live in ---------------------------------------------------
const storage = new Map();
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
// (the plugin's store keeps { t, v } entries, and the Simkl code reads them through store.data)
const data = {};
const store = {
  data,
  get: (k, f) => (data[k] && data[k].v !== undefined && data[k].v !== null ? data[k].v : f),
  set: (k, v) => { data[k] = { t: Date.now(), v }; },
};
const settings = { simklRows: "watching", simklScrobble: true, simklAnime: true };
const viewer = { id: "main", name: "Me", kids: 0 };
const viewers = { current: () => viewer, key: (s) => `${s}:${viewer.id}` };
const logs = [];
const log = (...a) => logs.push(a.map(String).join(" "));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const perf = { t: 100000 };
const performance = { now: () => perf.t };
let route = "board";
const metadataSource = { addons: [], refresh: async () => {} };
const myList = {
  els: [],
  looks: () => ({ row: "row", head: "h", titles: "ts", title: "t", all: "a", allLabel: "al", track: "tr", card: "c", link: "l", poster: "p", layer: "ly", image: "i", bar: "b", label: "lb" }),
  row: ([name, list]) => {
    const el = { name, list, classes: new Set(), querySelector: () => null, remove() { this.removed = true; }, parentElement: null };
    el.classList = { add: (c) => el.classes.add(c) };
    return el;
  },
  anchor: () => null,
  unhide() {},
};
const forYou = { el: null };
let synced = 0;
const scheduleSync = () => { synced++; };
const isImdb = (id) => /^tt\d+$/.test(id || "");

// fetch: a script of answers, matched by method + path, each used once unless marked `keep`
let script = [];
const calls = [];
const answer = (method, path, status, json, { headers = {}, keep = false } = {}) => script.push({ method, path, status, json, headers, keep });
const fetchStub = async (url, init = {}) => {
  const method = init.method || "GET";
  const u = new URL(url);
  const q = [...u.searchParams].filter(([k]) => !["client_id", "app-name", "app-version"].includes(k)).map(([k, v]) => `${k}=${v}`).join("&");
  const path = u.pathname + (q ? "?" + q : "");
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path, body, auth: (init.headers || {}).Authorization || null, keepalive: !!init.keepalive });
  const i = script.findIndex((a) => a.method === method && (a.path instanceof RegExp ? a.path.test(path) : a.path === path));
  if (i < 0) throw new Error(`no answer for ${method} ${path}`);
  const a = script[i];
  if (!a.keep) script.splice(i, 1);
  const h = new Map(Object.entries(a.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status: a.status, ok: a.status >= 200 && a.status < 300, headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) }, text: async () => (a.json === undefined ? "" : JSON.stringify(a.json)), json: async () => a.json };
};

const timers = [];
const fastTimeout = (fn, ms) => setTimeout(fn, Math.min(ms || 0, 3));
const sandbox = {
  console, setTimeout: fastTimeout, clearTimeout, Promise, Date, JSON, Math, Number, String, Object, Array, RegExp, Map, Set, isFinite, parseInt, encodeURIComponent, encodeURI, Error,
  AbortSignal: { timeout: () => null },
  fetch: fetchStub, localStorage, performance, store, settings, viewers, log, esc, isImdb, metadataSource, myList, forYou, scheduleSync,
  IN_TV: false, DATA_LOCAL: "dxbi.data", currentRoute: () => route, location: { hash: "#/" }, core: () => ({ getState: null }), PLUGIN_VERSION: "test", SETTINGS_SECTION: "dx.bi",
  ensureExtrasStyle: () => {}, window: { addEventListener() {}, removeEventListener() {} },
  document: { getElementById: () => null, createElement: () => ({ append() {}, remove() {}, set textContent(v) { this.t = v; }, classList: { add() {} } }), head: { append() {} }, body: { append() {} }, querySelector: () => null, querySelectorAll: () => [] },
};
sandbox.timers = timers;
const { simkl, simklRows, simklScrobble } = vm.runInNewContext(`${source.slice(start, end)}\n({ simkl, simklRows, simklScrobble })`, sandbox);
simkl.toast = (t) => logs.push("toast " + t);
const flush = () => new Promise((r) => setTimeout(r, 150)); // (Windows timers tick every 15 ms)
const pass = (m) => console.log(`PASS ${m}`);
// values made inside the sandbox have their own Object prototype: compare them as plain data
const plain = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

// --- signing in -------------------------------------------------------------------------------
{
  const codes = [];
  answer("POST", "/oauth2/device", 200, { device_code: "DEV", user_code: "ABCD-EFGH", verification_uri_complete: "https://simkl.com/pin?user_code=ABCD-EFGH", expires_in: 900, interval: 5 });
  answer("POST", "/oauth2/token", 400, { error: "authorization_pending" });
  answer("POST", "/oauth2/token", 400, { error: "slow_down" });
  answer("POST", "/oauth2/token", 500, { error: "server_error" });
  answer("POST", "/oauth2/token", 200, { access_token: "AT1", refresh_token: "RT1", expires_in: 604800, scope: "media:read media:write" });
  answer("GET", "/users/settings", 200, { user: { name: "sam" }, account: { id: 42, type: "free" } });
  await simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", (c) => codes.push(c));
  eq(codes, [{ code: "ABCD-EFGH", url: "https://simkl.com/pin?user_code=ABCD-EFGH" }]);
  const c = simkl.get();
  assert.equal(c.auth, 2);
  assert.equal(c.access, "AT1");
  assert.equal(c.refresh, "RT1");
  assert.equal(c.user.name, "sam");
  assert.equal(calls.filter((x) => x.path === "/oauth2/token").length, 4, "kept polling through pending, slow_down and a hiccup");
  assert.equal(calls.at(-1).auth, "Bearer AT1");
  eq(calls[0].body, { client_id: "abcdefghijklmnopqrstuvwxyz0123456789", scope: "media:read media:write" });
  assert.ok(!("client_secret" in calls[1].body), "no secret in a public client");
  assert.equal(script.length, 0);
  pass("device flow: code shown, polled until the token, account read");
}
{
  calls.length = 0;
  simkl.disconnect();
  answer("POST", "/oauth2/device", 401, { error: "invalid_client", error_description: "This client_id is not enabled for OAuth 2.0" });
  answer("GET", "/oauth/pin", 200, { result: "OK", user_code: "ABCDE", verification_url: "https://simkl.com/pin", expires_in: 900, interval: 5 });
  answer("GET", "/oauth/pin/ABCDE", 200, { result: "KO", message: "Authorization pending" });
  answer("GET", "/oauth/pin/ABCDE", 200, { result: "OK", access_token: "V1TOKEN" });
  answer("GET", "/users/settings", 200, { user: { name: "sam" }, account: { id: 42, type: "vip" } });
  const codes = [];
  await simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", (c) => codes.push(c.code));
  eq(codes, ["ABCDE"]);
  assert.equal(simkl.get().auth, 1);
  assert.equal(simkl.get().access, "V1TOKEN");
  assert.equal(simkl.get().user.type, "vip");
  pass("an older (AUTH V1) app falls back to the PIN flow");
}
{
  simkl.disconnect();
  answer("POST", "/oauth2/device", 401, { error: "invalid_client", error_description: "Unknown or missing client_id" });
  answer("GET", "/oauth/pin", 412, { error: "client_id_failed", code: 412, message: "Your client_id is wrong. Try another one" });
  await assert.rejects(simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", () => {}), /Unknown or missing client_id/);
  await assert.rejects(simkl.connect("short", () => {}), /doesn't look like/);
  assert.equal(simkl.connected(), false);
  assert.equal(simkl.clientId(), "abcdefghijklmnopqrstuvwxyz0123456789", "the key is kept for next time");
  pass("a wrong client ID is reported, nothing else tried");
}
{
  simkl.disconnect();
  answer("POST", "/oauth2/device", 200, { device_code: "DEV", user_code: "AAAA-BBBB", verification_uri: "https://simkl.com/pin", expires_in: 900, interval: 5 });
  answer("POST", "/oauth2/token", 400, { error: "expired_token" });
  await assert.rejects(simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", () => {}), /code expired/);
  pass("an expired code says so");
}

// --- requests: refresh, retries, limits ----------------------------------------------------------
{
  calls.length = 0;
  simkl.save({ v: 2, clientId: "abcdefghijklmnopqrstuvwxyz0123456789", auth: 2, access: "OLD", refresh: "RT1", exp: Date.now() + 30 * 86400e3, scope: "media:read media:write", user: { name: "sam", id: 42, type: "free" } });
  answer("GET", "/sync/activities", 401, { error: "unauthorized" });
  answer("POST", "/oauth2/token", 200, { access_token: "NEW", refresh_token: "RT1", expires_in: 604800 });
  answer("GET", "/sync/activities", 200, { all: "2026-11-01T00:00:00Z" }, { headers: { "X-RateLimit-Remaining": "480", "X-RateLimit-Limit": "500" } });
  const r = await simkl.request("/sync/activities");
  assert.equal(r.all, "2026-11-01T00:00:00Z");
  assert.equal(simkl.get().access, "NEW");
  assert.equal(calls.at(-1).auth, "Bearer NEW");
  eq(calls[1].body, { grant_type: "refresh_token", refresh_token: "RT1", client_id: "abcdefghijklmnopqrstuvwxyz0123456789" });
  eq(simkl.quota && [simkl.quota.remaining, simkl.quota.limit], [480, 500]);
  pass("a 401 refreshes the token once and retries");
}
{
  simkl.save({ ...simkl.get(), exp: Date.now() + 3600e3 });
  answer("POST", "/oauth2/token", 200, { access_token: "NEW2", refresh_token: "RT1", expires_in: 604800 });
  answer("GET", "/sync/activities", 200, { all: "x" });
  await simkl.request("/sync/activities");
  assert.equal(simkl.get().access, "NEW2");
  pass("a token about to expire is refreshed ahead of time");
}
{
  answer("GET", "/sync/activities", 429, "rate_limit");
  answer("GET", "/sync/activities", 200, { all: "y" });
  assert.equal((await simkl.request("/sync/activities")).all, "y");
  answer("GET", "/sync/activities", 429, "user_limit_exceeded", { headers: { "Retry-After": "7200" } });
  await assert.rejects(simkl.request("/sync/activities"), (e) => e.quota && /daily limit/.test(e.message) && /2 h/.test(e.message));
  answer("POST", "/scrobble/start", 400, { error: "RATE_LIMIT" });
  await assert.rejects(simkl.request("/scrobble/start", { method: "POST", body: {} }), (e) => e.lock === true);
  answer("POST", "/scrobble/stop", 409, { error: "already completed" });
  await assert.rejects(simkl.request("/scrobble/stop", { method: "POST", body: {} }), (e) => e.conflict === true);
  pass("burst limits retry, the daily limit and the write lock are told apart, 409 is a conflict");
}
{
  answer("GET", "/sync/activities", 401, { error: "unauthorized" });
  answer("POST", "/oauth2/token", 400, { error: "invalid_grant" });
  await assert.rejects(simkl.request("/sync/activities"), /signed dx.bi out/);
  assert.equal(simkl.connected(), false);
  assert.equal(simkl.get().expired, true);
  assert.equal(simkl.get().clientId, "abcdefghijklmnopqrstuvwxyz0123456789");
  assert.equal(simkl.get().user.name, "sam");
  pass("a revoked connection is dropped, keeping the key and the name");
}
{
  simkl.save({ v: 2, clientId: "abcdefghijklmnopqrstuvwxyz0123456789", auth: 1, access: "V1", refresh: "", exp: 0 });
  answer("GET", "/sync/activities", 401, { error: "unauthorized" });
  await assert.rejects(simkl.request("/sync/activities"), /signed dx.bi out/);
  assert.equal(calls.filter((c) => c.path === "/oauth2/token").length, 3, "a V1 token is never refreshed");
  pass("a V1 token that stops working asks to connect again");
}
{
  simkl.save({ v: 2, clientId: "abcdefghijklmnopqrstuvwxyz0123456789", auth: 2, access: "TOK", refresh: "RT", exp: Date.now() + 30 * 86400e3, user: { name: "sam", id: 42, type: "free" } });
  const text = JSON.stringify(simkl.summary());
  assert.ok(!/TOK|RT|abcdefghijklmnop/.test(text), "no token or key in a problem report");
  assert.equal(JSON.parse(text).connected, true);
  pass("problem reports say only whether Simkl is connected");
}

// --- rows from the lists ----------------------------------------------------------------------
const entry = (kind, over) => ({
  [kind === "movies" ? "movie" : "show"]: { title: `${kind} title`, poster: "ab/abcdef", year: 2020, ids: { simkl: 1, imdb: "tt0000001" }, ...over.m },
  last_watched_at: "2026-10-01T00:00:00Z", added_to_watchlist_at: "2026-09-01T00:00:00Z", status: "watching", ...over.e,
});
{
  metadataSource.addons = [];
  const lists = {
    shows: [
      entry("shows", { m: { title: "Breaking Bad", ids: { imdb: "tt0903747" } }, e: { next_to_watch: "S02E05", last_watched_at: "2026-10-20T00:00:00Z" } }),
      entry("shows", { m: { title: "Old", ids: { imdb: "tt0000002" } }, e: { next_to_watch: "S01E01", last_watched_at: "2026-01-01T00:00:00Z" } }),
      entry("shows", { m: { title: "No ids", ids: { simkl: 5 } }, e: {} }),
    ],
    movies: [entry("movies", { m: { title: "Dune", ids: { imdb: "tt1160419" } }, e: { last_watched_at: "2026-10-10T00:00:00Z" } })],
    anime: [
      entry("shows", { m: { title: "Death Note", ids: { imdb: "tt0877057", mal: 1535 } }, e: { next_to_watch: "S01E12", last_watched_at: "2026-10-15T00:00:00Z", anime_type: "tv" } }),
      entry("shows", { m: { title: "Only MAL", ids: { mal: 999 } }, e: { last_watched_at: "2026-10-14T00:00:00Z" } }),
    ],
  };
  const items = await simklRows.items(lists, "watching");
  eq(items.map((i) => [i._id, i.type, i.video || null, i.name]), [
    ["tt0903747", "series", "tt0903747:2:5", "Breaking Bad · S2 E5"],
    ["tt0877057", "series", null, "Death Note · E12"],
    ["tt1160419", "movie", null, "Dune"],
    ["tt0000002", "series", "tt0000002:1:1", "Old · S1 E1"],
  ]);
  assert.equal(items[0].poster, "https://wsrv.nl/?url=https://simkl.in/posters/ab/abcdef_m.webp&q=90");
  pass("rows: newest first, next episode linked, anime by IMDb without a Kitsu addon, no id → no card");

  metadataSource.addons = [{ transportUrl: "https://anime-kitsu.strem.fun/manifest.json", manifest: { id: "community.anime.kitsu", types: ["anime", "movie", "series"], idPrefixes: ["kitsu", "mal", "anilist", "anidb"] } }];
  answer("GET", "/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=1535&include=item&fields[anime]=slug", 200, { data: [{ id: "3020", relationships: { item: { data: { type: "anime", id: "1376" } } } }] });
  answer("GET", "/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=999&include=item&fields[anime]=slug", 200, { data: [] });
  calls.length = 0;
  const withKitsu = await simklRows.items(lists, "watching");
  const dn = withKitsu.find((i) => /Death Note/.test(i.name));
  eq([dn._id, dn.type, dn.video], ["kitsu:1376", "anime", "kitsu:1376:12"]);
  assert.ok(!withKitsu.some((i) => /Only MAL/.test(i.name)), "no Kitsu match and no IMDb id: no card");
  const kitsuMap = JSON.parse(localStorage.getItem("dxbi.simkl.kitsu"));
  eq(Object.fromEntries(Object.entries(kitsuMap).map(([k, v]) => [k, v.id])), { 1535: "1376", 999: "" });
  assert.ok(kitsuMap[999].t > 0, "a miss is dated, so it can be tried again later");
  await simklRows.items(lists, "watching");
  assert.equal(calls.filter((c) => /kitsu/.test(c.path) === false && /mappings/.test(c.path)).length, 2, "mappings are remembered");
  pass("rows: anime through the Kitsu addon, mapped once from MAL");

  settings.simklAnime = false;
  assert.ok(!(await simklRows.items(lists, "watching")).some((i) => /Death Note/.test(i.name)));
  settings.simklAnime = true;
  const plan = await simklRows.items({ movies: [entry("movies", { m: { ids: { imdb: "tt1" } }, e: { added_to_watchlist_at: "2026-10-01T00:00:00Z", last_watched_at: null } }), entry("movies", { m: { ids: { imdb: "tt2" } }, e: { added_to_watchlist_at: "2026-10-02T00:00:00Z", last_watched_at: null } })] }, "plantowatch");
  eq(plan.map((i) => i._id), ["tt2", "tt1"], "plan to watch: latest added first");
  const many = await simklRows.items({ movies: Array.from({ length: 100 }, (_, i) => entry("movies", { m: { ids: { imdb: `tt${1000 + i}` } }, e: {} })) }, "completed");
  assert.equal(many.length, simklRows.MAX);
  pass("rows: anime switch, plan-to-watch order, a cap per row");
}
{
  calls.length = 0;
  metadataSource.addons = [];
  settings.simklRows = "watching";
  answer("GET", "/sync/activities", 200, { all: "2026-11-02T10:00:00Z" });
  answer("GET", "/sync/all-items/all/watching?extended=full&next_watch_info=yes", 200, { shows: [entry("shows", { m: { ids: { imdb: "tt1" } }, e: { next_to_watch: "S01E02" } })] });
  answer("GET", "/sync/all-items/all/plantowatch?extended=full", 200, {});
  await simklRows.refresh();
  let saved = simklRows.saved();
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].name, "Simkl · Watching");
  assert.equal(saved.all, "2026-11-02T10:00:00Z");
  assert.ok(synced > 0);
  pass("refresh: one request per wanted list, empty lists make no row");

  calls.length = 0;
  answer("GET", "/sync/activities", 200, { all: "2026-11-02T10:00:00Z" });
  saved.t = 0;
  simklRows.write(saved);
  await simklRows.refresh();
  assert.equal(calls.length, 1, "nothing changed on Simkl: the lists aren't asked for again");
  assert.ok(simklRows.saved().t > 0);
  pass("refresh: Simkl's activities decide whether the lists are fetched");

  settings.simklRows = "all";
  assert.equal(simklRows.saved(), null, "other lists wanted: the old rows don't apply");
  answer("GET", "/sync/activities", 200, { all: "2026-11-02T11:00:00Z" });
  for (const st of ["watching", "plantowatch", "hold", "completed"]) answer("GET", new RegExp(`^/sync/all-items/all/${st}\\?extended=full`), 200, { movies: st === "watching" ? [] : [entry("movies", { m: { ids: { imdb: `tt${st.length}` } }, e: {} })] });
  await simklRows.refresh();
  eq(simklRows.saved().rows.map((r) => r.key), ["plantowatch", "hold", "completed"]);
  pass("refresh: every list on request");

  settings.simklRows = "off";
  eq(simklRows.wanted(), []);
  settings.simklRows = "watching";
  simklRows.reset();
  assert.equal(localStorage.getItem("dxbi.simkl.lists"), null);
  pass("rows: off means none, and a reset forgets them");
}

// --- what the player tells Simkl --------------------------------------------------------------
{
  const meta = { name: "Breaking Bad", year: "2008" };
  eq(await simklScrobble.describe("series", "tt0903747", "tt0903747:2:5", meta), { show: { title: "Breaking Bad", year: 2008, ids: { imdb: "tt0903747" } }, episode: { season: 2, number: 5 } });
  eq(await simklScrobble.describe("movie", "tt1160419", "tt1160419", { name: "Dune", releaseInfo: "2021" }), { movie: { title: "Dune", year: 2021, ids: { imdb: "tt1160419" } } });
  eq(await simklScrobble.describe("series", "tmdb:1396", "tmdb:1396:1:1", { name: "BB" }), { show: { title: "BB", ids: { tmdb: 1396 } }, episode: { season: 1, number: 1 } });
  eq(await simklScrobble.describe("anime", "mal:1535", "mal:1535:3", { name: "Death Note" }), { anime: { title: "Death Note", ids: { mal: 1535 } }, episode: { number: 3 } });
  answer("GET", "/api/edge/anime/1376/mappings?filter[externalSite]=myanimelist/anime", 200, { data: [{ attributes: { externalSite: "myanimelist/anime", externalId: "1535" } }] });
  eq(await simklScrobble.describe("anime", "kitsu:1376", "kitsu:1376:12", { name: "Death Note", year: 2006 }), { anime: { title: "Death Note", year: 2006, ids: { mal: 1535 } }, episode: { number: 12 } });
  eq(await simklScrobble.describe("anime", "kitsu:1376", "kitsu:1376:13", { name: "Death Note" }), { anime: { title: "Death Note", ids: { mal: 1535 } }, episode: { number: 13 } });
  assert.equal(calls.filter((c) => /anime\/1376\/mappings/.test(c.path)).length, 1, "Kitsu asked once");
  assert.equal(await simklScrobble.describe("series", "tt0903747", "tt0903747", meta), null, "a show without an episode isn't sent");
  assert.equal(await simklScrobble.describe("movie", "yt:abc", "yt:abc", meta), null);
  answer("GET", "/api/edge/anime/777/mappings?filter[externalSite]=myanimelist/anime", 200, { data: [] });
  assert.equal(await simklScrobble.describe("anime", "kitsu:777", "kitsu:777:1", meta), null, "no MAL id: not sent");
  pass("what's playing: films and shows by IMDb or TMDB id, anime by its MAL id");
}
{
  // a pretend <video>
  const video = { paused: true, seeking: false, ended: false, readyState: 4, currentTime: 0, duration: 1000, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, fire(t) { this.listeners[t] && this.listeners[t]({ type: t }); } };
  sandbox.document.querySelector = (sel) => (/player-container/.test(sel) ? video : null);
  route = "player";
  sandbox.location.hash = "#/player/abc";
  simklScrobble.ARM = 5;
  calls.length = 0;
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, video);
  simklScrobble.media = { key: "tt0903747:2:5", body: { show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } }, episode: { season: 2, number: 5 } }, name: "Breaking Bad" };
  const tick = (sec, pos) => { perf.t += sec * 1000; video.currentTime = pos; video.fire("timeupdate"); };
  video.paused = false;
  video.fire("playing");
  tick(0, 1);
  tick(1, 2);
  tick(1, 3);
  await flush();
  assert.equal(calls.length, 0, "nothing until it has really played a while");
  answer("POST", "/scrobble/start", 200, { action: "start" });
  tick(1, 4); tick(1, 5);
  await flush();
  assert.equal(calls.length, 0, "four seconds played: still nothing");
  tick(1, 6);
  await flush();
  assert.equal(calls.length, 1, "five seconds played: Simkl hears about it");
  assert.equal(calls[0].path, "/scrobble/start");
  eq(calls[0].body, { show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } }, episode: { season: 2, number: 5 }, progress: 0.6 });
  tick(1, 10);
  await flush();
  assert.equal(calls.length, 1, "told once");
  assert.equal(simklScrobble.state, "started");
  pass("player: Watching now once it has really played for a while, with the progress");

  video.paused = true;
  video.fire("pause");
  video.paused = false;
  video.fire("playing");
  await flush();
  assert.equal(calls.length, 1, "a blip isn't a pause");
  video.paused = true;
  answer("POST", "/scrobble/pause", 200, { action: "pause" });
  video.currentTime = 400;
  video.fire("timeupdate");
  video.fire("pause");
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/pause");
  assert.equal(calls.at(-1).body.progress, 40);
  assert.equal(simklScrobble.state, "paused");
  answer("POST", "/scrobble/start", 200, { action: "start" });
  video.paused = false;
  video.fire("playing");
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/start");
  assert.equal(simklScrobble.state, "started");
  pass("player: a real pause and a resume are sent, a blip isn't");

  video.currentTime = 850;
  video.fire("timeupdate");
  answer("POST", "/scrobble/stop", 200, { action: "scrobble" });
  sandbox.location.hash = "#/player/next";
  simklScrobble.ensure(); // the next episode started in the same player
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/stop");
  assert.equal(calls.at(-1).body.progress, 85);
  assert.equal(simklScrobble.media, null, "the next title is looked up afresh");
  assert.ok(logs.some((l) => /toast Marked as watched on Simkl: Breaking Bad/.test(l)));
  pass("player: moving on sends where it got to, and 80%+ means watched");

  simklScrobble.media = { key: "tt1", body: { movie: { title: "Dune", ids: { imdb: "tt1" } } }, name: "Dune" };
  simklScrobble.state = "started";
  video.currentTime = 100;
  video.fire("timeupdate");
  answer("POST", "/scrobble/stop", 400, { error: "RATE_LIMIT" });
  answer("POST", "/scrobble/stop", 200, { action: "pause" });
  route = "board";
  simklScrobble.ensure(); // left the player
  await flush();
  assert.equal(calls.filter((c) => c.path === "/scrobble/stop").length, 3, "the write lock is waited out and the stop sent again");
  assert.equal(simklScrobble.video, null);
  assert.equal(simklScrobble.error, "");
  pass("player: leaving before the end keeps the place, and a busy Simkl is tried again");

  route = "player";
  sandbox.location.hash = "#/player/x";
  simklScrobble.ensure();
  simklScrobble.media = { key: "k", body: { movie: { title: "Dune", ids: { imdb: "tt1" } } }, name: "Dune" };
  simklScrobble.state = "started";
  video.currentTime = 900;
  video.fire("timeupdate");
  answer("POST", "/scrobble/stop", 200, { action: "scrobble" });
  simklScrobble.onUnload();
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/stop");
  assert.equal(calls.at(-1).keepalive, true, "sent so that it survives the window closing");
  pass("player: closing dx.bi still tells Simkl");

  settings.simklScrobble = false;
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, null, "off: the player isn't watched");
  settings.simklScrobble = true;
  sandbox.document.querySelector = () => null;
  route = "board";
}

// --- dx.bi TV: the native player's reports, through the page's stand-in for the video --------------
{
  // the stand-in is the real one from dxbi-tv.js, fed as PlayerActivity feeds it: every 5 s, and once as it closes
  // (a Windows checkout can have CRLF line ends; the markers below are looked for with LF)
  const tvSource = readFileSync(join(root, "tv", "app", "src", "main", "assets", "dxbi-tv.js"), "utf8").replace(/\r\n/g, "\n");
  const a = tvSource.indexOf("  class ScrobbleVideo extends EventTarget {");
  const b = tvSource.indexOf("\n  }\n", a) + 5;
  assert.ok(a > 0 && b > a, "stand-in found in dxbi-tv.js");
  const ScrobbleVideo = vm.runInNewContext(`${tvSource.slice(a, b)}\nScrobbleVideo`, { EventTarget, Event });
  const dxbiTv = { scrobbleVideo: null };
  sandbox.IN_TV = true;
  sandbox.window.__dxbiTv = dxbiTv;
  simklScrobble.ARM = 15;
  const report = (sec, paused = false, buffering = false) => { perf.t += 5000; dxbiTv.scrobbleVideo.update(sec * 1000, 1000 * 1000, paused, buffering); };
  const bb = { key: "tt0903747:2:5", body: { show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } }, episode: { season: 2, number: 5 } }, name: "Breaking Bad" };

  route = "player";
  sandbox.location.hash = "#/player/tv1";
  dxbiTv.scrobbleVideo = new ScrobbleVideo("#/player/tv1");
  calls.length = 0;
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, dxbiTv.scrobbleVideo, "the TV's stand-in is watched instead of a <video>");
  simklScrobble.media = bb;
  report(5); report(10); report(15);
  await flush();
  assert.equal(calls.length, 0, "three reports five seconds apart: ten seconds counted, not yet");
  answer("POST", "/scrobble/start", 200, { action: "start" });
  report(20);
  await flush();
  assert.equal(calls.length, 1, "fifteen seconds really played: Watching now");
  eq(calls[0].body, { ...bb.body, progress: 2 });
  assert.equal(simklScrobble.state, "started");
  report(22, false, true); // waiting for data at the moment of a report
  report(27);
  await flush();
  assert.equal(calls.length, 1, "a stall isn't a pause");
  assert.equal(simklScrobble.state, "started");
  answer("POST", "/scrobble/pause", 200, { action: "pause" });
  report(30, true);
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/pause");
  assert.equal(calls.at(-1).body.progress, 3);
  answer("POST", "/scrobble/start", 200, { action: "start" });
  report(30);
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/start");
  assert.equal(simklScrobble.state, "started");
  pass("TV: Watching now after the reports add up to a while, the remote's pause and play, a stall ignored");

  // Back on the remote: the player closes with where it got to, and the page then leaves the player screen
  const closing = dxbiTv.scrobbleVideo;
  dxbiTv.scrobbleVideo = null;
  closing.close(400 * 1000, 1000 * 1000, false);
  await flush();
  assert.equal(calls.filter((c) => c.path === "/scrobble/stop").length, 0, "the close itself sends nothing");
  answer("POST", "/scrobble/stop", 200, { action: "pause" });
  route = "board";
  simklScrobble.ensure();
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/stop");
  assert.equal(calls.at(-1).body.progress, 40);
  assert.equal(simklScrobble.video, null);
  pass("TV: closing the player early sends where it got to, once the page has left the player");

  // played through: watched, straight from the close, and the next episode's screen doesn't repeat it
  route = "player";
  sandbox.location.hash = "#/player/tv2";
  dxbiTv.scrobbleVideo = new ScrobbleVideo("#/player/tv2");
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, dxbiTv.scrobbleVideo);
  simklScrobble.media = { key: "tt1160419", body: { movie: { title: "Dune", ids: { imdb: "tt1160419" } } }, name: "Dune" };
  answer("POST", "/scrobble/start", 200, { action: "start" });
  report(5); report(10); report(15); report(20);
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/start");
  answer("POST", "/scrobble/stop", 200, { action: "scrobble" });
  const done = dxbiTv.scrobbleVideo;
  dxbiTv.scrobbleVideo = null;
  done.close(1000 * 1000, 1000 * 1000, true);
  await flush();
  assert.equal(calls.at(-1).path, "/scrobble/stop");
  assert.equal(calls.at(-1).body.progress, 100);
  assert.equal(simklScrobble.state, "stopped");
  assert.ok(logs.some((l) => /toast Marked as watched on Simkl: Dune/.test(l)));
  const sent = calls.length;
  sandbox.location.hash = "#/player/tv3"; // on to the next episode
  simklScrobble.ensure();
  await flush();
  assert.equal(calls.length, sent, "told once");
  assert.equal(simklScrobble.video, null);
  pass("TV: played through: marked watched from the close, once");

  // a stand-in made for another title (a party host changing the stream) is not taken for this one;
  // a trailer or a restarted page has none at all
  dxbiTv.scrobbleVideo = new ScrobbleVideo("#/player/tv2");
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, null, "another title's stand-in is left alone");
  dxbiTv.scrobbleVideo = null;
  simklScrobble.ensure();
  assert.equal(simklScrobble.video, null);
  assert.equal(calls.length, sent);
  pass("TV: only the stand-in for the title on screen counts");

  sandbox.IN_TV = false;
  delete sandbox.window.__dxbiTv;
  route = "board";
  simklScrobble.ensure();
}

// --- after the review: back-off, and only Simkl's own sign-in page -------------------------------
{
  simkl.disconnect();
  answer("POST", "/oauth2/device", 200, { device_code: "DEV", user_code: "ABCD-EFGH", verification_uri_complete: "file:///C:/Users/Public/x.cmd", expires_in: 900, interval: 5 });
  answer("POST", "/oauth2/token", 200, { access_token: "AT9", refresh_token: "RT9", expires_in: 604800, scope: "media:read media:write" });
  answer("GET", "/users/settings", 200, { user: { name: "sam" }, account: { id: 42, type: "free" } });
  const codes = [];
  await simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", (c) => codes.push(c.url));
  eq(codes, ["https://simkl.com/pin"], "anything but Simkl's own site becomes the plain pin page");
  pass("sign-in: only simkl.com is ever opened");
}
{
  // Home is open (a board content element exists), Simkl is connected, and it keeps failing
  const content = { querySelector: () => null, firstElementChild: null };
  sandbox.document.querySelector = (sel) => (/board-content-/.test(sel) ? content : null);
  route = "board";
  settings.simklRows = "watching";
  simklRows.reset();
  calls.length = 0;
  answer("GET", "/sync/activities", 503, { error: "server_error" });
  simklRows.ensure();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(simklRows.failures, 1);
  assert.ok(simklRows.nextTry > Date.now() + 20000, "the next try waits");
  simklRows.ensure();
  simklRows.ensure();
  await flush();
  assert.equal(calls.length, 1, "not asked again on every pass over the page");
  simklRows.nextTry = 0; // (time passes)
  answer("GET", "/sync/activities", 429, "user_limit_exceeded", { headers: { "Retry-After": "7200" } });
  simklRows.ensure();
  await flush();
  assert.equal(calls.length, 2);
  assert.ok(simklRows.nextTry >= Date.now() + 7000e3, "a used-up day waits for its reset");
  assert.match(simklRows.error, /daily limit/);
  simklRows.nextTry = 0;
  answer("GET", "/sync/activities", 200, { all: "2026-11-02T12:00:00Z" });
  answer("GET", "/sync/all-items/all/watching?extended=full&next_watch_info=yes", 200, {});
  answer("GET", "/sync/all-items/all/plantowatch?extended=full", 200, {});
  simklRows.ensure();
  await flush();
  assert.equal(simklRows.failures, 0);
  assert.equal(simklRows.error, "");
  pass("rows: a failing Simkl is asked again later, later each time, never on every pass");
  sandbox.document.querySelector = () => null;
}
{
  // Home shows the first viewer's Simkl rows; a second viewer, also on Simkl, takes over and Simkl fails
  const content = { querySelector: () => null, firstElementChild: null, prepend(el) { this.firstElementChild = el; } };
  sandbox.document.querySelector = (sel) => (/board-content-/.test(sel) ? content : null);
  route = "board";
  settings.simklRows = "watching";
  simklRows.reset();
  simklRows.write({ sig: simklRows.sig(), t: Date.now(), at: Date.now(), all: "x", rows: [{ key: "watching", name: "Simkl · Watching", list: [{ _id: "tt1", type: "movie", name: "A" }] }] });
  simklRows.ensure();
  const [row] = simklRows.els;
  assert.ok(row && content.firstElementChild === row, "the first viewer's row is on Home");
  // the same viewer, another list wanted: its rows stay up while the new lists are fetched
  settings.simklRows = "all";
  answer("GET", "/sync/activities", 503, { error: "server_error" });
  simklRows.ensure();
  await flush();
  assert.ok(!row.removed && simklRows.els[0] === row, "the same viewer's rows wait for its new lists");
  settings.simklRows = "watching";
  simklRows.nextTry = 0;
  simklRows.failures = 0;
  const creds = simkl.get();
  viewer.id = "second";
  simkl.save(creds);
  answer("GET", "/sync/activities", 503, { error: "server_error" });
  simklRows.ensure();
  assert.ok(row.removed, "the first viewer's rows go at once");
  eq(simklRows.els, []);
  await flush();
  assert.equal(simklRows.failures, 1, "the second viewer's lists were asked for, and failed");
  simklRows.ensure();
  eq(simklRows.els, [], "and nothing of the first viewer's comes back while they can't be had");
  pass("rows: another viewer's Simkl rows go when the viewer changes, not when the new lists arrive");
  viewer.id = "main";
  simklRows.reset();
  sandbox.document.querySelector = () => null;
}

// --- after the review, part two -------------------------------------------------------------------
{
  // a network blip while waiting for the code (the stub throws when it has no answer) doesn't end the sign-in
  simkl.disconnect();
  script.length = 0;
  answer("POST", "/oauth2/device", 200, { device_code: "DEV", user_code: "BLIP-BLIP", verification_uri: "https://simkl.com/pin", expires_in: 900, interval: 5 });
  // (no answer for the first poll: fetch rejects) then pending, then the token
  const pollsBefore = calls.filter((c) => c.path === "/oauth2/token").length;
  setTimeout(() => {
    answer("POST", "/oauth2/token", 400, { error: "authorization_pending" });
    answer("POST", "/oauth2/token", 200, { access_token: "AT2", refresh_token: "RT2", expires_in: 604800, scope: "media:read media:write" });
    answer("GET", "/users/settings", 200, { user: { name: "sam" }, account: { id: 42, type: "free" } });
  }, 8);
  await simkl.connect("abcdefghijklmnopqrstuvwxyz0123456789", () => {});
  assert.equal(simkl.get().access, "AT2");
  assert.ok(calls.filter((c) => c.path === "/oauth2/token").length - pollsBefore >= 3, "kept polling through the blip");
  pass("sign-in: a network blip while waiting is waited out");
}
{
  // two burst limits in a row are "busy", never "the day is used up"
  answer("GET", "/sync/activities", 429, "rate_limit");
  answer("GET", "/sync/activities", 429, { error: "rate_limit" });
  await assert.rejects(simkl.request("/sync/activities"), (e) => e.busy === true && !e.quota);
  pass("requests: a second burst limit is reported as busy, not as the daily limit");
}
{
  // the mini player window refreshed the token first: its copy is taken, no second refresh
  const key = "simkl:main";
  const mine = { ...simkl.get(), access: "STALE" };
  simkl.save(mine);
  const theirs = { t: Date.now() + 1000, v: { ...mine, access: "THEIRS" } };
  const all = JSON.parse(localStorage.getItem("dxbi.data") || "{}");
  all[key] = theirs;
  localStorage.setItem("dxbi.data", JSON.stringify(all));
  calls.length = 0;
  answer("GET", "/sync/activities", 200, { all: "z" });
  await simkl.request("/sync/activities");
  assert.equal(calls[0].auth, "Bearer THEIRS", "the other window's newer token is used");
  assert.equal(calls.filter((c) => c.path === "/oauth2/token").length, 0, "and nothing was refreshed");
  pass("requests: a token refreshed by the other window is picked up");
}
{
  // a used-up day's error carries how long to wait
  answer("GET", "/sync/activities", 429, "user_limit_exceeded", { headers: { "Retry-After": "3600" } });
  await assert.rejects(simkl.request("/sync/activities"), (e) => e.quota === true && e.retryAfter === 3600000);
  pass("requests: the daily limit says when it resets");
}

console.log("\nALL PASS");
