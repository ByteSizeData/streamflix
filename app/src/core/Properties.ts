import { homedir } from "os";
import { join } from "path";

class Properties {
    public static themeLinkSelector: string = "head > link[rel=stylesheet]";

    private static baseDataPath: string = process.platform === "win32"
        ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
        : process.platform === "darwin"
            ? join(homedir(), "Library", "Application Support")
            : join(homedir(), ".config");

    // DXBI_DATA_DIR keeps a source build's plugins, themes and server apart from an installed StreamFlix
    public static enhancedPath = process.env.DXBI_DATA_DIR || join(Properties.baseDataPath, "streamflix");

    public static themesPath = join(Properties.enhancedPath, "themes");
    public static pluginsPath = join(Properties.enhancedPath, "plugins");

    // Stremio Enhanced's folder: StreamFlix offers to bring your sign-in and settings over from it once
    public static enhancedImportPath = join(Properties.baseDataPath, "stremio-enhanced");

    // Stremio's own app (Stremio 5) keeps its web profile here on Windows: StreamFlix offers to bring it over once
    public static stremioImportPath = process.platform === "win32"
        ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "StremioService", "stremio-shell-ng.exe.WebView2", "EBWebView", "Default")
        : "";
}

export default Properties;