import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { join } from "path";
import Properties from "./Properties";
import Helpers from "../utils/Helpers";
import ExtractMetaData from "../utils/ExtractMetaData";
import { getLogger } from "../utils/logger";

const logger = getLogger("BuiltIn");

export const BUILT_IN_PLUGIN = "dxbi.plugin.js";

/**
 * StreamFlix ships inside the app. It's kept in the plugins folder like any other plugin, so the
 * plugin's own update check keeps working between app releases: the bundled copy only replaces
 * an older one.
 */
export function seedBuiltInPlugin(): void {
    // packaged: <app>/static; running from the source tree: the app path is dist/, one level down
    const bundled = [join(app.getAppPath(), "static", BUILT_IN_PLUGIN), join(app.getAppPath(), "..", "static", BUILT_IN_PLUGIN)]
        .find((p) => existsSync(p)) || join(app.getAppPath(), "static", BUILT_IN_PLUGIN);
    const installed = join(Properties.pluginsPath, BUILT_IN_PLUGIN);
    try {
        const content = readFileSync(bundled, "utf-8");
        const bundledVersion = ExtractMetaData.extractMetadataFromText(content)?.version;
        const installedVersion = existsSync(installed)
            ? ExtractMetaData.extractMetadataFromFile(installed)?.version
            : null;
        const custom = /simkl/i.test(bundledVersion || "");
        if (!installedVersion || (bundledVersion && (custom ? installedVersion !== bundledVersion : Helpers.isNewerVersion(bundledVersion, installedVersion)))) {
            writeFileSync(installed, content, "utf-8");
            logger.info(`Installed the built-in StreamFlix plugin v${bundledVersion}.`);
        }
    } catch (err) {
        logger.error("Failed to install the built-in StreamFlix plugin: " + (err as Error).message);
    }
}

// What comes over from Stremio Enhanced: the Stremio sign-in, library and app settings (browser
// storage), plugins and themes with their settings, and the streaming server it downloaded
// (not window transparency: StreamFlix's look isn't made for a see-through window)
const IMPORT_ITEMS = ["Local Storage", "IndexedDB", "Session Storage", "plugins", "themes", "streamingserver",
    "use_stremio_service_for_streaming", "use_server_js_for_streaming"];

/**
 * First launch only: offer to bring everything over from Stremio Enhanced, so StreamFlix opens signed
 * in and set up exactly as before.
 */
export async function offerEnhancedImport(): Promise<void> {
    const from = Properties.enhancedImportPath;
    const to = Properties.enhancedPath;
    const marker = join(to, ".import-offered");
    if (existsSync(marker) || existsSync(join(to, "Local Storage")) || !existsSync(join(from, "Local Storage"))) return;
    writeFileSync(marker, new Date().toISOString());

    // (DXBI_IMPORT=copy|fresh answers for automated tests)
    const preset = process.env.DXBI_IMPORT;
    const choice = preset ? (preset === "copy" ? 0 : 1) : await Helpers.showAlert(
        "question",
        "Bring your Stremio Enhanced setup?",
        "StreamFlix found Stremio Enhanced on this computer. It can copy your Stremio sign-in, library, settings, " +
        "plugins and themes over, so everything is just as you left it.\n\n" +
        "Close Stremio Enhanced first if it's open. Stremio Enhanced itself isn't changed.",
        ["Copy my setup", "Start fresh"]
    );
    if (choice !== 0) return;

    for (const item of IMPORT_ITEMS) {
        const src = join(from, item);
        if (!existsSync(src)) continue;
        try {
            cpSync(src, join(to, item), { recursive: true, force: true, errorOnExist: false });
            logger.info(`Imported ${item} from Stremio Enhanced.`);
        } catch (err) {
            logger.warn(`Couldn't import ${item}: ${(err as Error).message}`);
        }
    }
}

/**
 * Stremio's own app (Stremio 5) keeps its web profile, sign-in, addons, library and settings included,
 * in a WebView2 folder. Like the Stremio Enhanced import, StreamFlix offers once to copy it, so it opens
 * signed in and set up just as Stremio was. Stremio has to be closed meanwhile: it holds the files open.
 */
export async function offerStremioImport(): Promise<void> {
    const from = Properties.stremioImportPath;
    const to = Properties.enhancedPath;
    if (!from) return;
    const marker = join(to, ".stremio-import-offered");
    // Asked once, except after "Skip" (Stremio was open): then again next time. A profile that has no
    // marker at all is from before this build (plain StreamFlix) and is left alone; the one StreamFlix makes for
    // itself during a skipped first run must not count as that.
    const state = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
    if (state ? state !== "skipped" : existsSync(join(to, "Local Storage"))) return;
    if (!existsSync(join(from, "Local Storage"))) return;
    mkdirSync(to, { recursive: true });
    const offered = (result = "") => writeFileSync(marker, result || new Date().toISOString());

    // (DXBI_IMPORT=copy|fresh answers for automated tests)
    const preset = process.env.DXBI_IMPORT;
    const choice = preset ? (preset === "copy" ? 0 : 1) : await Helpers.showAlert(
        "question",
        "Bring your Stremio setup?",
        "StreamFlix found the Stremio app on this computer. It can copy your Stremio sign-in, addons, library and settings " +
        "over, so StreamFlix opens just as Stremio was.\n\nStremio itself isn't changed.",
        ["Copy my setup", "Start fresh"]
    );
    if (choice !== 0) { offered(); return; } // Start fresh: not asked again

    while (await isRunning("stremio-shell-ng.exe")) {
        const again = preset ? 1 : await Helpers.showAlert("warning", "Close Stremio first", "Stremio is still open, and it keeps its files to itself while it runs. Close it, then press Try again.", ["Try again", "Skip"]);
        if (again !== 0) { offered("skipped"); return; } // skipped for now: offered again next time
    }
    let failed = "";
    for (const item of ["Local Storage", "IndexedDB"]) {
        const src = join(from, item);
        if (!existsSync(src)) continue;
        // copied whole or not at all: never half a folder
        const tmp = join(to, `${item}.import`);
        try {
            rmSync(tmp, { recursive: true, force: true });
            cpSync(src, tmp, { recursive: true });
            rmSync(join(to, item), { recursive: true, force: true });
            renameSync(tmp, join(to, item));
            logger.info(`Imported ${item} from Stremio.`);
        } catch (err) {
            rmSync(tmp, { recursive: true, force: true });
            failed = (err as Error).message;
            logger.warn(`Couldn't import ${item} from Stremio: ${failed}`);
        }
    }
    offered();
    if (failed && !preset) await Helpers.showAlert("warning", "Couldn't copy your Stremio setup", `Part of it couldn't be copied (${failed}). You can sign in to Stremio in StreamFlix instead.`, ["OK"]);
}

function isRunning(image: string): Promise<boolean> {
    if (process.platform !== "win32") return Promise.resolve(false);
    return new Promise((resolve) => {
        execFile("tasklist", ["/FI", `IMAGENAME eq ${image}`], { windowsHide: true }, (err, stdout) => {
            resolve(!err && String(stdout).toLowerCase().includes(image.toLowerCase()));
        });
    });
}
