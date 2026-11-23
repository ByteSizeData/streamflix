// Copies dxbi.theme.css into dxbi.plugin.js (bundledThemeCss), so the plugin carries the whole look
// on its own, and syncs PLUGIN_VERSION and the desktop app's version (app/version, app/package.json)
// with @version. Run before every release: node tools/bundle-theme.mjs
//
// --theme-only: just the theme. A custom build's version carries a suffix ("2.26.0-simkl.1") that the
// app's and the desktop's numbers can't, so its versions are left exactly as they are.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// (a Windows checkout has CRLF endings; the plugin carries the theme with LF either way)
const css = readFileSync(root + "dxbi.theme.css", "utf8").replace(/\r\n/g, "\n").replace(/^\/\*\*[\s\S]*?\*\/\s*/, "");
const file = root + "dxbi.plugin.js";
const js = readFileSync(file, "utf8");
const re = /\/\*@bundled-theme\*\/"(?:[^"\\]|\\.)*"/;
if (!re.test(js)) throw new Error("bundledThemeCss marker not found");
if (process.argv.includes("--theme-only")) {
  writeFileSync(file, js.replace(re, () => "/*@bundled-theme*/" + JSON.stringify(css)));
  console.log(`bundled ${css.length} bytes of theme, versions left as they are`);
  process.exit(0);
}
const version = /@version\s+([\d.]+)/.exec(js)[1];
const out = js
  .replace(re, () => "/*@bundled-theme*/" + JSON.stringify(css))
  .replace(/const PLUGIN_VERSION = "[^"]*";/, `const PLUGIN_VERSION = "${version}";`);
writeFileSync(file, out);
console.log(`bundled ${css.length} bytes of theme`);

// The desktop app ships with this plugin built in and shares its version number
writeFileSync(root + "app/version", version + "\n");
const pkgFile = root + "app/package.json";
const pkg = readFileSync(pkgFile, "utf8");
writeFileSync(pkgFile, pkg.replace(/("version":\s*")[^"]*"/, `$1${version}"`));
console.log(`app version ${version}`);
