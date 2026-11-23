#!/usr/bin/env node
// Lays a newer dx.bi release over the branch that is checked out (the Follow dx.bi workflow runs it).
//
//   node streamflix/follow.mjs <tag this branch holds> <dx.bi's newer tag>
//
// Both releases must be fetched as refs/upstream/have and refs/upstream/latest. Run in the
// repository's root, on a clean checkout.
//   exit 0  dx.bi's changes are laid over and staged, streamflix/upstream says the new tag
//           (nothing is committed)
//   exit 2  they clash with StreamFlix's own: the checkout is put back as it was, and the files
//           that clash are printed
//
// It is dx.bi's changes between its two releases, laid over this branch as a three-way merge, with
// two things done differently from a plain merge:
//  - dx.bi's build scripts (.github/workflows) are left out. StreamFlix has its own, and a workflow
//    isn't allowed to change workflows.
//  - The plugin carries the whole theme inside it as one very long line, written by
//    tools/bundle-theme.mjs from dxbi.theme.css. Any change to the theme on both sides would clash
//    on that one line every time. So the plugin is merged with that line emptied on all three
//    sides, and the line is written again from the merged theme.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [have, latest] = process.argv.slice(2);
if (!have || !latest) { console.error("usage: node streamflix/follow.mjs <have tag> <latest tag>"); process.exit(1); }
const root = process.cwd();
const git = (args, opts = {}) => execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30, ...opts });
const PLUGIN = "dxbi.plugin.js";
const A = "refs/upstream/have", B = "refs/upstream/latest";
const tmp = mkdtempSync(join(tmpdir(), "follow-dxbi-"));

function clash(files) {
  console.log("These clash with StreamFlix's own changes:");
  for (const f of files) console.log("  " + f);
  git(["reset", "-q", "--hard"]);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

// 1. everything but the plugin and the workflows
const patch = git(["diff", "--binary", A, B, "--", ".", ":(exclude).github/workflows", `:(exclude)${PLUGIN}`]);
if (patch.length) {
  const file = join(tmp, "dxbi.patch");
  writeFileSync(file, patch);
  const applied = spawnSync("git", ["apply", "--3way", "--index", file], { cwd: root, encoding: "utf8" });
  if (applied.status !== 0) {
    const unmerged = git(["diff", "--name-only", "--diff-filter=U"], { encoding: "utf8" }).split("\n").filter(Boolean);
    console.log(applied.stderr.trim());
    clash(unmerged.length ? unmerged : ["(git apply refused the patch: see the lines above)"]);
  }
}

// 2. the plugin, its bundled theme set aside
const theme = /\/\*@bundled-theme\*\/"(?:[^"\\]|\\.)*"/;
const empty = (text) => text.replace(/\r\n/g, "\n").replace(theme, () => '/*@bundled-theme*/""');
const base = git(["show", `${A}:${PLUGIN}`], { encoding: "utf8" });
const theirs = git(["show", `${B}:${PLUGIN}`], { encoding: "utf8" });
if (base !== theirs) {
  const oursRaw = readFileSync(join(root, PLUGIN), "utf8");
  const crlf = oursRaw.includes("\r\n");
  const names = { ours: join(tmp, "ours.js"), base: join(tmp, "base.js"), theirs: join(tmp, "theirs.js") };
  writeFileSync(names.ours, empty(oursRaw));
  writeFileSync(names.base, empty(base));
  writeFileSync(names.theirs, empty(theirs));
  const merged = spawnSync("git", ["merge-file", "-p", names.ours, names.base, names.theirs], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
  if (merged.status !== 0) clash([`${PLUGIN} (${merged.status < 0 || merged.status > 126 ? "the merge failed" : merged.status + " place(s)"})`]);
  writeFileSync(join(root, PLUGIN), crlf ? merged.stdout.replace(/\n/g, "\r\n") : merged.stdout);
}
// (the theme line again, from the theme as it now stands)
execFileSync(process.execPath, ["tools/bundle-theme.mjs", "--theme-only"], { cwd: root, stdio: "inherit" });
git(["add", PLUGIN]);

// 3. what this branch now holds
writeFileSync(join(root, "streamflix/upstream"), latest + "\n");
git(["add", "streamflix/upstream"]);
rmSync(tmp, { recursive: true, force: true });
console.log(`dx.bi ${latest} laid over the branch (it held ${have})`);
