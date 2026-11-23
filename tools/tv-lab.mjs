// dx.bi TV lab: the TV's page (Stremio's web app + tv/app/src/main/assets/dxbi-tv.js + the plugin) in a
// desktop Chromium, slowed to a TV's pace and steered like a remote, with everything that makes a TV
// feel frozen measured: main-thread stalls (long tasks), how late a key press is handled and whether it
// moved the selection, what each step of the plugin's main loop costs, and a CPU profile per scenario.
//
//   node tools/tv-lab.mjs --label before
//   node tools/tv-lab.mjs --label after --only start,idle,nav
//   node tools/tv-lab.mjs --compare tv-lab/before.json tv-lab/after.json
//
// Options: --out <dir> (tv-lab) · --throttle <n> (6: a Shield's cores next to a desktop's) · --only a,b ·
// --heavy (a Home like a lived-in TV's: dx.bi's Home pack of catalogs, titles in the library, films
// part-watched) · --soak <n> (n rounds of Home, a title, Discover and back, watching memory and the page's
// size for anything that only grows) · --plugin <file> / --tv <file> (other copies, e.g. from `git show`) ·
// --no-plugin (Stremio and the TV shell alone: the floor) · --addon <manifest url> (repeatable; plain
// Torrentio by default, so a title has a stream list) · --title <type/id> · --settings '<json>' (dx.bi
// settings on top of the defaults) · --headful · --fresh (a new browser profile) · --profile <dir> and
// --port <n> (two labs side by side need their own) · --chrome <exe> · --keep (leave it open) ·
// --trace (a browser trace per scenario in place of the CPU profile: the main thread's time split into
// script, style, layout, paint and the rest, and which code forced a layout) · --trace-functions (the
// same, and each long task names the functions that ran in it; the sampling this needs adds stalls of its
// own under throttling, so read that run for who, and a plain --trace run for how long).
//
// It is a lab, not the TV: the numbers compare one build with another on the same machine. Needs Node 22+
// and Chrome or Edge. The browser profile is kept between runs (os.tmpdir()/dxbi-tv-lab), as a TV keeps its.
//
// On a real TV: --device <adb serial, e.g. 192.168.1.50:5555> runs the same scenarios in the app itself,
// at the TV's own speed, with nothing emulated and nothing installed: the TV's own Home, addons and
// settings. It needs a build whose page can be looked into (tv: ./gradlew assembleRelease
// -PdxbiInspect=true), dx.bi open on the TV, and adb on the PATH (or --adb <exe>). --plugin, --tv,
// --heavy, --throttle and --settings mean nothing there.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const every = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// Comparing two runs
// ---------------------------------------------------------------------------------------------
function compare(aFile, bFile) {
  const a = JSON.parse(readFileSync(aFile, "utf8"));
  const b = JSON.parse(readFileSync(bFile, "utf8"));
  const rows = [["scenario", "measure", a.label, b.label, "change"]];
  const pick = (s) => ({
    "main thread busy (s)": s.busy,
    "script (s)": s.script,
    "layout + style (s)": round(s.layout + s.style, 2),
    "layouts": s.layouts,
    "stalls over 50 ms": s.long.count,
    "longest stall (ms)": s.long.max,
    "time blocked (ms)": s.long.blocked,
    "stalls over 350 ms": s.long.over350,
    "main loop runs": s.sync ? s.sync.runs : undefined,
    "main loop total (ms)": s.sync ? s.sync.ms : undefined,
    "main loop longest (ms)": s.sync ? s.sync.max : undefined,
    "keys pressed": s.keys ? s.keys.sent : undefined,
    "keys that moved the selection": s.keys ? s.keys.moved : undefined,
    "key handled late, median (ms)": s.keys ? s.keys.delayP50 : undefined,
    "key handled late, worst (ms)": s.keys ? s.keys.delayMax : undefined,
    "press to selection moved, median (ms)": s.keys ? s.keys.moveP50 : undefined,
    "press to selection moved, worst (ms)": s.keys ? s.keys.moveMax : undefined,
    "ready (ms)": s.ready,
    "settled (ms)": s.settled,
    "DOM nodes": s.nodes,
    "JS heap (MB)": s.heapMB,
  });
  for (const name of Object.keys(a.scenarios)) {
    if (!b.scenarios[name]) continue;
    const pa = pick(a.scenarios[name]);
    const pb = pick(b.scenarios[name]);
    for (const k of Object.keys(pa)) {
      if (pa[k] === undefined || pb[k] === undefined) continue;
      const change = pa[k] ? `${pb[k] >= pa[k] ? "+" : ""}${round(((pb[k] - pa[k]) / pa[k]) * 100)}%` : "";
      rows.push([name, k, String(pa[k]), String(pb[k]), change]);
    }
  }
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => (i >= 2 ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  "));
}
if (flag("compare")) {
  const i = argv.indexOf("--compare");
  compare(argv[i + 1], argv[i + 2]);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// What goes into the page before Stremio's own scripts, as on the TV
// ---------------------------------------------------------------------------------------------
const LABEL = opt("label", "run");
const OUT = resolve(opt("out", join(root, "tv-lab")));
const THROTTLE = Number(opt("throttle", "6"));
const PORT = Number(opt("port", "9444"));
const ONLY = opt("only", "") ? opt("only", "").split(",") : null;
const TITLE = opt("title", "movie/tt0434409");
const ADDONS = every("addon").length ? every("addon") : ["https://torrentio.strem.fun/manifest.json"];
const SOAK = Number(opt("soak", "0"));
const DEVICE = opt("device", "");
const ADB = opt("adb", process.env.ADB || "adb");
const STREMIO = "https://web.stremio.com/";
// MainActivity's PAGE_READY: the page has a screen to show
const PAGE_READY = '[class*="meta-item-container"], [class*="metadetails-container"], [class*="player-container"], [class*="settings-content"], [class*="addons-content"]';
mkdirSync(OUT, { recursive: true });

const lf = (s) => s.replace(/\r\n/g, "\n");
const pluginFile = resolve(opt("plugin", join(root, "dxbi.plugin.js")));
const tvFile = resolve(opt("tv", join(root, "tv", "app", "src", "main", "assets", "dxbi-tv.js")));
let plugin = flag("no-plugin") ? "" : lf(readFileSync(pluginFile, "utf8"));
const tvSource = lf(readFileSync(tvFile, "utf8"));
const version = (/@version\s+(\S+)/.exec(plugin) || [, "0"])[1];
// Updates.forTv: the plugin as the TV runs it
plugin = plugin
  .replace(/(\n  function introVideoData\(\) \{\n    return )"[^\n]*/, '$1"";')
  .replace(/(\n  function anime4kShaders\(\) \{\n    return )\{[^\n]*/, "$1{};");
// The main loop's steps, timed one by one (only here: the plugin itself is unchanged). A build whose
// loop reports to window.__dxbiLab itself needs none of this
const LOOP = "    for (const step of steps) {\n      try { step(); } catch (err) { log(\"sync step failed\", err); }\n    }\n";
const stepsTimed = plugin.includes(LOOP);
if (stepsTimed) {
  plugin = plugin.replace(LOOP, `    { const L = window.__dxbiLab; const T = performance.now();
    for (const step of steps) {
      const S = performance.now();
      try { step(); } catch (err) { log("sync step failed", err); }
      if (L) L.step(step.name || String(step), performance.now() - S);
    }
    if (L) L.loop(performance.now() - T); }
`.replace(/\n/g, " ") + "\n");
}
if (plugin) plugin += "\n//# sourceURL=dxbi.plugin.js\n";
// dx.bi's own Home pack (free catalog addons, no accounts or keys): what a set-up Home is made of
if (flag("heavy")) for (const m of plugin.matchAll(/\{ name: "[^"]+", what: "[^"]*", url: "(https:[^"]+\/manifest\.json)" \}/g)) ADDONS.push(m[1]);

// (tvTorrents: a stream opens the player, as with a debrid service, rather than asking for a streaming server)
let settings = { streamSort: "quality-size", streamSite: "yts", streamDubbed: true, tvTorrents: true };
if (opt("settings", "")) settings = { ...settings, ...JSON.parse(opt("settings", "{}")) };

// What the page records about itself (stalls, presses, where the selection went, the main loop's steps)
const recorder = `
  // what has the remote's selection: its kind, and a number made from its whole address or words (two
  // streams of one title differ only in the middle of a very long address)
  const sig = (el) => {
    if (!el || el === document.body) return "";
    const text = String(el.getAttribute("href") || el.getAttribute("title") || (el.childElementCount < 8 ? el.textContent : "") || "");
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return el.tagName + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").slice(0, 40) + "|" + (h >>> 0).toString(36);
  };
  const lab = window.__dxbiLab = {
    long: [], events: [], keys: [], focus: [], steps: {}, runs: 0, loopMs: 0, loopMax: 0, played: null,
    step(name, ms) {
      const k = String(name).replace(/\\s+/g, " ").replace(/^\\(\\) => /, "").slice(0, 70);
      const r = this.steps[k] || (this.steps[k] = [0, 0, 0]);
      r[0] += ms; r[1]++; if (ms > r[2]) r[2] = ms;
    },
    loop(ms) { this.runs++; this.loopMs += ms; if (ms > this.loopMax) this.loopMax = ms; },
    take() {
      const out = { now: performance.now(), long: this.long, events: this.events, keys: this.keys, focus: this.focus, steps: this.steps, runs: this.runs, loopMs: this.loopMs, loopMax: this.loopMax, played: this.played,
        nodes: document.getElementsByTagName("*").length, cards: document.querySelectorAll('[class*="meta-item-container"]').length, hash: location.hash };
      Object.assign(this, { long: [], events: [], keys: [], focus: [], steps: {}, runs: 0, loopMs: 0, loopMax: 0 });
      return JSON.stringify(out);
    },
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lab.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "keydown") lab.events.push([Math.round(e.startTime), Math.round(e.processingStart - e.startTime), Math.round(e.processingEnd - e.processingStart), Math.round(e.duration)]); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch (_) {}
  window.addEventListener("keydown", (e) => { lab.keys.push([Math.round(e.timeStamp), Math.round(performance.now()), e.key, sig(document.activeElement)]); }, true);
  window.addEventListener("focusin", (e) => { lab.focus.push([Math.round(performance.now()), sig(e.target)]); }, true);
`;
const GUARD = `if (location.origin !== "https://web.stremio.com" || window.top !== window || window.__dxbiLab) return;`;
// A real TV: only the recorder (the app is the bridge, the TV is as slow as it is)
const deviceRecorder = `(() => {\n  ${GUARD}\n${recorder}})();\n`;
const prelude = `(() => {
  ${GUARD}
  try { Object.defineProperty(navigator, "deviceMemory", { get: () => 2, configurable: true }); } catch (_) {}
${recorder}
  const store = { dxbi: ${JSON.stringify(settings)} };
  const SOURCE = ${JSON.stringify(plugin)};
  window.DxbiTV = {
    pluginSource: () => SOURCE,
    getSettings: (t, plugin) => JSON.stringify(store[plugin] || {}),
    saveSetting: (t, plugin, key, json) => { let v = json; try { v = JSON.parse(json); } catch (_) {} (store[plugin] = store[plugin] || {})[key] = v; },
    play: (t, json) => { lab.played = json; lab.active = json; },
    activePlayback: () => lab.active || "",
    takePendingClose: () => { const c = lab.pendingClose || ""; lab.pendingClose = ""; if (c) lab.active = ""; return c; },
    openExternal: () => {},
    control: () => {},
    findServers: () => {},
    torrentUrl: () => "http://127.0.0.1:9/lab.mkv",
    deviceInfo: () => JSON.stringify({ app: ${JSON.stringify(version)}, device: "dx.bi TV lab" }),
    isPhone: () => false,
    toast: () => {},
    version: () => ${JSON.stringify(version)},
  };
})();
`;
// (Chrome runs this before the page has its <html> element; a TV's WebView runs dxbi-tv.js just after)
const injected = `${prelude}\nconst __dxbiTvShell = function () {\n${tvSource.replace("__DXBI_TV_TOKEN__", "lab")}\n};
if (document.documentElement) __dxbiTvShell();
else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); __dxbiTvShell(); } }).observe(document, { childList: true });
//# sourceURL=dxbi-tv.js\n`;
// where the plugin's first line lands in the script dxbi-tv.js wraps it in (for the profiles' line numbers)
const wrap = /script\.textContent = `([\s\S]*?)\$\{source\}/.exec(tvSource);
const PLUGIN_LINE_OFFSET = wrap ? wrap[1].split("\n").length - 1 : 0;

// ---------------------------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------------------------
function findChrome() {
  const given = opt("chrome", process.env.CHROME || "");
  const candidates = [given,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no Chrome or Edge found: pass --chrome <exe>");
  return found;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    };
  }
  send(method, params = {}, timeout = 120000) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${method} timed out`)); }, timeout);
    });
  }
  async eval(expression, timeout) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ""}`);
    return r.result.value;
  }
}

async function waitFor(what, fn, timeout = 90000, step = 300) {
  const end = Date.now() + timeout;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}

// ---------------------------------------------------------------------------------------------
// A CPU profile, boiled down: where the time went, by script and by function
// ---------------------------------------------------------------------------------------------
function summarise(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => self.set(id, (self.get(id) || 0) + (deltas[i] || 0)));
  const script = (url) => (!url ? "(page)" : /dxbi\.plugin\.js$/.test(url) ? "dx.bi plugin" : /dxbi-tv\.js$/.test(url) ? "TV shell" : /web\.stremio\.com/.test(url) ? "Stremio" : url.replace(/^.*\//, "").slice(0, 40));
  const name = (n) => {
    const f = n.callFrame;
    if (!f.url && /^\(/.test(f.functionName)) return f.functionName;
    const line = f.lineNumber + 1 - (/dxbi\.plugin\.js$/.test(f.url) ? PLUGIN_LINE_OFFSET : 0);
    return `${f.functionName || "(anonymous)"} · ${script(f.url)}:${line}`;
  };
  const byScript = {};
  const byFn = {};
  const total = {};
  // inclusive time per function, counted once however deep it recurses
  const walk = (id, stack) => {
    const n = nodes.get(id);
    const key = name(n);
    let sum = self.get(id) || 0;
    const fresh = !stack.has(key);
    if (fresh) stack.add(key);
    for (const c of n.children || []) sum += walk(c, stack);
    if (fresh) { stack.delete(key); total[key] = (total[key] || 0) + sum; }
    return sum;
  };
  const rootNode = profile.nodes[0];
  walk(rootNode.id, new Set());
  let all = 0;
  for (const n of profile.nodes) {
    const t = self.get(n.id) || 0;
    if (!t) continue;
    const f = n.callFrame;
    const s = !f.url && /^\((idle|program|garbage collector)\)$/.test(f.functionName) ? f.functionName : script(f.url);
    byScript[s] = (byScript[s] || 0) + t;
    byFn[name(n)] = (byFn[name(n)] || 0) + t;
    if (s !== "(idle)") all += t;
  }
  const top = (o, n, skip) => Object.entries(o).filter(([k]) => !skip || !skip.test(k)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => [k, round(v / 1000)]);
  return {
    busyMs: round(all / 1000),
    byScript: Object.fromEntries(top(byScript, 12)),
    self: top(byFn, 45, /^\((idle|program)\)$/),
    inclusivePlugin: top(Object.fromEntries(Object.entries(total).filter(([k]) => /dx\.bi plugin|TV shell/.test(k))), 45),
  };
}

// ---------------------------------------------------------------------------------------------
// A browser trace, boiled down: what the page's main thread spent its time on
// ---------------------------------------------------------------------------------------------
const KIND = {
  script: /^(FunctionCall|EvaluateScript|v8\.|V8\.|EventDispatch|TimerFire|FireAnimationFrame|FireIdleCallback|RunMicrotasks|XHR|ProfileCall|WebSocket|MinorGC|MajorGC|BlinkGC|CppGC|v8)/,
  style: /^(UpdateLayoutTree|ScheduleStyleRecalculation|RecalculateStyles|StyleInvalidatorInvalidationTracking|ParseAuthorStyleSheet)/,
  layout: /^(Layout|InvalidateLayout|IntersectionObserverController|HitTest|UpdateLayerTree|ScrollLayer|PrePaint)/,
  paint: /^(Paint|PaintImage|Layerize|Commit|CompositeLayers|Decode|Raster|UpdateLayer|ImageDecode|Draw)/,
  load: /^(ParseHTML|Resource|CommitLoad|ResourceReceive)/,
};
function summariseTrace(events) {
  // the page's own main thread: the renderer main that did the most work
  const mains = events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args && e.args.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`);
  const work = {};
  for (const e of events) if (e.ph === "X" && e.name === "RunTask") { const k = `${e.pid}:${e.tid}`; if (mains.includes(k)) work[k] = (work[k] || 0) + e.dur; }
  const main = Object.entries(work).sort((a, b) => b[1] - a[1])[0];
  if (!main) return null;
  const mine = events.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === main[0] && e.dur >= 0).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = {};
  const count = {};
  const forced = { layouts: 0, ms: 0, styles: 0, styleMs: 0, by: {} };
  const tasks = [];
  const stack = [];
  const close = (until) => {
    while (stack.length && stack[stack.length - 1].end <= until) {
      const top = stack.pop();
      self[top.e.name] = (self[top.e.name] || 0) + Math.max(0, top.e.dur - top.kids);
    }
  };
  for (const e of mine) {
    close(e.ts);
    const parent = stack[stack.length - 1];
    if (parent) parent.kids += e.dur;
    count[e.name] = (count[e.name] || 0) + 1;
    // a layout or style pass asked for from inside script, before the frame needed it
    if ((e.name === "Layout" || e.name === "UpdateLayoutTree") && stack.some((x) => KIND.script.test(x.e.name))) {
      const trace = (e.args && ((e.args.beginData && e.args.beginData.stackTrace) || e.args.stackTrace)) || [];
      const frame = trace.find((f) => /dxbi/.test(f.url || "")) || trace[0];
      const who = frame ? `${frame.functionName || "(anonymous)"} · ${/dxbi\.plugin/.test(frame.url) ? `dx.bi plugin:${frame.lineNumber + 1 - PLUGIN_LINE_OFFSET}` : /dxbi-tv/.test(frame.url) ? `TV shell:${frame.lineNumber + 1}` : "Stremio"}` : "(no stack)";
      if (e.name === "Layout") { forced.layouts++; forced.ms += e.dur / 1000; } else { forced.styles++; forced.styleMs += e.dur / 1000; }
      forced.by[who] = (forced.by[who] || 0) + e.dur / 1000;
    }
    if (e.name === "RunTask" && e.dur > 50000) tasks.push(e);
    stack.push({ e, end: e.ts + e.dur, kids: 0 });
  }
  close(Infinity);
  const kinds = { script: 0, style: 0, layout: 0, paint: 0, load: 0, other: 0 };
  for (const [name, us] of Object.entries(self)) {
    const k = Object.keys(KIND).find((x) => KIND[x].test(name)) || "other";
    kinds[k] += us / 1000;
  }
  for (const k of Object.keys(kinds)) kinds[k] = round(kinds[k]);
  // V8's samples for this thread, so a long task can say which functions it was
  const [pid, tid] = main[0].split(":").map(Number);
  const fnNodes = new Map();
  const samples = [];
  // (each thread with script has a profile of its own, Stremio's core worker included: only the main thread's)
  const profile = events.find((x) => x.name === "Profile" && x.pid === pid && x.tid === tid);
  for (const e of events.filter((x) => profile && x.pid === pid && x.id === profile.id && (x.name === "Profile" || x.name === "ProfileChunk")).sort((a, b) => a.ts - b.ts)) {
    const d = e.args && e.args.data;
    if (!d) continue;
    if (e.name === "Profile") { samples.clock = d.startTime; continue; }
    for (const n of (d.cpuProfile && d.cpuProfile.nodes) || []) fnNodes.set(n.id, n);
    const ids = (d.cpuProfile && d.cpuProfile.samples) || [];
    const deltas = d.timeDeltas || [];
    ids.forEach((id, i) => { samples.clock = (samples.clock || e.ts) + (deltas[i] || 0); samples.push([samples.clock, id, deltas[i] || 0]); });
  }
  const where = (url) => (!url ? "" : /dxbi\.plugin\.js$/.test(url) ? "dx.bi plugin" : /dxbi-tv\.js$/.test(url) ? "TV shell" : /web\.stremio\.com/.test(url) ? "Stremio" : url.replace(/^.*\//, "").slice(0, 30));
  const fnName = (n) => {
    const f = n.callFrame;
    if (!f.url) return f.functionName || "(native)";
    return `${f.functionName || "(anonymous)"} · ${where(f.url)}:${f.lineNumber + 1 - (/dxbi\.plugin\.js$/.test(f.url) ? PLUGIN_LINE_OFFSET : 0)}`;
  };
  // the dx.bi function nearest the top of a sample's stack: whose work it was
  const owner = (id) => { for (let n = fnNodes.get(id); n; n = fnNodes.get(n.parent)) if (/dxbi/.test(n.callFrame.url || "")) return fnName(n); return null; };
  const rootOwner = (id) => { let found = null; for (let n = fnNodes.get(id); n; n = fnNodes.get(n.parent)) if (/dxbi/.test(n.callFrame.url || "")) found = n; return found ? fnName(found) : null; };
  const inWindow = (from, to) => {
    const self = {}, mineBy = {}, entry = {}, by = {};
    for (const [ts, id, dt] of samples) {
      if (ts < from || ts > to) continue;
      const n = fnNodes.get(id);
      if (!n || (!n.callFrame.url && /^\((idle|program)\)$/.test(n.callFrame.functionName))) continue;
      self[fnName(n)] = (self[fnName(n)] || 0) + dt;
      const scriptOf = where(n.callFrame.url) || "(native)";
      by[scriptOf] = (by[scriptOf] || 0) + dt;
      const o = owner(id);
      if (o) mineBy[o] = (mineBy[o] || 0) + dt;
      const r = rootOwner(id);
      if (r) entry[r] = (entry[r] || 0) + dt;
    }
    const list = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${round(v / 1000)}`);
    return { by: list(by, 5), self: list(self, 8), dxbi: list(mineBy, 8), entry: list(entry, 4) };
  };
  // what the longest tasks were made of
  const long = tasks.sort((a, b) => b.dur - a.dur).slice(0, 6).map((t) => {
    const inside = {};
    for (const e of mine) if (e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur) inside[e.name] = (inside[e.name] || 0) + e.dur;
    // (totals, not self time: enough to see whether a long task was script, style, layout or paint)
    return { ms: round(t.dur / 1000), made: Object.entries(inside).filter(([k]) => !/^(RunTask|RunMicrotasks|v8\.callFunction|ThreadControllerImpl|SimpleWatcher|ThreadPool|V8\.|ProfileCall)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${round(v / 1000)}`), ...inWindow(t.ts, t.ts + t.dur) };
  });
  // all the script in the scenario, by whose it was
  const whole = samples.length ? inWindow(-Infinity, Infinity) : null;
  return {
    kinds,
    top: Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, v]) => [k, round(v / 1000), count[k]]),
    forced: { layouts: forced.layouts, layoutMs: round(forced.ms), styles: forced.styles, styleMs: round(forced.styleMs), by: Object.entries(forced.by).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, round(v)]) },
    long,
    script: whole,
  };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------
