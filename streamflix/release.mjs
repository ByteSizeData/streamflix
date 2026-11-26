#!/usr/bin/env node
// Publishes a StreamFlix release of the branch as it stands.
//
//   node streamflix/release.mjs            on a computer, from a clean checkout of the pushed branch
//   node streamflix/release.mjs --ci       inside the Follow dx.bi workflow
//
//   --apks          also build the two Android apps here, signed with tv/keystore.properties, and
//                   attach them (for when the repository has no signing secrets; otherwise GitHub
//                   builds them). Wants JAVA_HOME (a JDK 17 or newer) and tv/local.properties.
//   --no-tv         with --apks: leave the TV app out of this release (the TV then isn't offered
//                   an update: its app looks for streamflix-tv.apk in the latest release)
//   --notes "text"  what's new, for the release page
//   --dry           everything except pushing the tag and publishing
//
// A release is: this branch, with streamflix/brand.mjs run over it (the name, the pictures, the
// version), committed under a tag vX.Y.N. The apps look at the latest release: the plugin attached
// to it reaches them by itself, and the Android apps offer and install the new APK. GitHub builds
// the iPhone/iPad IPA (and the APKs, given the signing secrets) and attaches them.
//
// The version: dx.bi's X.Y.Z, then StreamFlix's own count for it in the last part: 2.38.4 gives
// 2.38.401, 2.38.402 … and dx.bi 2.38.5 gives 2.38.501.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const has = (name) => process.argv.includes(`--${name}`);
const option = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const ci = has("ci"), dry = has("dry"), apks = has("apks"), noTv = has("no-tv");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
const git = (...args) => run("git", args);
const say = (text) => console.log(`release: ${text}`);

// --remote name: the git remote that is StreamFlix's repository ("origin" in a clone of it). Every
// push and every release goes there and nowhere else, whatever other remotes the checkout has.
const remote = option("remote") || "origin";
const repo = (git("remote", "get-url", remote).match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/) || [])[1];
if (!repo || /^notdxbi\//i.test(repo)) {
  console.error(`release: the remote "${remote}" isn't StreamFlix's repository (${repo || "not a GitHub address"}). Pass --remote <name>.`);
  process.exit(1);
}

// Where StreamFlix's own history starts: dx.bi 2.38.4. Every commit of ours since must carry one of
// GitHub's no-reply addresses, never a person's own: the repository is public.
const DXBI_BASE = "b518bc2bc40593ec8eeccdc41ba931e7a4d07b1d";
const emails = git("log", "--first-parent", "--format=%ae%n%ce", `${DXBI_BASE}..HEAD`).split("\n").filter(Boolean);
const personal = [...new Set(emails.filter((e) => !e.endsWith("@users.noreply.github.com")))];
if (personal.length) {
  console.error(`release: ${personal.length} author address(es) on this branch aren't GitHub no-reply addresses. Nothing published.`);
  process.exit(1);
}
if (git("status", "--porcelain")) {
  console.error("release: the checkout has changes that aren't committed. Nothing published.");
  process.exit(1);
}

const base = (readFileSync(join(root, "dxbi.plugin.js"), "utf8").match(/^ \* @version (\d+)\.(\d+)\.(\d+)\s*$/m) || []).slice(1).map(Number);
if (base.length !== 3) { console.error("release: no @version X.Y.Z in dxbi.plugin.js"); process.exit(1); }
const [major, minor, patch] = base;
if (patch > 99) { console.error(`release: the plugin's version is already a StreamFlix one (${base.join(".")}): run this on the branch, not on a release`); process.exit(1); }
const counts = git("ls-remote", "--tags", remote, `refs/tags/v${major}.${minor}.*`).split("\n")
  .map((line) => (line.match(/refs\/tags\/v\d+\.\d+\.(\d+)$/) || [])[1]).filter(Boolean).map(Number)
  .filter((n) => Math.floor(n / 100) === patch && n % 100 > 0).map((n) => n % 100);
const count = Math.max(0, ...counts) + 1;
if (count > 99) { console.error("release: ninety-nine StreamFlix releases of one dx.bi version is the limit of this numbering"); process.exit(1); }
const version = `${major}.${minor}.${patch * 100 + count}`;
const tag = `v${version}`;
const dxbi = `${major}.${minor}.${patch}`;
say(`StreamFlix ${version} (dx.bi ${dxbi}, StreamFlix release ${count} of it)`);

