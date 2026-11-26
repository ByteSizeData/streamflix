#!/usr/bin/env node
// Turns a checkout of this branch into StreamFlix as it is released.
//
//   node streamflix/brand.mjs --version 2.38.401     (in a clean checkout: it changes files in place)
//
// The branch keeps dx.bi's name and dx.bi's version lines in its sources, so that dx.bi's releases
// merge into it without a clash. A StreamFlix release is this branch with this script run over it,
// committed under the release's tag (streamflix/release.mjs does that), so the tag holds exactly
// the source the apps were built from.
//
// What it does:
//  - writes the name StreamFlix where the apps say dx.bi (the page's scripts, the Android and
//    iPhone/iPad apps' own screens and messages)
//  - copies StreamFlix's icons and TV banner over dx.bi's, and takes dx.bi's intro film out
//  - with --version, writes that version into the plugin, which the apps take theirs from
// What it leaves: dx.bi's copyright lines and licence, and what is dx.bi's own (its Discord, its
// developer, its sync service's answers).
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const option = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const version = option("version");
if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("--version wants three numbers, e.g. 2.38.401");
  process.exit(1);
}

const NAME = "StreamFlix";
const SKIP_DIRS = new Set(["build", ".gradle", "node_modules", "SourcePackages"]);
function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(path, keep, out); } else if (keep(path)) out.push(path);
  }
  return out;
}

const PLUGIN = join(root, "dxbi.plugin.js");
const scripts = [PLUGIN, join(root, "tv/app/src/main/assets/dxbi-tv.js"), join(root, "tv/app/src/mobile/assets/dxbi-engine.js")];
const files = [
  ...scripts,
  join(root, "ios/project.yml"),
  ...walk(join(root, "tv/app/src"), (p) => /\.kt$/.test(p) || /[\\/]res[\\/]values[^\\/]*[\\/]strings\.xml$/.test(p)),
  ...walk(join(root, "ios/Dxbi"), (p) => /\.swift$/.test(p)),
];