const profileDir = resolve(opt("profile", join(tmpdir(), "dxbi-tv-lab")));
if (flag("fresh")) rmSync(profileDir, { recursive: true, force: true });
const chromeArgs = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-sync", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--window-size=1280,720",
  ...(flag("headful") ? [] : ["--headless=new"]), "about:blank"];
let browser = null;
if (DEVICE) {
  // the app's page, through adb: its debugging socket is named after the app's process
  const { execFileSync } = await import("node:child_process");
  const adb = (...args) => execFileSync(ADB, ["-s", DEVICE, ...args], { encoding: "utf8" }).trim();
  const pid = adb("shell", "pidof", "com.notdxbi.dxbi.tv").split(/\s+/)[0];
  if (!pid) throw new Error("dx.bi isn't running on the TV: open it first");
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  process.on("exit", () => { try { adb("forward", "--remove", `tcp:${PORT}`); } catch (_) { /* gone */ } });
} else {
  browser = spawn(findChrome(), chromeArgs, { stdio: "ignore" });
}
let cdp;
const errors = [];

async function main() {
  const target = await waitFor(DEVICE ? "dx.bi's page on the TV (is this a -PdxbiInspect=true build?)" : "the browser", async () => {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.find((t) => t.type === "page" && (!DEVICE || /web\.stremio\.com/.test(t.url)));
  }, 30000);
  const about = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const chromeVersion = (/Chrome\/([\d.]+)/.exec(about["User-Agent"] || about.Browser || "") || [, "120.0.0.0"])[1];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  cdp = new Cdp(ws);
  cdp.listeners.push((msg) => {
    if (msg.method === "Runtime.consoleAPICalled" && /error|warning/.test(msg.params.type)) errors.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    if (msg.method === "Runtime.exceptionThrown") errors.push(String((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text).slice(0, 300));
    if (msg.method === "Page.javascriptDialogOpening") cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  if (DEVICE) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: deviceRecorder });
    await cdp.eval(deviceRecorder);
  } else {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
    // MainActivity's: a desktop browser's identity plus dx.bi TV's mark (what switches the plugin's TV mode on)
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 dxbi-tv/${version}` });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injected });
  }

  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const ready = () => waitFor("a screen", () => cdp.eval(`!!document.querySelector(${JSON.stringify(PAGE_READY)}) && (${flag("no-plugin")} || !!window.__dxbi) && performance.now()`), 120000, 250);
  // The main thread has gone quiet (under a tenth busy for a while): what "the page has stopped working" means here
  const quiet = async (max = 60000, span = 2500) => {
    const start = Date.now();
    let prev = await metrics();
    let at = Date.now();
    for (;;) {
      await sleep(span);
      const now = await metrics();
      const t = Date.now();
      const used = (now.TaskDuration - prev.TaskDuration) / ((t - at) / 1000);
      if (used < 0.1) return true;
      if (t - start > max) return false;
      prev = now;
      at = t;
    }
  };
  const key = (k, code) => {
    const base = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
    // not awaited: a remote doesn't wait for the page either
    cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }).catch(() => {});
    cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }).catch(() => {});
  };
  const KEYS = { U: ["ArrowUp", 38], D: ["ArrowDown", 40], L: ["ArrowLeft", 37], R: ["ArrowRight", 39], E: ["Enter", 13] };
  const press = async (sequence, gap = 300) => {
    for (const c of sequence) {
      key(...KEYS[c]);
      await sleep(gap);
    }
  };

  // --- setting up: Stremio as a guest with the addons, at full speed (a real TV is used as it is) ---
  const onTv = DEVICE ? await cdp.eval(`(window.__dxbi && window.__dxbiTv && window.__dxbiTv.deviceInfo ? JSON.stringify(window.__dxbiTv.deviceInfo()) : "")`).catch(() => "") : "";
  console.log(DEVICE ? `dx.bi TV lab · on ${DEVICE} · ${onTv.slice(0, 200)} · ${about.Browser}` : `dx.bi TV lab · ${flag("no-plugin") ? "no plugin" : `plugin ${version}`} · ${about.Browser} · x${THROTTLE}`);
  if (!DEVICE) {
    await cdp.send("Page.navigate", { url: STREMIO });
    await ready();
    await quiet(40000);
    // a first visit's welcome, and anything else in the way
    await cdp.eval(`(() => { for (const m of document.querySelectorAll('[class*="modal-container"], [class*="welcome-modal"]')) { const x = m.querySelector('[class*="close-button"]'); if (x) x.click(); } })()`);
  }
  const have = DEVICE ? ADDONS : await cdp.eval(`(window.core || window.__permanentCore).getState("ctx").then((c) => c.profile.addons.map((a) => a.transportUrl))`);
  for (const url of ADDONS) {
    if (have.includes(url)) continue;
    try {
      const manifest = await (await fetch(url)).json();
      await cdp.eval(`(window.core || window.__permanentCore).dispatch({ action: "Ctx", args: { action: "InstallAddon", args: ${JSON.stringify({ manifest, transportUrl: url, flags: { official: false, protected: false } })} } })`);
      console.log(`  installed ${manifest.name}`);
      await sleep(1500);
    } catch (err) {
      console.log(`  couldn't install ${url}: ${err.message}`);
    }
  }
  // dx.bi's own offers (the Home pack, a few seconds in) and anything else that opens by itself
  const dismiss = () => cdp.eval(`(() => { let n = 0; while (document.querySelector(".dxtv-modal") && n++ < 4) window.__dxbiTv.back(); for (const m of document.querySelectorAll('[class*="modal-container"]')) { const x = m.querySelector('[class*="close-button"]'); if (x) x.click(); } return n; })()`).catch(() => 0);
  if (!DEVICE) await sleep(8000);
  await dismiss();
  if (flag("heavy") && !flag("no-plugin") && !DEVICE) {
    const CORE = "(window.core || window.__permanentCore)";
    const ROWS = `(await ${CORE}.getState("board")).catalogs.filter((c) => c.content && c.content.type === "Ready" && /^(movie|series)$/.test(c.type))`;
    const state = JSON.parse(await cdp.eval(`(async () => { const [lib, cw] = await Promise.all([${CORE}.getState("library"), ${CORE}.getState("continue_watching_preview")]); const rows = ${ROWS}; return JSON.stringify({ lib: lib.catalog.length, cw: cw.items.length, films: rows.filter((c) => c.type === "movie").flatMap((c) => c.content.content.slice(0, 3)).map((m) => ({ id: m.id, type: m.type, name: m.name })) }); })()`));
    if (state.lib < 12) {
      // My List: titles in the library
      await cdp.eval(`(async () => { const rows = ${ROWS}; for (const m of rows.slice(0, 4).flatMap((c) => c.content.content.slice(3, 7))) ${CORE}.dispatch({ action: "Ctx", args: { action: "AddToLibrary", args: m } }); })()`);
      console.log("  added titles to the library");
      await sleep(1500);
    }
    // Continue watching: films part-watched, through the same hand-off to the player as on the TV
    for (const m of state.films.slice(0, Math.max(0, 5 - state.cw))) {
      try {
        await cdp.eval(`window.__dxbiLab.played = null; location.hash = "#/detail/${m.type}/${encodeURIComponent(m.id)}/${encodeURIComponent(m.id)}"`);
        await waitFor("a stream", () => cdp.eval(`(() => { const a = [...document.querySelectorAll('a[href^="#/player/"]')].find((x) => !/trailer/i.test(x.textContent)); if (!a) return false; location.hash = a.getAttribute("href"); return true; })()`), 30000, 700);
        await waitFor("the player", () => cdp.eval("!!window.__dxbiLab.played"), 30000, 500);
        await cdp.eval(`(async () => { const tv = window.__dxbiTv, L = window.__dxbiLab, p = JSON.parse(L.played); const total = 5400000, at = 600000 + ${m.id.length * 97531 % 3000000}; for (const ms of [20000, at - 60000, at]) { tv.onProgress(ms, total, false, false); await new Promise((r) => setTimeout(r, 600)); } L.pendingClose = JSON.stringify({ timeMs: at, durationMs: total, ended: false, next: false, error: null, hash: p.hash, videoId: p.videoId }); tv.playerClosed(); })()`);
        await sleep(2500);
        console.log(`  part-watched ${m.name}`);
      } catch (err) {
        console.log(`  couldn't part-watch ${m.name}: ${err.message}`);
        await dismiss();
      }
    }
    await cdp.eval(`location.hash = "#/"`);
    await sleep(2000);
    await quiet(30000);
  }
  if (!DEVICE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

  const result = { label: LABEL, at: new Date().toISOString(), plugin: flag("no-plugin") ? null : version, browser: about.Browser, throttle: DEVICE ? 1 : THROTTLE, device: DEVICE ? onTv || DEVICE : null, stepsTimed, scenarios: {} };
  const TRACE = flag("trace") || flag("trace-functions");
  const traced = [];
  cdp.listeners.push((msg) => { if (msg.method === "Tracing.dataCollected") for (const e of msg.params.value) traced.push(e); });
  const scenario = async (name, run, profiled = true) => {
    if (ONLY && !ONLY.includes(name)) return;
    process.stdout.write(`  ${name} … `);
    await cdp.eval("window.__dxbiLab && window.__dxbiLab.take()").catch(() => {});
    const m0 = await metrics();
    let tracing = TRACE && profiled;
    if (tracing) {
      traced.length = 0;
      await cdp.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack", ...(flag("trace-functions") ? ["disabled-by-default-v8.cpu_profiler"] : []), "v8.execute", "blink.user_timing", "loading"] } }).catch((err) => { tracing = false; console.log(`(no trace here: ${err.message}; a CPU profile instead)`); });
    }
    if (profiled && !tracing) await cdp.send("Profiler.start");
    const t0 = Date.now();
    let extra = {};
    try { extra = (await run()) || {}; } catch (err) { extra = { error: err.message }; }
    const wall = Date.now() - t0;
    let trace = null;
    if (tracing) {
      const done = new Promise((res) => { const fn = (msg) => { if (msg.method === "Tracing.tracingComplete") { cdp.listeners.splice(cdp.listeners.indexOf(fn), 1); res(); } }; cdp.listeners.push(fn); });
      await cdp.send("Tracing.end");
      await done;
      trace = summariseTrace(traced);
      traced.length = 0;
    }
    const profile = profiled && !tracing ? (await cdp.send("Profiler.stop")).profile : null;
    const m1 = await metrics();
    let lab = {};
    try { lab = JSON.parse(await cdp.eval("window.__dxbiLab.take()")); } catch (_) { /* the page went away */ }
    if (profile) writeFileSync(join(OUT, `${LABEL}-${name}.cpuprofile`), JSON.stringify(profile));
    try {
      const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      writeFileSync(join(OUT, `${LABEL}-${name}.jpg`), Buffer.from(shot.data, "base64"));
    } catch (_) { /* no picture */ }
    const long = (lab.long || []).map((l) => l[1]);
    const s = {
      wallMs: wall,
      busy: round(m1.TaskDuration - m0.TaskDuration, 2),
      script: round(m1.ScriptDuration - m0.ScriptDuration, 2),
      layout: round(m1.LayoutDuration - m0.LayoutDuration, 2),
      style: round(m1.RecalcStyleDuration - m0.RecalcStyleDuration, 2),
      layouts: m1.LayoutCount - m0.LayoutCount,
      styles: m1.RecalcStyleCount - m0.RecalcStyleCount,
      nodes: lab.nodes,
      cards: lab.cards,
      heapMB: round(m1.JSHeapUsedSize / 1048576, 1),
      listeners: m1.JSEventListeners,
      long: { count: long.length, max: Math.max(0, ...long), blocked: long.reduce((a, d) => a + Math.max(0, d - 50), 0), over350: long.filter((d) => d > 350).length },
      hash: lab.hash,
      ...extra,
    };
    if (lab.runs) {
      s.sync = { runs: lab.runs, ms: round(lab.loopMs), max: round(lab.loopMax), perRun: round(lab.loopMs / lab.runs, 1) };
      s.steps = Object.entries(lab.steps).map(([k, v]) => [k, round(v[0]), v[1], round(v[2])]).sort((x, y) => y[1] - x[1]).slice(0, 24);
    }
    if (lab.keys && lab.keys.length) {
      // a press counts as having moved the selection when focus changed before the next press was handled
      const moves = [];
      const delays = lab.keys.map((k) => k[1] - k[0]);
      let moved = 0;
      lab.keys.forEach((k, i) => {
        const until = i + 1 < lab.keys.length ? lab.keys[i + 1][1] : Infinity;
        const f = lab.focus.find((x) => x[0] >= k[1] && x[0] < until && x[1] !== k[3]);
        if (f) { moved++; moves.push(f[0] - k[0]); }
      });
      const sorted = (a) => [...a].sort((x, y) => x - y);
      const p = (a, q) => (a.length ? sorted(a)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);
      s.keys = { sent: extra.sent || lab.keys.length, heard: lab.keys.length, moved, delayP50: p(delays, 0.5), delayMax: Math.max(0, ...delays), moveP50: p(moves, 0.5), moveP90: p(moves, 0.9), moveMax: Math.max(0, ...moves), over350: delays.filter((d) => d > 350).length };
    }
    if (profile) s.profile = summarise(profile);
    if (trace) s.trace = trace;
    result.scenarios[name] = s;
    if (trace) process.stdout.write(`[script ${trace.kinds.script} · style ${trace.kinds.style} · layout ${trace.kinds.layout} · paint ${trace.kinds.paint} · other ${trace.kinds.other} ms · forced layouts ${trace.forced.layouts}] `);
    console.log(`busy ${s.busy}s · stalls ${s.long.count} (worst ${s.long.max} ms, ${s.long.over350} over 350)${s.sync ? ` · loop ${s.sync.runs}× ${s.sync.ms} ms` : ""}${s.keys ? ` · keys ${s.keys.moved}/${s.keys.sent} moved, late ${s.keys.delayP50}/${s.keys.delayMax} ms` : ""}${extra.error ? ` · ${extra.error}` : ""}`);
  };

  // 1. Opening dx.bi (the page loads from its cache, as on a TV that has run before)
  await scenario("start", async () => {
    await cdp.send("Page.reload");
    await sleep(300);
    const r = await ready();
    const calm = await quiet(90000);
    const settled = round(await cdp.eval("performance.now()")) - 2500;
    await dismiss();
    return { ready: round(r), settled, calm };
  });
  // 2. Home, nobody touching the remote
  await scenario("idle", async () => { await sleep(12000); });
  // 3. Around Home with the remote: down the rows, along them and back
  await scenario("nav", async () => {
    const seq = "DDRRRRRRRRDRRRRRRLLLLDDRRRRUUULLLLUU";
    await press(seq, 300);
    await quiet(20000, 1500);
    return { sent: seq.length };
  });
  // 4. Holding a direction down (a remote repeats about 8 times a second)
  await scenario("hold", async () => {
    const seq = "D" + "R".repeat(24) + "L".repeat(24);
    await press(seq, 120);
    await quiet(20000, 1500);
    return { sent: seq.length };
  });
  // 5. A title's page, until its stream list has settled
  await scenario("detail", async () => {
    await cdp.eval(`location.hash = "#/detail/${TITLE}/${TITLE.split("/")[1]}"`);
    const t0 = Date.now();
    let streams = 0;
    try { await waitFor("streams", async () => (streams = await cdp.eval(`document.querySelectorAll('[class*="streams-container"] [class*="stream-container"], section[class*="streams-"] [class*="group-"] > a[class*="stream-"]').length`)) > 3, 40000, 500); } catch (_) { /* none came */ }
    const first = Date.now() - t0;
    const calm = await quiet(60000);
    return { streamsAfterMs: first, streams: await cdp.eval(`document.querySelectorAll('[class*="streams-container"] [class*="stream-container"], section[class*="streams-"] [class*="group-"] > a[class*="stream-"]').length`), calm };
  });
  // 6. Down and up the stream list
  await scenario("streams", async () => {
    const seq = "DDDDDDDDDDDDUUUUUUDDDDDD";
    await press(seq, 250);
    await quiet(20000, 1500);
    return { sent: seq.length };
  });
  // 7. Back to Home
  await scenario("back", async () => {
    await cdp.eval(`(window.__dxbiTv && window.__dxbiTv.back && window.__dxbiTv.back()) || history.back()`);
    await sleep(500);
    const calm = await quiet(60000);
    return { calm };
  });
  // 8. Discover: a wall of posters
  await scenario("discover", async () => {
    await cdp.eval(`location.hash = "#/discover"`);
    await sleep(1500);
    await quiet(60000);
    const seq = "DDDRRRRDDDLLDDDDRRUUUU";
    await press(seq, 300);
    await quiet(20000, 1500);
    return { sent: seq.length };
  });
  // (only when asked for: --only play) A stream handed to the player: what Stremio's own player, left
  // underneath, does meanwhile. It must stay on its screen (the page keeps the watch progress) and
  // must not load the stream as well
  if (ONLY && ONLY.includes("play")) await scenario("play", async () => {
    await cdp.eval(`window.__dxbiLab.played = null; window.__dxbiLab.media = []; (() => { const seen = window.__dxbiLab.media; const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src"); new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/video|audio|other/.test(e.initiatorType)) seen.push(e.initiatorType + " " + e.name.slice(0, 80)); }).observe({ type: "resource", buffered: false }); })(); location.hash = "#/detail/${TITLE}/${TITLE.split("/")[1]}"`);
    await waitFor("a stream", () => cdp.eval(`(() => { const a = [...document.querySelectorAll('a[href^="#/player/"]')].find((x) => !/trailer/i.test(x.textContent)); if (!a) return false; location.hash = a.getAttribute("href"); return true; })()`), 40000, 700);
    await waitFor("the player", () => cdp.eval("!!window.__dxbiLab.played"), 40000, 500);
    await cdp.eval(`(async () => { const tv = window.__dxbiTv; for (const ms of [5000, 10000]) { tv.onProgress(ms, 5400000, false, false); await new Promise((r) => setTimeout(r, 2500)); } })()`);
    const state = JSON.parse(await cdp.eval(`JSON.stringify({ onPlayer: /^#\\/player\\//.test(location.hash), videos: [...document.querySelectorAll("video")].map((v) => ({ src: (v.getAttribute("src") || "").slice(0, 60), current: (v.currentSrc || "").slice(0, 60), network: v.networkState, ready: v.readyState, paused: v.paused, error: v.error ? v.error.code : 0 })), fetched: window.__dxbiLab.media, error: !!document.querySelector('[class*="error-container"]') })`));
    await cdp.eval(`(() => { const L = window.__dxbiLab, p = JSON.parse(L.played); L.pendingClose = JSON.stringify({ timeMs: 12000, durationMs: 5400000, ended: false, next: false, error: null, hash: p.hash, videoId: p.videoId }); window.__dxbiTv.playerClosed(); })()`);
    await sleep(2500);
    console.log(`\n    while the player had the stream: ${JSON.stringify(state)}`);
    return { play: state, leftPlayer: !(await cdp.eval(`/^#\\/player\\//.test(location.hash)`)) };
  }, false);

  // 9. A long evening: the same round again and again. What only ever grows (memory, the page, listeners,
  //    the main loop's cost per round) is what freezes a TV hours later
  if (SOAK) await scenario("soak", async () => {
    const titles = ["movie/tt0434409", "series/tt0903747", "movie/tt0133093", "series/tt0773262", "movie/tt0816692", "movie/tt0107120"];
    const points = [];
    const sample = async (i) => {
      await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
      await sleep(300);
      const m = await metrics();
      const page = JSON.parse(await cdp.eval(`JSON.stringify({ inPage: document.getElementsByTagName("*").length, runs: window.__dxbiLab.runs, loopMs: Math.round(window.__dxbiLab.loopMs) })`));
      points.push({ round: i, heapMB: round(m.JSHeapUsedSize / 1048576, 1), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, ...page });
    };
    await sample(0);
    for (let i = 1; i <= SOAK; i++) {
      await press("DDRRRRDRRR", 200);
      const t = titles[i % titles.length];
      await cdp.eval(`location.hash = "#/detail/${t}${t.startsWith("movie") ? `/${t.split("/")[1]}` : ""}"`);
      await sleep(4000);
      await quiet(15000, 1200);
      await press("DDDD", 200);
      await cdp.eval(`location.hash = "#/discover"`);
      await sleep(2500);
      await press("DDRR", 200);
      await cdp.eval(`location.hash = "#/"`);
      await sleep(2500);
      await quiet(15000, 1200);
      if (i % 2 === 0 || i === SOAK) await sample(i);
    }
    const first = points[0];
    const last = points[points.length - 1];
    console.log(`\n    heap ${first.heapMB} → ${last.heapMB} MB · nodes ${first.nodes} → ${last.nodes} · listeners ${first.listeners} → ${last.listeners}`);
    return { soak: points };
  }, false);

  result.errors = [...new Set(errors)].slice(0, 20);
  writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1));
  console.log(`\nsaved ${join(OUT, `${LABEL}.json`)}${result.errors.length ? ` · ${result.errors.length} page error(s), see "errors"` : ""}`);
}

