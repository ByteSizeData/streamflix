// Integrity checks for dx.bi's theme and plugin, run in CI on every change. Each guards against a
// mistake that once reached users:
//  - 2.24: a rule dropped into the middle of another rule's selector list, so the TV and Windows
//    lost their "no blur" rule (comment inside a selector list, canary rule below)
//  - the theme bundled in the plugin drifting from dxbi.theme.css (run tools/bundle-theme.mjs)
//  - version numbers out of step between the plugin, its constant and the desktop app
//  - 2.22.0: a setting of an unknown type made the app reject every dx.bi setting
// Usage: node tools/integrity-test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// (Windows checks files out with \r\n line endings)
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const css = read("dxbi.theme.css");
const plugin = read("dxbi.plugin.js");
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log("PASS", name); } catch (err) { failures++; console.error("FAIL", name, "\n    ", err.message); }
};

// ---- the theme ----
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

check("theme braces balance", () => {
  let depth = 0;
  for (const [i, ch] of [...noComments].entries()) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    assert.ok(depth >= 0, `a closing brace without an opening one, line ${noComments.slice(0, i).split("\n").length}`);
  }
  assert.equal(depth, 0, "a rule isn't closed");
});

check("no comment inside a selector list (a rule dropped into another's selectors)", () => {
  // Every rule's selector is the text between the previous } (or ;/{ for nested at-rules) and its {.
  // Comments before the first selector are fine; a comment after a comma, between selectors, is not.
  const bad = [];
  const re = /(^|[{};])([^{};]*)\{/g;
  for (const m of css.matchAll(re)) {
    const head = m[2].replace(/^\s*(\/\*[\s\S]*?\*\/\s*)*/, "");
    if (/,\s*\/\*/.test(head) || /\*\/\s*,/.test(head)) bad.push(`line ${css.slice(0, m.index).split("\n").length + 1}: ${head.trim().split("\n")[0].slice(0, 80)}`);
  }
  assert.deepEqual(bad, [], bad.join("\n     "));
});

check("TV and Windows keep the 'no blur' rule (canary for 2.24's broken selector list)", () => {
  const rules = [...noComments.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
  const has = (name) => rules.find(([, sel]) => sel.split(",").map((s) => s.trim()).includes(name));
  const win = has(".dx-win #app *");
  assert.ok(win, "no rule for '.dx-win #app *'");
  assert.match(win[2], /backdrop-filter:\s*none\s*!important/, "the '.dx-win #app *' rule no longer turns blur off");
  // This build's TV has it in the one rule a TV tries on every element ("nothing glides"), not in
  // Windows' rule: two rules on every element cost a TV twice the matching
  const tv = has(".dx-tv #app *") || has("html.dx-tv :not(.dx-preview)");
  assert.ok(tv, "no 'no blur' rule for the TV");
  assert.match(tv[2], /backdrop-filter:\s*none\s*!important/, "the TV's rule no longer turns blur off");
});

// ---- the plugin ----
check("the theme bundled in the plugin matches dxbi.theme.css (run tools/bundle-theme.mjs)", () => {
  const m = plugin.match(/return \/\*@bundled-theme\*\/"((?:[^"\\]|\\.)*)"/);
  assert.ok(m, "no bundled theme in the plugin");
  assert.equal(JSON.parse(`"${m[1]}"`), css.replace(/^\/\*\*[\s\S]*?\*\/\s*/, ""), "bundled theme is out of date");
});

check("versions agree (plugin @version, PLUGIN_VERSION, desktop app)", () => {
  // (a custom build's version carries a suffix, "2.38.3-simkl.1", in all four places)
  const meta = plugin.match(/@version\s+(\S+)/)[1];
  const constant = plugin.match(/const PLUGIN_VERSION = "([^"]+)"/)[1];
  const app = read("app/version").trim();
  const pkg = JSON.parse(read("app/package.json")).version;
  assert.deepEqual({ constant, app, pkg }, { constant: meta, app: meta, pkg: meta });
});

check("every setting is a type the apps accept (input, toggle, select)", () => {
  const start = plugin.indexOf("\n  const SCHEMA = [");
  assert.ok(start > 0, "no SCHEMA");
  const block = plugin.slice(start, plugin.indexOf("\n  ];", start));
  const types = [...block.matchAll(/\btype:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(types.length > 20, `only ${types.length} settings found`);
  const bad = [...new Set(types.filter((t) => !["input", "toggle", "select"].includes(t)))];
  assert.deepEqual(bad, [], `unsupported setting types: ${bad.join(", ")}`);
});

check("scripts parse (plugin, dx.bi TV, phone engine)", () => {
  for (const f of ["dxbi.plugin.js", "tv/app/src/main/assets/dxbi-tv.js", "tv/app/src/mobile/assets/dxbi-engine.js"]) {
    execFileSync(process.execPath, ["--check", join(root, f)], { stdio: "pipe" });
  }
});

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll integrity checks passed");
