import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from "../constants";
import logger from "../utils/logger";
import Updater from '../core/Updater';

export function setupUpdater() {
    // a custom build (Simkl) is never offered the plain StreamFlix in its place
    if (/simkl/i.test(app.getVersion())) return;
    ipcMain.on(IPC_CHANNELS.UPDATE_CHECK_STARTUP, async (_, checkForUpdatesOnStartup: string) => {
        logger.info(`Checking for updates on startup: ${checkForUpdatesOnStartup === "true" ? "enabled" : "disabled"}.`);
        if (checkForUpdatesOnStartup === "true") {
            await Updater.checkForUpdates(false);
        }
    });
    
    ipcMain.on(IPC_CHANNELS.UPDATE_CHECK_USER, async () => {
        logger.info("Checking for updates on user request.");
        await Updater.checkForUpdates(true);
    });
}