// What the page was doing when the run gave up
async function diagnose() {
  if (!cdp) return;
  try {
    const state = await cdp.eval(`JSON.stringify({ url: location.href, ready: document.readyState, title: document.title, tv: !!window.__dxbiTv, plugin: !!window.__dxbi, script: !!document.getElementById("dxbi.plugin.js"), bridge: !!window.DxbiTV, body: document.body ? document.body.innerText.slice(0, 300) : null, nodes: document.getElementsByTagName("*").length })`, 15000);
    console.error(`  page: ${state}`);
    for (const e of [...new Set(errors)].slice(0, 12)) console.error(`  ${e}`);
    console.error(`  bridge: ${await cdp.eval('(() => { try { return typeof window.DxbiTV.pluginSource + " " + window.DxbiTV.pluginSource("x").length; } catch (e) { return "threw " + e.message; } })()', 15000)}`);
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60 }, 15000);
    writeFileSync(join(OUT, `${LABEL}-failed.jpg`), Buffer.from(shot.data, "base64"));
    console.error(`  picture: ${join(OUT, `${LABEL}-failed.jpg`)}`);
  } catch (err) {
    console.error(`  (no answer from the page: ${err.message})`);
  }
}

main().catch(async (err) => { console.error(`lab failed: ${err.stack || err.message}`); process.exitCode = 1; await diagnose(); })
  .finally(async () => {
    if (flag("keep")) return;
    // (a TV's app is left as it is)
    if (DEVICE) { setTimeout(() => process.exit(), 300); return; }
    try { if (cdp) await cdp.send("Browser.close", {}, 5000); } catch (_) { /* already gone */ }
    setTimeout(() => { try { browser.kill(); } catch (_) { /* gone */ } process.exit(); }, 1500);
  });