// The release's own commit, made in a checkout of its own so this one stays as it is
const work = ci ? join(process.env.RUNNER_TEMP || tmpdir(), `streamflix-${version}`) : join(root, "..", `streamflix-release`);
if (existsSync(work)) { try { git("worktree", "remove", "--force", work); } catch (_) { rmSync(work, { recursive: true, force: true }); git("worktree", "prune"); } }
git("worktree", "add", "--detach", work, "HEAD");
const inWork = (cmd, args, opts = {}) => run(cmd, args, { cwd: work, ...opts });
say(inWork(process.execPath, ["streamflix/brand.mjs", "--version", version]));
inWork("git", ["add", "-A"]);
inWork("git", ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-q", "-m", `StreamFlix ${version}`, "-m", `The branch at ${git("rev-parse", "--short", "HEAD")} as it is released: streamflix/brand.mjs run over it (the name, the pictures, the version). The apps of this release are built from this commit.`]);
inWork("git", ["tag", "-f", tag]);

const notes = [
  option("notes"),
  `StreamFlix ${version} is dx.bi ${dxbi} with StreamFlix's changes ([what they are](https://github.com/${repo}/blob/streamflix/streamflix/CHANGES.md)).`,
  "Installed apps pick this up by themselves: the plugin within a few hours of the app being opened, and the Android and Windows apps then offer the new app. For a first install: **streamflix-tv.apk** for an Android TV box, **streamflix-mobile.apk** for an Android phone or tablet, **streamflix.ipa** for an iPhone or iPad (through a signing service or sideloading app), **StreamFlix-Setup-x64.exe** for Windows, **streamflix-mac-arm64.dmg** for a Mac with Apple silicon or **streamflix-mac-x64.dmg** for an Intel Mac, **streamflix-linux-x86_64.AppImage** for Linux. The app files appear here some minutes after the release itself.",
  noTv ? "This release has no TV app: a TV keeps the one it has (the latest is in an earlier release)." : "",
].filter(Boolean).join("\n\n");

if (dry) {
  say(`dry run: ${tag} is made in ${work}, nothing pushed or published`);
} else {
  inWork("git", ["push", remote, tag]);
  inWork("gh", ["release", "create", tag, "dxbi.plugin.js", "--repo", repo, "--verify-tag", "--title", `StreamFlix ${version}`, "--notes", notes]);
  say(`published ${tag} with the plugin`);
  if (ci) {
    // A release made by a workflow doesn't start other workflows by itself: they're asked to run
    for (const workflow of ["android.yml", "apple.yml"]) inWork("gh", ["workflow", "run", workflow, "--repo", repo, "--ref", "streamflix", "-f", `tag=${tag}`]);
    say("asked for the Android and iPhone/iPad builds");
  }
}

if (apks) {
  for (const file of ["keystore.properties", "local.properties"]) {
    if (!existsSync(join(root, "tv", file))) { console.error(`release: tv/${file} is needed to build the Android apps here`); process.exit(1); }
    copyFileSync(join(root, "tv", file), join(work, "tv", file));
  }
  say("building the Android apps (some minutes)");
  // (Windows runs a .bat through its shell, which wants the whole path, quoted)
  const gradle = process.platform === "win32" ? JSON.stringify(join(work, "tv", "gradlew.bat")) : "./gradlew";
  execFileSync(gradle, ["assembleTvRelease", "assembleMobileRelease", "--no-daemon", "--console=plain", "-q"], { cwd: join(work, "tv"), stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, DXBI_UPDATE_REPO: repo } });
  const built = [["tv", "streamflix-tv.apk"], ["mobile", "streamflix-mobile.apk"]].filter(([flavor]) => !(noTv && flavor === "tv")).map(([flavor, name]) => {
    const to = join(work, name);
    copyFileSync(join(work, "tv/app/build/outputs/apk", flavor, "release", `app-${flavor}-release.apk`), to);
    return to;
  });
  if (dry) say(`dry run: the APKs are in ${work}`);
  else { inWork("gh", ["release", "upload", tag, ...built, "--repo", repo, "--clobber"]); say(`attached ${built.map((f) => f.split(/[\\/]/).pop()).join(" and ")}`); }
}
say("done");