// Kept word for word: dx.bi's copyright lines, and the things that are dx.bi's and not this copy's
const KEEP = [
  /dx\.bi(?: TV)? — Copyright \(C\) \d{4} dx\.bi/g,
  /dx\.bi's Discord/g,
  /dx\.bi's developer/g,
  /Not something dx\\\.bi syncs/g,
  // (the desktop app's About page: what it's built on)
  /Built on <a href="https:\/\/github\.com\/notdxbi\/dxbi-stremio"[^>]*>dx\.bi<\/a>/g,
];
function rename(text) {
  const kept = [];
  let t = text;
  for (const re of KEEP) t = t.replace(re, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  t = t
    .replaceAll("DX.BI", NAME.toUpperCase())
    .replaceAll("dx.bi", NAME)
    // (the name inside a regular expression: "dx\.bi TV", "(Stremio|dx\.bi)")
    .replaceAll("dx\\.bi", NAME)
    .replaceAll("dxbi.ipa", "streamflix.ipa");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

function stamp(text) {
  let hits = 0;
  const out = text
    .replace(/^( \* @version )\S+/m, (_, a) => { hits++; return a + version; })
    .replace(/(const PLUGIN_VERSION = ")[^"]+(")/, (_, a, b) => { hits++; return a + version + b; });
  if (hits !== 2) throw new Error(`the plugin's version is written in ${hits} places, expected 2`);
  return out;
}

// The top bar is laid out for dx.bi's five letters (a fixed box for the name, the tabs placed after
// it): ten letters wrapped onto two lines. These rules go at the end of the theme the plugin carries.
const BAR = `
/* StreamFlix: the name is ten letters where the bar was laid out for five */
#app nav[class*="horizontal-nav-bar"] [class*="logo-container"] { width: 8.2rem; }
#app nav[class*="horizontal-nav-bar"] [class*="logo-container"]::before { font-size: 1.9rem; white-space: nowrap; }
#app [class*="main-nav-bars-container"] > nav[class*="vertical-nav-bar"] { left: calc(var(--dx-gutter) + 8.2rem + 1.5rem); }
`;
function restyle(text) {
  const theme = /\/\*@bundled-theme\*\/("(?:[^"\\]|\\.)*")/;
  const found = theme.exec(text);
  if (!found) throw new Error("the theme the plugin carries wasn't found");
  return text.replace(theme, () => "/*@bundled-theme*/" + JSON.stringify(JSON.parse(found[1]) + BAR));
}

// "Report a problem" sends the app's details (version, device, settings, addon names, recent errors)
// to a relay that dx.bi's developer runs, for dx.bi's own Discord. StreamFlix's reports have no
// business there: its plugin is built with no relay, and Send says that reporting isn't set up.
function ownReports(text) {
  const relay = /(const REPORT_ENDPOINT = ")https:\/\/[^"]+(";)/;
  if (!relay.test(text)) throw new Error("the report relay's address wasn't found in the plugin");
  return text.replace(relay, "$1$2");
}

// "English dub first" is on in StreamFlix until someone turns it off: on an anime, or a title that
// isn't in English, the English dubs lead the stream list and are marked in blue. (dx.bi has it off.)
function dubsFirst(text) {
  const setting = /(\n    streamDubbed: )false,/;
  if (!setting.test(text)) throw new Error("the English dub setting's default wasn't found in the plugin");
  return text.replace(setting, "$1true,");
}

// The desktop app (app/, Windows, macOS and Linux): its screens and messages get the name too, it
// keeps its things in a folder of its own (not dx.bi's, so both can be on one computer), it looks for
// its updates in StreamFlix's releases, and its About page says what it is and what it's built on
const REPO = "ByteSizeData/streamflix";
const APP = join(root, "app");
const desktop = walk(join(APP, "src"), (p) => /\.(ts|html|css)$/.test(p));
files.push(...desktop, join(APP, "scripts", "fetch-mpv.sh"));
function must(text, from, to, what) {
  if (!text.includes(from)) throw new Error(`${what} wasn't found in the desktop app`);
  return text.replaceAll(from, to);
}
function desktopSource(file, text) {
  const is = (tail) => file.replaceAll("\\", "/").endsWith(tail);
  if (is("src/main.ts")) return must(text, 'app.setName("dxbi");', 'app.setName("streamflix");', "the app's name");
  if (is("src/core/Properties.ts")) return must(text, 'join(Properties.baseDataPath, "dxbi")', 'join(Properties.baseDataPath, "streamflix")', "the data folder");
  if (is("src/constants/index.ts")) {
    let t = must(text, "notdxbi/dxbi-stremio/raw/main/", `${REPO}/raw/streamflix/`, "the version address");
    t = must(t, "notdxbi/dxbi-stremio/main/", `${REPO}/streamflix/`, "the presence pictures' address");
    return must(t, "notdxbi/dxbi-stremio", REPO, "the releases' address");
  }
  if (is("components/about-category/about-category.html")) {
    const head = /^<div class="dxbi-about"[\s\S]*?\n<\/div>\n/;
    const coffee = /\n<div class="option-vFOAS">\s*<div class="content-P2T0i">\s*<a href="https:\/\/buymeacoffee\.com\/notdxbi"[\s\S]*?<\/a>\s*<\/div>\s*<\/div>\n/;
    const t = text.replace(/\r\n/g, "\n");
    if (!head.test(t) || !coffee.test(t)) throw new Error("the About page's heading or its Buy Me a Coffee button wasn't found");
    return t.replace(head, () => `<div class="dxbi-about" style="margin: 0.2rem 0 1.1rem; line-height: 1.7; color: #cfcfd6; font-size: 0.95rem;">
    <div><a href="https://github.com/${REPO}" target="_blank" rel="noreferrer" style="color: #fff; font-weight: 700; text-decoration: none;">${NAME} desktop app</a> <span style="color: #8d8d96;">· v{{ version }}</span></div>
    <div style="color: #8d8d96;">Built on <a href="https://github.com/notdxbi/dxbi-stremio" target="_blank" rel="noreferrer" style="color: var(--primary-accent-color); text-decoration: none;">dx.bi</a>, free software under the GNU GPL</div>
</div>
`).replace(coffee, "\n");
  }
  return text;
}

let renamed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  // (the desktop's own changes first: the About page's credit to dx.bi keeps dx.bi's name, see KEEP)
  let after = rename(desktop.includes(file) ? desktopSource(file, before) : before);
  if (file === PLUGIN) after = dubsFirst(ownReports(restyle(after)));
  if (file === PLUGIN && version) after = stamp(after);
  if (after !== before) { writeFileSync(file, after); renamed++; }
}

// The desktop app's package: its name, where it's installed and updated from, its files' names, and
// (with --version) the version the release has, which its updater compares with the releases' tags
{
  const path = join(APP, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const b = pkg.build;
  if (!b || !b.nsis || !b.portable || !b.linux) throw new Error("the desktop app's build settings weren't found");
  pkg.name = "streamflix";
  pkg.description = `${NAME}: a Netflix-style streaming app for your Stremio addons, built on dx.bi.`;
  pkg.repository = `https://github.com/${REPO}.git`;
  pkg.author = NAME;
  if (version) pkg.version = version;
  b.appId = "app.streamflix.desktop";
  b.productName = NAME;
  b.publish = { provider: "github", owner: REPO.split("/")[0], repo: REPO.split("/")[1] };
  b.artifactName = "streamflix-${os}-${arch}.${ext}";
  b.nsis.artifactName = `${NAME}-Setup-\${arch}.\${ext}`;
  b.portable.artifactName = `${NAME}-portable-\${arch}.\${ext}`;
  b.linux.executableName = "streamflix";
  writeFileSync(path, JSON.stringify(pkg, null, "\t") + "\n");
  // (the lock file names the package too)
  const lockPath = join(APP, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.name = "streamflix";
  if (lock.packages && lock.packages[""]) lock.packages[""].name = "streamflix";
  if (version) { lock.version = version; if (lock.packages && lock.packages[""]) lock.packages[""].version = version; }
  writeFileSync(lockPath, JSON.stringify(lock, null, "\t") + "\n");
  if (version) writeFileSync(join(APP, "version"), version);
  renamed += 2;
}

// StreamFlix's pictures, laid out as the files they replace
const overlay = join(root, "streamflix/art/overlay");
let copied = 0;
for (const from of walk(overlay, () => true)) {
  const to = join(root, relative(overlay, from));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}

// The page's scripts must still be scripts
for (const script of scripts) execFileSync(process.execPath, ["--check", script], { stdio: "inherit" });
const left = scripts.map((s) => (readFileSync(s, "utf8").match(/dx\.bi/g) || []).length).reduce((a, b) => a + b, 0);
console.log(`${NAME}${version ? " " + version : ""}: the name written into ${renamed} files, ${copied} pictures copied, "dx.bi" left in ${left} places of the scripts (its copyright lines and what is its own)`);
