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

let renamed = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = rename(before);
  if (file === PLUGIN) after = dubsFirst(ownReports(restyle(after)));
  if (file === PLUGIN && version) after = stamp(after);
  if (after !== before) { writeFileSync(file, after); renamed++; }
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
