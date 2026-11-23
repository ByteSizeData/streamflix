// node tools/simkl-smoke.mjs [screenshot dir]: the dx.bi app from source (app/dist), with Simkl.
// Checks that the plugin loads with its Simkl settings, that the Simkl dialog opens and really talks
// to api.simkl.com (a made-up client ID is refused), and that Simkl rows are drawn on Home from a
// saved list. Uses its own data folder, so an installed dx.bi is never touched. Needs `npm run dist`
// in app/ first, and Node 22+.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] || "simkl-shots";
mkdirSync(outDir, { recursive: true });
// A packaged dx.bi (app/release-builds/win-unpacked/dx.bi.exe) can be given as the second argument;
// without one the app runs from source (app/dist)
const exe = process.argv[3] && resolve(process.argv[3]);
const electron = exe || createRequire(join(root, "app", "package.json"))("electron");
const dataDir = mkdtempSync(join(tmpdir(), "dxbi-simkl-"));

const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

console.log(`launching ${electron} (data in ${dataDir})`);
// (ELECTRON_RUN_AS_NODE, set by some editors and the Claude desktop app, would run Electron as plain Node)
const env = { ...process.env, DXBI_DATA_DIR: dataDir, DXBI_IMPORT: "fresh" };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, [...(exe ? [] : ["./dist/main.js"]), `--remote-debugging-port=${PORT}`, "--no-stremio-server", "--window-size=1600,900"], {
  cwd: join(root, "app"),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", (d) => { appLog += d; });
app.stderr.on("data", (d) => { appLog += d; });
app.on("exit", (code) => console.log(`app exited (${code})`));

async function waitFor(what, fn, timeout = 60000, every = 500) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (_) { /* not ready yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

let ws;
let nextId = 1;
const pending = new Map();
const listeners = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function screenshot(name) {
  try {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  } catch (e) {
    console.log(`  (screenshot ${name} failed: ${e.message})`);
  }
}

async function main() {
  const target = await waitFor("the Stremio window", async () => {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    return list.find((t) => t.type === "page" && t.url.startsWith("https://web.stremio.com"));
  }, 120000);
  pass(`window opened (${target.url})`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  listeners.push((msg) => {
    if (msg.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || "");
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (/\[dx\.bi\].*simkl/i.test(text)) console.log(`    console: ${text.slice(0, 200)}`);
      if (msg.params.type === "error" && /simkl/i.test(text)) errors.push(text);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");

  await waitFor("Stremio to finish loading", () => evaluate("document.readyState === 'complete'"));
  await waitFor("the plugin to be switched on", () => evaluate(`localStorage.setItem("enabledPlugins", ${JSON.stringify(JSON.stringify(["dxbi.plugin.js"]))});
    localStorage.setItem("checkForUpdatesOnStartup", "false");
    localStorage.setItem("dxbi.packOffered", "1");
    localStorage.setItem("dxbi.settings", JSON.stringify({ splash: false, introSound: false }));
    localStorage.getItem("enabledPlugins").includes("dxbi.plugin.js")`), 30000);
  await send("Page.reload", { ignoreCache: true });
  await sleep(2000);

  await waitFor("dx.bi to start", () => evaluate("typeof window.__dxbi === 'object' && !!window.__dxbi.settings"), 60000);
  pass("dx.bi loaded");
  const version = await evaluate("window.__dxbi.settings && document.querySelector('script#dxbi\\\\.plugin\\\\.js') ? 'inline' : 'n/a'");
  console.log(`    plugin script: ${version}`);

  // Simkl is there, with its settings
  if (await evaluate("typeof window.__dxbi.simkl === 'object' && typeof window.__dxbi.simkl.open === 'function'")) pass("Simkl module present");
  else fail("Simkl module missing from dx.bi");
  const simklSettings = await evaluate("[window.__dxbi.settings.simklRows, window.__dxbi.settings.simklScrobble, window.__dxbi.settings.simklAnime]");
  if (JSON.stringify(simklSettings) === JSON.stringify(["watching", true, true])) pass("Simkl settings at their defaults");
  else fail(`Simkl settings unexpected: ${JSON.stringify(simklSettings)}`);
  const registered = await evaluate("window.StremioEnhancedAPI.getRegisteredSettings('dxbi').then((s) => (s || []).filter((o) => /^simkl/.test(o.key)).map((o) => o.key + '@' + o.group))").catch(() => null);
  if (registered && registered.length === 3) pass(`Simkl options registered in Settings: ${registered.join(", ")}`);
  else fail(`Simkl options not registered: ${JSON.stringify(registered)}`);

  // The dialog, and a real round trip to api.simkl.com (a made-up key is refused)
  await waitFor("Home", () => evaluate("location.hash === '' || location.hash === '#/' || location.hash.startsWith('#/?')"), 30000).catch(() => evaluate("location.hash = '#/'; true"));
  await sleep(1500);
  await evaluate("window.__dxbi.simkl.open(); true");
  if (await evaluate("!!document.querySelector('.dxs .dxs-input') && !!document.querySelector('.dxs [data-act=connect]')")) pass("Simkl dialog opens with the client ID field");
  else fail("Simkl dialog didn't open");
  await screenshot("simkl-connect");
  await evaluate("document.querySelector('.dxs .dxs-input').value = 'dxbi00000000000000000000000000000000'; window.__dxbi.simkl.act('connect'); true");
  try {
    const msg = await waitFor("Simkl's answer", () => evaluate("(document.querySelector('.dxs .dxe-msg.is-bad') || {}).textContent"), 30000);
    if (/client ?ID|client_id/i.test(msg)) pass(`api.simkl.com answered from inside the app: "${msg}"`);
    else fail(`unexpected answer from Simkl: "${msg}"`);
  } catch (e) {
    fail(`no answer from Simkl: ${e.message}`);
  }
  await screenshot("simkl-refused");
  await evaluate("window.__dxbi.simkl.close(); true");

  // Rows on Home from a saved list (no network: a pretend connection and a cache that's still fresh)
  const rows = [
    { key: "watching", name: "Simkl · Watching", list: [
      { _id: "tt0903747", type: "series", video: "tt0903747:2:5", name: "Breaking Bad · S2 E5", poster: "https://images.metahub.space/poster/small/tt0903747/img" },
      { _id: "tt0877057", type: "series", video: "tt0877057:1:12", name: "Death Note · S1 E12", poster: "https://images.metahub.space/poster/small/tt0877057/img" },
    ] },
    { key: "plantowatch", name: "Simkl · Plan to Watch", list: [
      { _id: "tt1160419", type: "movie", name: "Dune", poster: "https://images.metahub.space/poster/small/tt1160419/img" },
      { _id: "tt1727587", type: "movie", name: "Sintel", poster: "https://images.metahub.space/poster/small/tt1727587/img" },
    ] },
  ];
  await evaluate(`window.__dxbi.simkl.save({ v: 2, clientId: "dxbi00000000000000000000000000000000", auth: 2, access: "pretend", refresh: "", exp: Date.now() + 86400e3, user: { name: "smoke", id: 1, type: "free" } });
    const sig = "main|dxbi00000000000000000000000000000000|watching,plantowatch|anime";
    localStorage.setItem("dxbi.simkl.lists", JSON.stringify({ sig, t: Date.now(), at: Date.now(), all: "pretend", rows: ${JSON.stringify(rows)} }));
    window.__dxbi.sync(); true`);
  try {
    await waitFor("Simkl rows on Home", () => evaluate("document.querySelectorAll('.dxe-simkl').length === 2"), 45000);
    const cards = await evaluate("[...document.querySelectorAll('.dxe-simkl')].map((r) => [r.querySelector('[class*=\"title-\"]').textContent, [...r.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))])");
    pass(`Simkl rows drawn: ${JSON.stringify(cards)}`);
    const [[, links]] = cards;
    if (links[0] === "#/detail/series/tt0903747/tt0903747%3A2%3A5") pass("a Watching card opens the next episode");
    else fail(`Watching card link: ${links[0]}`);
    const order = await evaluate("[...document.querySelector('.dxe-simkl').parentElement.children].map((el) => el.className.split(' ').find((c) => /^dx/.test(c)) || el.className.split(' ')[0]).slice(0, 6)");
    console.log(`    Home order: ${order.join(" → ")}`);
    await evaluate("document.querySelector('.dxe-simkl').scrollIntoView({ block: 'center' }); true");
    await sleep(2500);
    await screenshot("simkl-rows");
  } catch (e) {
    fail(`Simkl rows missing: ${e.message}`);
    await screenshot("simkl-rows-missing");
  }
  await evaluate("window.__dxbi.simkl.open(); true");
  await sleep(500);
  const connectedText = await evaluate("(document.querySelector('.dxs .dxs-body') || {}).textContent || ''");
  if (/Connected as smoke/.test(connectedText) && /2 rows/.test(connectedText)) pass("the dialog shows the connection and the rows");
  else fail(`dialog text: ${connectedText.slice(0, 200)}`);
  await screenshot("simkl-connected");
  await evaluate("window.__dxbi.simkl.act('disconnect'); true");
  await sleep(800);
  if (await evaluate("document.querySelectorAll('.dxe-simkl').length === 0 && !window.__dxbi.simkl.connected()")) pass("disconnecting removes the rows");
  else fail("rows still there after disconnecting");
  await evaluate("window.__dxbi.simkl.close(); true");

  const simklErrors = errors.filter((e) => /simkl/i.test(e));
  if (simklErrors.length) for (const e of simklErrors) fail(`error mentioning Simkl: ${e.slice(0, 300)}`);
  else pass(`no errors mentioning Simkl (${errors.length} other page error(s) ignored)`);
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  fail(e.message);
}
if (failures.length) {
  exitCode = 1;
  console.log(`\n${failures.length} check(s) failed.`);
  console.log("--- app output (last 3000 chars) ---\n" + appLog.slice(-3000));
} else {
  console.log("\nAll Simkl checks passed.");
}
try { ws?.close(); } catch (_) { /* already closed */ }
try { app.kill(); } catch (_) { /* gone */ }
await sleep(1500);
try { rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* a file still open: the temp folder is cleaned later */ }
process.exit(exitCode);
