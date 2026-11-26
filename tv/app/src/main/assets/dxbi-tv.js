// dx.bi TV — Copyright (C) 2026 dx.bi. GNU General Public License, version 3 or later (see LICENSE).
// StreamFlix TV: runs in web.stremio.com before the page's own scripts. It stands in for Stremio Enhanced
// (the plugin API StreamFlix expects), loads the built-in StreamFlix plugin, fits the page to a TV, and hands
// every stream to the app's native player, keeping Stremio's watch progress in step.
(function () {
  "use strict";
  if (window.__dxbiTv) return;
  // Every call to the app carries this launch's token (the app writes it in here): the app's
  // bridge is visible to every frame, embedded trailers included, but only this page knows it
  const TOKEN = "__DXBI_TV_TOKEN__";
  const bridge = window.DxbiTV;
  if (!bridge) return;
  const native = {
    pluginSource: () => bridge.pluginSource(TOKEN),
    getSettings: (plugin) => bridge.getSettings(TOKEN, plugin),
    saveSetting: (plugin, key, valueJson) => bridge.saveSetting(TOKEN, plugin, key, valueJson),
    play: (json) => bridge.play(TOKEN, json),
    activePlayback: () => bridge.activePlayback(TOKEN),
    takePendingClose: () => bridge.takePendingClose(TOKEN),
    openExternal: (url) => bridge.openExternal(TOKEN, url),
    control: (command) => bridge.control(TOKEN, JSON.stringify(command)),
    findServers: () => bridge.findServers(TOKEN),
    torrentUrl: (json) => (bridge.torrentUrl ? bridge.torrentUrl(TOKEN, json) : ""),
    thaiSubtitles: (json) => { if (bridge.thaiSubtitles) bridge.thaiSubtitles(TOKEN, json); },
    // (an older app has no question to ask: null)
    askTorrent: () => (bridge.askTorrent ? new Promise((resolve) => { tv.torrentAnswer = (n) => { tv.torrentAnswer = null; resolve(n); }; bridge.askTorrent(TOKEN); }) : Promise.resolve(null)),
    deviceInfo: () => { try { return JSON.parse(bridge.deviceInfo ? bridge.deviceInfo(TOKEN) : "{}"); } catch (_) { return {}; } },
    utcOffset: () => { try { return bridge.utcOffset ? bridge.utcOffset(TOKEN) : null; } catch (_) { return null; } },
  };

  const PLUGIN = "dxbi.plugin.js";
  const tv = (window.__dxbiTv = {});
  // problem reports (the plugin's `report`) add these
  tv.deviceInfo = () => native.deviceInfo();
  // the device clock's offset from UTC in minutes (the plugin's deviceClock)
  tv.utcOffset = () => native.utcOffset();
  // the app plays the intro film itself (Intro.kt): the plugin's splash stays out of the way
  tv.nativeIntro = true;
  // this app's Back closes Anime Ultra (tv.back): the plugin shows it on a TV only then
  tv.animeUltra = true;

  // Stremio's router asks the page for its <base> tag each time it writes a link (history's hash
  // router: document.querySelector("base")). With none there, each asking was a search of the whole
  // page, ten thousand elements on Home, for every title's link: going back to Home spent a twentieth
  // of a second on a TV doing nothing else. A <base> tag with no address is found at once and changes
  // nothing (only one with an href changes where links lead). Put first, before the page has a head.
  try {
    if (!document.querySelector("base")) (document.head || document.documentElement).prepend(document.createElement("base"));
  } catch (_) { /* no page yet: the plugin adds it (see start) */ }

  // ---------------------------------------------------------------------------
  // Fit the page to the TV: lay it out 1280 CSS pixels wide (a 10-foot size on any screen). A phone
  // held upright gets a 600-pixel-wide page instead, which Stremio and StreamFlix lay out as a column.
  // ---------------------------------------------------------------------------
  const PHONE = (() => { try { return !!bridge.isPhone(); } catch (_) { return false; } })();
  tv.phone = PHONE;
  // (Android phones download torrents themselves, with StreamFlix's torrent engine: Downloads.kt, and so
  // does StreamFlix TV from 2.38.408. An iPhone has no engine, so no torrentUrl)
  tv.torrentDownloads = !!bridge.torrentUrl && (PHONE || !!bridge.downloadAdd);
  // Words written for a TV, as a phone shows them
  // (and words written for a computer, as a TV or phone shows them: settings said "on this PC only")
  const forDevice = (text) => {
    if (typeof text !== "string") return text;
    const own = PHONE ? "this phone" : "this TV";
    text = text.replace(/\bthis PC\b/g, own).replace(/\bthis computer\b/g, own);
    if (!PHONE) return text;
    return text.replace(/ On a TV, only[^.]*\./, "").replace(/\bthis TV's\b/g, "this phone's").replace(/\bthis TV\b/g, "this phone")
      .replace(/\bStreamFlix TV\b/g, "StreamFlix").replace(/under your profile menu → /g, "in Profile → ").replace(/in your profile menu\b/g, "in Profile");
  };
  const upright = () => PHONE && window.screen && screen.height > screen.width;
  let VIEWPORT = "width=1280, user-scalable=no";
  function fitViewport() {
    // Upright, a phone is laid out at its own width, so everything is the size Android apps are.
    // Marked from the screen, not the page: the keyboard opening makes the page look sideways.
    // (a phone on its side too: 1280 pixels across made everything tiny there)
    VIEWPORT = PHONE ? "width=device-width, initial-scale=1, user-scalable=no" : "width=1280, user-scalable=no";
    document.documentElement.classList.toggle("dx-phone", PHONE);
    document.documentElement.classList.toggle("dx-upright", upright());
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      if (!document.head) return;
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.append(meta);
    }
    if (meta.content !== VIEWPORT) meta.content = VIEWPORT;
  }
  // Watched only until <head> exists, then only <head> itself: a whole-page watcher ran on every change
  // the page made, for as long as it was open
  const viewportWatch = new MutationObserver(() => {
    fitViewport();
    if (!document.head) return;
    viewportWatch.disconnect();
    new MutationObserver(fitViewport).observe(document.head, { childList: true });
  });
  if (document.head) new MutationObserver(fitViewport).observe(document.head, { childList: true });
  else viewportWatch.observe(document.documentElement, { childList: true, subtree: true });
  fitViewport();
  // a phone turned between upright and sideways
  if (PHONE) window.addEventListener("resize", () => fitViewport());

  // ---------------------------------------------------------------------------
  // What Stremio Enhanced provides and StreamFlix relies on
  // ---------------------------------------------------------------------------

  // Stremio's router changes the address with pushState, which fires no event: StreamFlix listens for hashchange
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("hashchange"));
      return result;
    };
  }

  // Stremio drops window.core on some screens: keep the first working copy
  const permanent = (window.__permanentCore = { getState: null, dispatch: null });
  let services;
  Object.defineProperty(window, "services", {
    configurable: true,
    get() { return services; },
    set(value) {
      services = value;
      const core = value && value.core;
      if (core && core.getState && !permanent.getState) permanent.getState = core.getState.bind(core);
      if (core && core.dispatch && !permanent.dispatch) permanent.dispatch = core.dispatch.bind(core);
    },
  });
  const core = () => {
    const live = window.core || (services && services.core);
    return {
      getState: (live && live.getState && live.getState.bind(live)) || permanent.getState,
      dispatch: (live && live.dispatch && live.dispatch.bind(live)) || permanent.dispatch,
    };
  };

  const schemas = {};
  const savedListeners = {};

  // The app is asked once per plugin, not once per setting: StreamFlix reads about 75 settings as it
  // starts, and each answer was the whole settings object crossing from the app and parsed again.
  // The page keeps what it was given and what it saves (the app itself only writes settings while
  // the page is gone, after a crash).
  const settingsCache = {};
  function readSettings(plugin) {
    if (!settingsCache[plugin]) {
      try { settingsCache[plugin] = JSON.parse(native.getSettings(plugin) || "{}") || {}; } catch (_) { settingsCache[plugin] = {}; }
    }
    return settingsCache[plugin];
  }

  const api = {
    info: (plugin, message) => console.log(`[${plugin}]`, message),
    warn: (plugin, message) => console.warn(`[${plugin}]`, message),
    error: (plugin, message) => console.error(`[${plugin}]`, message),
    getSetting: async (plugin, key) => {
      const value = readSettings(plugin)[key];
      return value === undefined ? null : value;
    },
    getSettings: async (plugin) => ({ ...readSettings(plugin) }),
    saveSetting: async (plugin, key, value) => {
      const json = JSON.stringify(value === undefined ? null : value);
      native.saveSetting(plugin, key, json);
      // (as the app keeps it: what JSON carries of the value)
      readSettings(plugin)[key] = JSON.parse(json);
      const all = { ...readSettings(plugin) };
      for (const callback of savedListeners[plugin] || []) {
        try { callback(all); } catch (err) { console.error(err); }
      }
      return true;
    },
    // a promise, like Stremio Enhanced's (StreamFlix chains on it: without one it stopped before loading
    // the TV's saved settings, so changes in StreamFlix settings never took effect)
    registerSettings: async (plugin, schema) => { schemas[plugin] = schema; },
    onSettingsSaved: (plugin, callback) => { (savedListeners[plugin] = savedListeners[plugin] || []).push(callback); },
    showAlert: (type, title, message, buttons) => dialog({ title, message, buttons: buttons && buttons.length ? buttons : ["OK"] }),
    showPrompt: (plugin, title, message, defaultValue) => dialog({ title, message, buttons: ["OK", "Cancel"], input: defaultValue == null ? "" : String(defaultValue) })
      .then((r) => (r && r.button === 0 ? r.value : null)),
    // StreamFlix's "Open in mpv / VLC" goes to the app's own player here
    launchExternalPlayer: async (player, url) => {
      native.play(JSON.stringify({ url, title: document.title || "StreamFlix", hash: location.hash }));
      return { success: true };
    },
    getExternalPlayerPaths: async () => ({ vlc: null, mpv: null }),
    applyTheme: () => {},
    getGpuRenderer: async () => "auto",
    setGpuRenderer: async () => {},
  };
  // Downloads on the TV (Downloads.kt): the plugin's Downloads, the same as a computer's, saved by the
  // app. (A phone has its own screens for them, over the page)
  if (!PHONE && bridge.downloadAdd) {
    const heard = [];
    const list = () => { try { return JSON.parse(bridge.downloads(TOKEN) || "[]"); } catch (_) { return []; } };
    let asked = false;
    // (the app says so after every change, every second while one runs: one look at a time)
    tv.downloadsChanged = () => {
      if (asked || !heard.length) return;
      asked = true;
      setTimeout(() => {
        asked = false;
        const now = list();
        for (const cb of heard) { try { cb(now); } catch (err) { console.error(err); } }
      }, 0);
    };
    api.downloads = {
      list: async () => list(),
      settings: async (changes) => { try { return JSON.parse(bridge.downloadSettings(TOKEN, JSON.stringify(changes || null)) || "{}"); } catch (_) { return {}; } },
      onChange: (cb) => { heard.push(cb); },
      add: async (spec) => { try { return JSON.parse(bridge.downloadAdd(TOKEN, JSON.stringify(spec)) || "{}"); } catch (_) { return { ok: false }; } },
      action: async (verb, id) => { bridge.downloadAct(TOKEN, String(verb), String(id || "")); return true; },
      pickFolder: async () => { throw new Error("a TV has no folders to pick"); },
      // (a download plays in the TV's own player, from the TV)
      play: (id) => bridge.downloadAct(TOKEN, "play", String(id)),
    };
  }
  window.StremioEnhancedAPI = api;

  // ---------------------------------------------------------------------------
  // Dialogs (alerts, prompts, settings): plain page elements, so the remote's arrows and OK work
  // ---------------------------------------------------------------------------
  // Stremio's "A new version of Stremio is available · Reload the user interface" bar: on a remote it
  // took the focus coming back to Home (Down then did nothing, so the TV looked frozen), and OK on it
  // reloaded everything. Hidden: Stremio's new version is used from the next start instead.
  const STYLE = `
    div[class*="web-update-banner-"] { display: none !important; }
    .dxtv-modal { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.72); font-family: Inter, system-ui, sans-serif; }
    .dxtv-sheet { width: min(640px, 86vw); max-height: 84vh; overflow: auto; padding: 28px 30px; border-radius: 14px; background: #1c1c1c; color: #fff; box-shadow: 0 24px 80px rgba(0,0,0,.6); }
    .dxtv-sheet h2 { margin: 0 0 10px; font-size: 24px; font-weight: 700; }
    .dxtv-sheet p { margin: 0 0 18px; color: #c8c8c8; font-size: 16px; line-height: 1.5; white-space: pre-line; }
    .dxtv-sheet input[type=text] { width: 100%; box-sizing: border-box; margin: 0 0 18px; padding: 12px 14px; border: 2px solid #444; border-radius: 8px; background: #111; color: #fff; font-size: 17px; }
    .dxtv-sheet input[type=text]:focus { border-color: #fff; outline: none; }
    .dxtv-buttons { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; }
    .dxtv-btn { padding: 11px 22px; border: 0; border-radius: 8px; background: rgba(255,255,255,.14); color: #fff; font: 600 16px Inter, system-ui, sans-serif; cursor: pointer; transition: transform .15s, background-color .15s; }
    .dxtv-btn:focus { outline: none; background: #fff; color: #000; transform: scale(1.06); }
    .dxtv-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; margin: 0 0 8px; padding: 14px 16px; border: 0; border-radius: 10px; background: rgba(255,255,255,.06); color: #fff; text-align: left; font: 500 16px Inter, system-ui, sans-serif; cursor: pointer; }
    .dxtv-group { margin: 22px 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8d8d96; }
    .dxtv-sheet h2 + .dxtv-group { margin-top: 6px; }
    .dxtv-row:focus { outline: none; background: rgba(255,255,255,.18); transform: scale(1.015); }
    .dxtv-row small { display: block; margin-top: 4px; color: #9a9a9a; font-size: 13px; line-height: 1.4; }
    .dxtv-row b { flex: none; color: #e50914; font-weight: 700; }
    .dxtv-settings-entry { margin: 0 0 24px; }
    .dxtv-qr { display: block; width: 220px; height: 220px; margin: 0 auto 18px; border-radius: 8px; background: #fff; }
    /* No streaming server runs on the TV itself (debrid streams don't need one): no nagging bar */
    [class*="board-warning-container"] { display: none !important; }
    /* Stremio's "A new version of Stremio is available" bar: the TV takes the update itself (webUpdate) */
    [class*="web-update-banner"] { display: none !important; }
    .dxtv-toast { position: fixed; left: 50%; bottom: 48px; z-index: 2147483600; transform: translateX(-50%); padding: 14px 22px; border-radius: 10px; background: rgba(20,20,20,.94); color: #fff; font: 500 16px Inter, system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    /* The plugin's own dialogs (Simkl, Customise Home, reviews…) were drawn for a mouse: their buttons
       only lighten a little when selected, which a TV across the room doesn't show. The remote's
       selection gets the same ring the rest of the page has */
    .dxe-modal .dxe-btn:focus, .dxe-modal .dxs-input:focus, .dxe-modal a[href]:focus, .dxe-modal [tabindex]:focus { outline: 3px solid var(--dx-focus, #fff) !important; outline-offset: 3px; }
  `;
  function ensureStyle() {
    if (document.getElementById("dxtv-style")) return;
    const style = document.createElement("style");
    style.id = "dxtv-style";
    style.textContent = STYLE;
    (document.head || document.documentElement).append(style);
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let openModal = null;

  // Resolves with the button index (or { button, value } when there's an input); -1 when dismissed
  async function dialog({ title, message, buttons, input, qr }) {
    message = forDevice(message);
    ensureStyle();
    closeModal();
    // One dialog at a time: Stremio's own (a promotion, an addon to install) goes first, since it
    // holds on to the remote's focus while it's open
    while (document.querySelector('[class*="modal-container"]')) await new Promise((r) => setTimeout(r, 400));
    // (where the remote was before: it goes back there when the dialog closes)
    const before = document.activeElement;
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "dxtv-modal";
      el.innerHTML = `<div class="dxtv-sheet" role="dialog">
        <h2>${esc(title)}</h2>${message ? `<p>${esc(String(message).replace(/<[^>]+>/g, ""))}</p>` : ""}
        ${qr ? `<svg class="dxtv-qr" viewBox="-4 -4 37 37" aria-hidden="true"><path d="${qr}"/></svg>` : ""}
        ${input != null ? `<input type="text" value="${esc(input)}">` : ""}
        <div class="dxtv-buttons">${buttons.map((b, i) => `<button class="dxtv-btn" data-i="${i}">${esc(b)}</button>`).join("")}</div>
      </div>`;
      const field = el.querySelector("input");
      const finish = (i) => {
        const had = el.contains(document.activeElement);
        el.remove();
        if (openModal && openModal.el === el) openModal = null;
        if (had && before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
        resolve(input != null ? { button: i, value: field ? field.value : "" } : i);
      };
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (b) finish(Number(b.dataset.i));
      });
      document.body.append(el);
      openModal = { el, dismiss: () => finish(-1) };
      const first = field || el.querySelector(".dxtv-btn");
      first.focus();
      // a dialog of Stremio's that just closed hands focus back a moment later: take it again
      for (const ms of [150, 450]) setTimeout(() => { if (el.isConnected && !el.contains(document.activeElement)) first.focus(); }, ms);
    });
  }

  function closeModal() {
    if (openModal) openModal.dismiss();
  }

  function toast(text, ms = 4500) {
    // Behind the phone app's own screens the page can't be seen: the app shows it
    if (window.__dxbiEngine && bridge.toast) { bridge.toast(TOKEN, String(text)); return; }
    ensureStyle();
    document.querySelectorAll(".dxtv-toast").forEach((n) => n.remove());
    const el = document.createElement("div");
    el.className = "dxtv-toast";
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }

  // (the plugin's messages on a TV)
  tv.toast = (text, ms) => toast(text, ms);

  // ---------------------------------------------------------------------------
  // Streaming server: a TV has none of its own, and torrents need one. StreamFlix or Stremio running on
  // a computer on the same network has one (it listens on the network), so the app looks for it.
  // ---------------------------------------------------------------------------
  let serversWaiting = null;
  let playHereOnce = null; // the one stream chosen to play on this TV when no server turned up
  tv.serversFound = (urls) => {
    if (serversWaiting) serversWaiting(Array.isArray(urls) ? urls : []);
    serversWaiting = null;
  };
  const scanForServers = () => new Promise((resolve) => {
    serversWaiting = resolve;
    setTimeout(() => { if (serversWaiting === resolve) tv.serversFound([]); }, 25000);
    native.findServers();
  });

  async function useServer(url) {
    const { getState, dispatch } = core();
    if (!getState || !dispatch) return false;
    const ctx = await getState("ctx");
    const known = ((ctx && ctx.streamingServerUrls) || []).some((s) => (s && s.url ? s.url : s) === url);
    if (!known) dispatch({ action: "Ctx", args: { action: "AddServerUrl", args: url } });
    dispatch({ action: "Ctx", args: { action: "UpdateSettings", args: { ...ctx.profile.settings, streamingServerUrl: url } } });
    return true;
  }

  const serverName = (url) => /\/\/127\.0\.0\.1:/.test(url) ? "This TV (Stremio's app)" : url.replace(/^http:\/\/|\/$/g, "");

  // Resolves true once a server has been picked. `playHere`: a stream is waiting, so if there's no
  // server the choice to let this TV play it is still there
  async function findServer(playHere) {
    for (;;) {
      toast("Looking for StreamFlix on your network…", 6000);
      const urls = await scanForServers();
      document.querySelectorAll(".dxtv-toast").forEach((n) => n.remove());
      if (!urls.length) {
        const again = await dialog({
          title: "No streaming server found",
          message: "Open StreamFlix or Stremio on a computer connected to the same network as this TV, leave it running, then try again. On Windows, it also has to be allowed through the firewall on private networks.\n\nDebrid streams play without a streaming server.",
          buttons: playHere ? ["Try again", "Play it on this TV", "Close"] : ["Try again", "Close"],
        });
        if (again === 0) continue;
        if (playHere && again === 1) playHere();
        return false;
      }
      const pick = await dialog({
        title: urls.length === 1 ? "Streaming server found" : "Streaming servers found",
        message: "Torrents will play through the one you pick. Keep it running while you watch.",
        buttons: [...urls.map(serverName), "Cancel"],
      });
      if (pick < 0 || pick >= urls.length) return false;
      const ok = await useServer(urls[pick]);
      toast(ok ? `Using the streaming server at ${serverName(urls[pick])}` : "Couldn't change the streaming server. Try again from Settings.", 5000);
      return ok;
    }
  }

  // Report a problem: a description typed with the remote, then the plugin's report goes to the developer
  const reportProblem = tv.reportProblem = async () => {
    const dx = window.__dxbi;
    if (!dx || !dx.report) { toast("StreamFlix hasn't finished loading yet. Try again in a moment."); return; }
    const r = await dialog({
      title: "Report a problem",
      message: "What went wrong, and what were you doing? StreamFlix adds its version, this TV's model, your settings, addon names and recent errors. No passwords, keys or stream links are sent.",
      buttons: ["Send report", "Cancel"],
      input: "",
    });
    if (!r || r.button !== 0) return;
    toast("Sending…", 8000);
    try {
      const code = await dx.report.send(r.value || "");
      document.querySelectorAll(".dxtv-toast").forEach((n) => n.remove());
      await dialog({ title: "Report sent", message: `Thanks! Your report code is ${code}.\nPost it in dx.bi's Discord (#bug-reports) so it can be matched to you.`, buttons: ["OK"] });
    } catch (err) {
      document.querySelectorAll(".dxtv-toast").forEach((n) => n.remove());
      await dialog({ title: "Couldn't send the report", message: (err && err.message) || "Try again in a moment.", buttons: ["OK"] });
    }
  };

  // Support StreamFlix: many TVs have no browser, so a TV shows a code for the phone instead of a link
  const DONATE_URL = "";
  // Report a problem and Support are offered only where they lead somewhere: a build without a
  // report relay or a support page (StreamFlix) has neither
  const canReport = () => !!(window.__dxbi && window.__dxbi.canReport && window.__dxbi.canReport());
  const DONATE_QR = "M0 0h7v1h-7zM8 0h1v1h-1zM10 0h2v1h-2zM13 0h1v1h-1zM17 0h4v1h-4zM22 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM12 1h2v1h-2zM22 1h1v1h-1zM28 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h1v1h-1zM12 2h4v1h-4zM20 2h1v1h-1zM22 2h1v1h-1zM24 2h3v1h-3zM28 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM8 3h1v1h-1zM11 3h2v1h-2zM15 3h1v1h-1zM18 3h1v1h-1zM20 3h1v1h-1zM22 3h1v1h-1zM24 3h3v1h-3zM28 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h1v1h-1zM11 4h1v1h-1zM15 4h2v1h-2zM19 4h2v1h-2zM22 4h1v1h-1zM24 4h3v1h-3zM28 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM8 5h2v1h-2zM12 5h2v1h-2zM17 5h3v1h-3zM22 5h1v1h-1zM28 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h7v1h-7zM9 7h5v1h-5zM16 7h3v1h-3zM20 7h1v1h-1zM2 8h6v1h-6zM10 8h1v1h-1zM13 8h1v1h-1zM18 8h1v1h-1zM21 8h1v1h-1zM23 8h4v1h-4zM28 8h1v1h-1zM0 9h6v1h-6zM7 9h2v1h-2zM14 9h1v1h-1zM17 9h2v1h-2zM21 9h1v1h-1zM25 9h4v1h-4zM0 10h2v1h-2zM3 10h2v1h-2zM6 10h2v1h-2zM13 10h3v1h-3zM18 10h2v1h-2zM24 10h1v1h-1zM0 11h1v1h-1zM3 11h1v1h-1zM10 11h2v1h-2zM17 11h1v1h-1zM20 11h1v1h-1zM25 11h2v1h-2zM28 11h1v1h-1zM0 12h4v1h-4zM5 12h2v1h-2zM8 12h3v1h-3zM16 12h1v1h-1zM18 12h1v1h-1zM20 12h4v1h-4zM27 12h2v1h-2zM0 13h3v1h-3zM9 13h3v1h-3zM17 13h3v1h-3zM25 13h2v1h-2zM0 14h2v1h-2zM3 14h1v1h-1zM6 14h2v1h-2zM9 14h2v1h-2zM12 14h1v1h-1zM15 14h1v1h-1zM17 14h2v1h-2zM20 14h1v1h-1zM23 14h1v1h-1zM25 14h3v1h-3zM0 15h5v1h-5zM9 15h5v1h-5zM17 15h3v1h-3zM22 15h1v1h-1zM24 15h1v1h-1zM26 15h2v1h-2zM1 16h1v1h-1zM4 16h1v1h-1zM6 16h3v1h-3zM10 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM18 16h1v1h-1zM21 16h1v1h-1zM25 16h1v1h-1zM28 16h1v1h-1zM0 17h2v1h-2zM3 17h2v1h-2zM8 17h3v1h-3zM12 17h3v1h-3zM16 17h3v1h-3zM20 17h1v1h-1zM24 17h1v1h-1zM28 17h1v1h-1zM0 18h1v1h-1zM4 18h1v1h-1zM6 18h1v1h-1zM8 18h2v1h-2zM13 18h1v1h-1zM15 18h1v1h-1zM17 18h1v1h-1zM23 18h1v1h-1zM25 18h1v1h-1zM27 18h1v1h-1zM0 19h1v1h-1zM2 19h1v1h-1zM4 19h1v1h-1zM7 19h3v1h-3zM13 19h1v1h-1zM17 19h1v1h-1zM19 19h1v1h-1zM22 19h2v1h-2zM26 19h1v1h-1zM28 19h1v1h-1zM0 20h2v1h-2zM4 20h1v1h-1zM6 20h2v1h-2zM10 20h2v1h-2zM13 20h3v1h-3zM17 20h1v1h-1zM19 20h7v1h-7zM27 20h1v1h-1zM9 21h1v1h-1zM13 21h2v1h-2zM17 21h2v1h-2zM20 21h1v1h-1zM24 21h1v1h-1zM26 21h1v1h-1zM0 22h7v1h-7zM8 22h2v1h-2zM13 22h1v1h-1zM17 22h1v1h-1zM19 22h2v1h-2zM22 22h1v1h-1zM24 22h1v1h-1zM26 22h3v1h-3zM0 23h1v1h-1zM6 23h1v1h-1zM8 23h4v1h-4zM13 23h2v1h-2zM16 23h5v1h-5zM24 23h3v1h-3zM0 24h1v1h-1zM2 24h3v1h-3zM6 24h1v1h-1zM8 24h3v1h-3zM13 24h2v1h-2zM17 24h8v1h-8zM26 24h1v1h-1zM28 24h1v1h-1zM0 25h1v1h-1zM2 25h3v1h-3zM6 25h1v1h-1zM8 25h1v1h-1zM11 25h2v1h-2zM14 25h1v1h-1zM16 25h1v1h-1zM21 25h2v1h-2zM25 25h3v1h-3zM0 26h1v1h-1zM2 26h3v1h-3zM6 26h1v1h-1zM8 26h1v1h-1zM12 26h1v1h-1zM14 26h1v1h-1zM16 26h3v1h-3zM20 26h3v1h-3zM24 26h3v1h-3zM28 26h1v1h-1zM0 27h1v1h-1zM6 27h1v1h-1zM11 27h1v1h-1zM15 27h1v1h-1zM19 27h3v1h-3zM23 27h5v1h-5zM0 28h7v1h-7zM9 28h1v1h-1zM13 28h1v1h-1zM17 28h1v1h-1zM20 28h2v1h-2zM25 28h1v1h-1z";
  const donate = () => {
    if (PHONE) { native.openExternal(DONATE_URL); return; }
    dialog({ title: "Support StreamFlix", message: "Scan this with your phone, or go to buymeacoffee.com/notdxbi", qr: DONATE_QR, buttons: ["Done"] });
  };

  // StreamFlix's settings: an entry at the top of Stremio's Settings, opening a list made for the remote
  // Options for StreamFlix's in-page player, which the TV doesn't use (it has its own player)
  const DESKTOP_ONLY = new Set(["playerExtras", "enhance", "seekPreviews", "subtitleStyle", "subtitleFont", "subtitleCustomFont",
    "convertVideo", "subtitlesStart", "hdrSubtitles", "pictureSound", "streamStats", "preloadNext", "skipFiller",
    "rememberPlayback", "playerKeys", "pip", "externalPlayer", "remainingTime"]);

  function settingsSheet() {
    const plugin = PLUGIN.replace(/\.plugin\.js$/, "");
    // (no remote on a phone, so no highlight for it)
    const schema = (schemas[plugin] || []).filter((o) => !DESKTOP_ONLY.has(o.key) && !(PHONE && o.key === "focusColour"))
      .map((o) => ({ ...o, label: forDevice(o.label), description: forDevice(o.description) }));
    ensureStyle();
    closeModal();
    const el = document.createElement("div");
    el.className = "dxtv-modal";
    const values = () => readSettings(plugin);
    const shown = (o, v) => {
      if (o.type === "toggle") return v ? "On" : "Off";
      if (o.type === "select") return ((o.options || []).find((x) => x.value === v) || {}).label || v;
      return v ? "Set" : "Not set";
    };
    const render = (focusKey) => {
      const current = values();
      el.innerHTML = `<div class="dxtv-sheet" role="dialog"><h2>StreamFlix settings</h2>
        ${schema.map((o, i) => {
          const v = current[o.key] === undefined ? o.defaultValue : current[o.key];
          // a heading wherever a new group of settings starts
          const heading = o.group && o.group !== (schema[i - 1] || {}).group ? `<h3 class="dxtv-group">${esc(o.group)}</h3>` : "";
          return `${heading}<button class="dxtv-row" data-key="${esc(o.key)}"><span>${esc(o.label)}${o.description ? `<small>${esc(o.description)}</small>` : ""}</span><b>${esc(shown(o, v))}</b></button>`;
        }).join("")}
        <div class="dxtv-buttons"><button class="dxtv-btn" data-close>Done</button></div></div>`;
      const target = (focusKey && el.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)) || el.querySelector(".dxtv-row, .dxtv-btn");
      if (target) target.focus();
    };
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]")) { closeModal(); return; }
      const row = e.target.closest("[data-key]");
      if (!row) return;
      const o = schema.find((x) => x.key === row.dataset.key);
      const current = values();
      const v = current[o.key] === undefined ? o.defaultValue : current[o.key];
      if (o.type === "toggle") {
        await api.saveSetting(plugin, o.key, !v);
      } else if (o.type === "select") {
        const options = o.options || [];
        const next = options[(options.findIndex((x) => x.value === v) + 1) % options.length];
        if (next) await api.saveSetting(plugin, o.key, next.value);
      } else {
        el.style.display = "none";
        openModal = null;
        const r = await dialog({ title: o.label, message: o.description || "", buttons: ["Save", "Cancel"], input: v || "" });
        el.style.display = "";
        openModal = { el, dismiss: () => { el.remove(); openModal = null; } };
        if (r && r.button === 0) await api.saveSetting(plugin, o.key, r.value.trim());
      }
      render(o.key);
    });
    document.body.append(el);
    openModal = { el, dismiss: () => { el.remove(); openModal = null; } };
    render();
  }

  // StreamFlix's phone app draws the same list itself: what's in it, and saving a change
  tv.settings = () => {
    const plugin = PLUGIN.replace(/\.plugin\.js$/, "");
    const values = readSettings(plugin);
    return (schemas[plugin] || []).filter((o) => !DESKTOP_ONLY.has(o.key) && o.key !== "focusColour").map((o) => ({
      key: o.key,
      type: o.type,
      label: forDevice(o.label),
      description: forDevice(o.description || ""),
      group: o.group || "",
      options: (o.options || []).map((x) => ({ value: x.value, label: x.label })),
      value: values[o.key] === undefined ? o.defaultValue : values[o.key],
    }));
  };
  tv.saveSetting = (key, value) => api.saveSetting(PLUGIN.replace(/\.plugin\.js$/, ""), key, value);

  // Stremio's redesigned Settings (November 2026): one page at a time, picked from a menu on the left
  // (Preferences / This browser / Help). StreamFlix's entries are a group of their own at the top of that
  // menu, wearing the classes of Stremio's own items (read from the page as it is, so they keep
  // matching when Stremio rebuilds its styles).
  const SETTINGS_ICONS = {
    sliders: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
    people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    list: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
    home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
    server: "M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
    flag: "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z",
    heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  };
  // The entry of that menu last pressed. What it opened took the remote's selection and dropped it
  // on closing, and the next press started again from the section beside the menu: Back hands the
  // selection to the entry again.
  let menuFrom = null;
  function menuAgain() {
    const from = menuFrom;
    if (!from) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (from.isConnected && (!a || a === document.body)) from.focus({ preventScroll: true });
    }, 80);
  }

  function ensureSettingsMenu(menu) {
    // (.dxtv-group is a heading of the settings sheet's, in capitals: not that)
    if (menu.querySelector(":scope > .dxtv-menu")) return;
    const first = menu.querySelector(':scope > [class*="group-"]');
    const like = first && (first.querySelector(':scope > a[class*="item-"]:not([class*="selected"])') || first.querySelector(':scope > a[class*="item-"]'));
    // (the menu is still being drawn: looked at again when the page next changes)
    if (!first || !like) return;
    const classOf = (n) => (n ? (typeof n.className === "string" ? n.className : n.getAttribute("class") || "") : "");
    const itemClass = [...like.classList].filter((c) => !/^selected/.test(c)).join(" ");
    const labelClass = classOf(like.querySelector('[class*="item-label"]'));
    const iconClass = classOf(like.querySelector("svg"));
    const group = document.createElement("div");
    group.className = `${first.className} dxtv-menu`;
    const heading = document.createElement("div");
    heading.className = classOf(first.querySelector(':scope > [class*="label-"]'));
    heading.textContent = "StreamFlix";
    group.append(heading);
    const loaded = (act) => () => { if (window.__dxbi) act(window.__dxbi); else toast("StreamFlix hasn't finished loading yet. Try again in a moment."); };
    const add = (name, icon, act) => {
      const item = document.createElement("a");
      item.className = `${itemClass} dxtv-item`;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.innerHTML = `<svg class="${iconClass}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SETTINGS_ICONS[icon]}" fill="currentColor"></path></svg><div class="${labelClass}"></div>`;
      item.lastChild.textContent = name;
      const run = () => { menuFrom = item; act(); };
      item.addEventListener("click", (e) => { e.preventDefault(); run(); });
      item.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); run(); } });
      group.append(item);
    };
    add("StreamFlix settings", "sliders", settingsSheet);
    add("Who's watching?", "people", loaded((dx) => dx.whoIsWatching && dx.whoIsWatching.open()));
    add("Simkl", "list", loaded((dx) => dx.simkl && dx.simkl.open()));
    add("Customise Home", "home", loaded((dx) => dx.homeLayout && dx.homeLayout.open()));
    add("Streaming server", "server", () => findServer());
    if (canReport()) add("Report a problem", "flag", reportProblem);
    if (DONATE_URL) add("Support StreamFlix", "heart", donate);
    menu.insertBefore(group, first);
  }

  function ensureSettingsEntry() {
    if (!/^#\/settings/.test(location.hash)) return;
    const menu = document.querySelector('[class*="settings-content"] > nav[class*="menu-"]');
    if (menu) {
      ensureSettingsMenu(menu);
      return;
    }
    // also in Settings' own list (General, Interface… Shortcuts), where people look for it
    const shortcuts = document.querySelector('[class*="settings-container"] [data-section="shortcuts"], [class*="settings-content"] [data-section="shortcuts"]');
    if (shortcuts && !shortcuts.parentElement.querySelector(".dxtv-side")) {
      const side = document.createElement("div");
      side.className = `${shortcuts.className} dxtv-side`;
      side.tabIndex = 0;
      side.title = "StreamFlix";
      side.textContent = "StreamFlix";
      side.addEventListener("click", settingsSheet);
      side.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); settingsSheet(); } });
      shortcuts.after(side);
    }
    const content = document.querySelector('[class*="settings-content"] [class*="sections-container"]');
    if (!content || content.querySelector(".dxtv-settings-entry")) return;
    ensureStyle();
    const entry = document.createElement("button");
    entry.className = "dxtv-row dxtv-settings-entry";
    entry.innerHTML = `<span>StreamFlix settings<small>Look, Home rows, previews, trailers, reviews, sounds and more</small></span><b>Open</b>`;
    entry.addEventListener("click", settingsSheet);
    const problem = document.createElement("button");
    problem.className = "dxtv-row dxtv-settings-entry";
    problem.innerHTML = `<span>Report a problem<small>Sends dx.bi's developer the details that help fix it (no passwords, keys or stream links)</small></span><b>Report</b>`;
    problem.addEventListener("click", reportProblem);
    const server = document.createElement("button");
    server.className = "dxtv-row dxtv-settings-entry";
    server.innerHTML = forDevice(`<span>Streaming server for torrents<small>Torrents play through StreamFlix running on a computer on your network, or on this TV if you switch on Play torrents on this TV (StreamFlix settings). Debrid streams don't need either</small></span><b>Find</b>`);
    server.addEventListener("click", () => findServer());
    const who = document.createElement("button");
    who.className = "dxtv-row dxtv-settings-entry";
    who.innerHTML = `<span>Who's watching?<small>Add viewers and switch between them. Each viewer has their own library and Continue Watching</small></span><b>Open</b>`;
    who.addEventListener("click", () => { if (window.__dxbi && window.__dxbi.whoIsWatching) window.__dxbi.whoIsWatching.open(); });
    const simkl = document.createElement("button");
    simkl.className = "dxtv-row dxtv-settings-entry";
    simkl.innerHTML = forDevice(`<span>Simkl<small>Your Simkl lists (Watching, Plan to Watch…) as rows on Home. Connect with a code you type at simkl.com/pin on your phone or computer; which lists show is under StreamFlix settings → Simkl</small></span><b>Open</b>`);
    simkl.addEventListener("click", () => { if (window.__dxbi && window.__dxbi.simkl) window.__dxbi.simkl.open(); else toast("StreamFlix hasn't finished loading yet. Try again in a moment."); });
    const layout = document.createElement("button");
    layout.className = "dxtv-row dxtv-settings-entry";
    layout.innerHTML = `<span>Customise Home<small>Move, hide or rename Home's rows, whichever addon they come from</small></span><b>Open</b>`;
    layout.addEventListener("click", () => { if (window.__dxbi && window.__dxbi.homeLayout) window.__dxbi.homeLayout.open(); });
    const support = document.createElement("button");
    support.className = "dxtv-row dxtv-settings-entry";
    support.innerHTML = `<span>Support StreamFlix<small>StreamFlix is free. If you enjoy it, you can buy its developer a coffee</small></span><b>Open</b>`;
    support.addEventListener("click", donate);
    content.prepend(...[entry, who, simkl, layout, server, canReport() && problem, DONATE_URL && support].filter(Boolean));
  }

  // ---------------------------------------------------------------------------
  // Playback: every stream plays in the app's native player. Stremio's own player screen stays
  // underneath, silent, so its watch progress (Continue Watching, watched marks) keeps working.
  // ---------------------------------------------------------------------------
  let handoff = null; // { hash, video id } of the stream the native player has

  // Stremio's in-page video never plays on its player screen: every stream on the TV goes to the native
  // player. (It used to be held back only while the native player had the stream. Once, after Back from
  // the native player, the page stayed on Stremio's player screen with nothing handed over any more, and
  // Stremio's own player started the same 4K film in the page, without its subtitles, behind the TV's
  // Home screen, and the TV began closing other apps for memory.)
  const onPlayerScreen = () => /^#\/player\//.test(location.hash);
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (onPlayerScreen()) {
      this.muted = true;
      try { this.pause(); } catch (_) { /* not ready */ }
      return Promise.resolve();
    }
    return realPlay.apply(this, arguments);
  };

  // …and never loads it either. Stremio's player screen underneath still handed the stream to its own
  // <video>, which fetched the same file a second time and, where the TV can decode it, began decoding
  // it: bandwidth and a decoder taken from the player on screen for a picture nobody sees.
  const mediaSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (mediaSrc && mediaSrc.get && mediaSrc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true,
      enumerable: mediaSrc.enumerable,
      get() { return mediaSrc.get.call(this); },
      set(value) {
        if (onPlayerScreen() && (this.tagName === "VIDEO" || (this.closest && this.closest('[class*="player-container"]')))) return;
        mediaSrc.set.call(this, value);
      },
    });
  }

  function silenceWebPlayer() {
    document.querySelectorAll('[class*="player-container"] video').forEach((v) => {
      v.muted = true;
      if (!v.paused) v.pause();
    });
  }

  // Into StreamFlix's own log, which Report a problem sends: what the native player was given and how it
  // ended (on its own the console isn't in a report, so a stream that wouldn't play left no trace)
  function note(text) {
    try {
      const dx = window.__dxbi;
      if (dx && typeof dx.note === "function") dx.note(`[TV] ${text}`);
      else console.info("[StreamFlix TV]", text);
    } catch (_) { /* never in the way */ }
  }

  // What kind of stream, for the log: no address, only what helps tell why one didn't play
  function describeStream(stream, url, torrent, headers) {
    const name = String((stream.behaviorHints && stream.behaviorHints.filename) || (url || "").split("?")[0].split("/").pop() || "");
    const ext = (name.match(/\.(mkv|mp4|m4v|avi|webm|ts|m3u8|mpd|mov)$/i) || [])[1] || "?";
    let host = "?";
    try { host = new URL(url).host; } catch (_) { /* no address yet */ }
    const tags = [
      torrent ? "torrent" : /^(127\.0\.0\.1|localhost)/.test(host) ? "local" : "http",
      `file .${ext.toLowerCase()}`,
      `host ${host}`,
      Object.keys(headers || {}).length ? `headers ${Object.keys(headers).join("/")}` : "",
      stream.behaviorHints && stream.behaviorHints.notWebReady ? "notWebReady" : "",
      /\b(hevc|x265|h\.?265)\b/i.test(`${stream.title || ""} ${stream.name || ""} ${name}`) ? "hevc" : "",
      /\b(dv|dovi|dolby.?vision)\b/i.test(`${stream.title || ""} ${stream.name || ""} ${name}`) ? "dv" : "",
      /\b(dts|truehd|atmos)\b/i.test(`${stream.title || ""} ${stream.name || ""} ${name}`) ? "dts/truehd" : "",
    ];
    return tags.filter(Boolean).join(", ");
  }

  function dispatch(action) {
    const d = core().dispatch;
    if (!d) return;
    try { d(action, "player"); } catch (err) { console.warn("[StreamFlix TV] dispatch failed", err); }
  }

  async function playerState() {
    const get = core().getState;
    if (!get) return null;
    try { return await get("player"); } catch (_) { return null; }
  }

  function subtitleLabel(lang) {
    // (OpenSubtitles' own code, which Intl doesn't know)
    if (/^pob$/i.test(lang || "")) return "Portuguese (Brazil)";
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang; } catch (_) { return lang; }
  }

  // Stremio's own settings (Settings → Player): the languages to start a video in
  async function profileSettings() {
    try {
      const ctx = await core().getState("ctx");
      return (ctx && ctx.profile && ctx.profile.settings) || {};
    } catch (_) {
      return {};
    }
  }

  // One language, however it's written: "por" and "pt" are both Portuguese (and OpenSubtitles'
  // Brazilian Portuguese "pob" counts as Portuguese too)
  function sameLanguage(a, b) {
    if (!a || !b) return false;
    const norm = (x) => { x = String(x).toLowerCase(); return /^(pob|pb|pt-br)$/.test(x) ? "por" : x; };
    a = norm(a); b = norm(b);
    return a === b || subtitleLabel(a).toLowerCase() === subtitleLabel(b).toLowerCase();
  }

  // The subtitle language a video starts in: Stremio's (Settings → Player), unless StreamFlix's
  // "Subtitles when a video starts" is Off
  async function startSubtitleLanguage() {
    const dx = window.__dxbi;
    if (dx && dx.settings && dx.settings.subtitlesStart === "off") return "";
    return (await profileSettings()).subtitlesLanguage || "";
  }

  // Subtitle addons answer a moment after the player opens, one after another, and the TV's player
  // only gets what had arrived by the hand-off (the desktop's list keeps filling in). Wait (up to
  // [ms]) for one in the start language, and for the list to stop growing, so a slower addon's
  // languages (a Bulgarian-only addon, say) make it into the subtitles menu too
  async function subtitlesSoon(state, language, hash, ms) {
    const subs = (s) => (s && s.subtitles || []).filter((x) => x && x.url);
    const has = (s) => !language || subs(s).some((x) => sameLanguage(x.lang, language));
    const until = Date.now() + ms;
    let count = subs(state).length;
    let changed = Date.now();
    while (Date.now() < until && location.hash === hash) {
      // (settled: the start language is there and nothing new came for a while)
      // (none at all after 2 s: no subtitle addons to wait for)
      if (has(state) && count > 0 && Date.now() - changed >= 1500) break;
      if (count === 0 && Date.now() - changed >= 2000) break;
      await new Promise((r) => setTimeout(r, 250));
      const next = await playerState();
      if (next) state = next;
      const n = subs(state).length;
      if (n !== count) { count = n; changed = Date.now(); }
    }
    return state;
  }

  // Thai subtitles (StreamFlix settings → Thai subtitles, on by default): Thai files are first under the
  // player's subtitles button whenever the film or episode has some. They start on by themselves only
  // with "Start with Thai subtitles" (off by default: nothing shows until the viewer picks it).
  // Stremio's subtitle addon has next to none, so the app looks them up on
  // OpenSubtitles itself, by the title's IMDb id: only films and episodes with one (an anime's kitsu or
  // mal id, or a link played on its own, finds nothing there).
  const THAI = /^(th|tha|thai)$/i;
  const thaiOn = () => readSettings(PLUGIN.replace(/\.plugin\.js$/, "")).thaiSubtitles !== false;
  const thaiStart = () => thaiOn() && readSettings(PLUGIN.replace(/\.plugin\.js$/, "")).thaiStart === true;
  // (StreamFlix settings → Only Thai and English subtitles, on by default in this build)
  const thaiEnglishOnly = () => readSettings(PLUGIN.replace(/\.plugin\.js$/, "")).subtitlesThaiEnglish !== false;
  function thaiLookup(videoId, stream) {
    const m = /^(tt\d{5,10})(?::(\d{1,4}):(\d{1,5}))?$/.exec(typeof videoId === "string" ? videoId : "");
    if (!m) return null;
    const hints = (stream && stream.behaviorHints) || {};
    // the file's name says which release it is (resolution, source, group): the app picks the subtitle
    // timed to the same one
    const release = [hints.filename, stream && stream.title, stream && stream.description, stream && stream.name]
      .filter((x) => typeof x === "string" && x.trim()).join("\n").slice(0, 1000);
    return m[2] ? { imdb: m[1], season: Number(m[2]), episode: Number(m[3]), release } : { imdb: m[1], release };
  }
  // A film's or an episode's streams are on screen (#/detail/movie/tt…/tt…, #/detail/series/tt…/tt…:1:2):
  // the app starts looking now, so the files are usually there by the time one is played. No stream is
  // picked yet, so the app goes by the files' downloads; the hand-off asks again with the stream, and
  // finds that lookup. Once per film or episode while the page is open
  const thaiAsked = new Set();
  function thaiEarly() {
    const m = /^#\/detail\/(movie|series)\/([^/?]+)(?:\/([^/?]+))?/.exec(location.hash);
    if (!m || !thaiOn()) return;
    // (a film opened without its video in the address, as the billboard's More info does, shows its
    // streams too; a series page without an episode doesn't)
    const raw = m[3] || (m[1] === "movie" ? m[2] : "");
    if (!raw) return;
    let videoId = "";
    try { videoId = decodeURIComponent(raw); } catch (_) { return; }
    const lookup = thaiLookup(videoId, null);
    if (!lookup || thaiAsked.has(videoId)) return;
    thaiAsked.add(videoId);
    native.thaiSubtitles(JSON.stringify(lookup));
  }

  // Addons can offer hundreds of subtitle files: keep up to three in the start language and English
  // and two in every other language (so every language is there, as on the desktop: a cap on the
  // total used to drop whole languages), the start language and English first. The first in the
  // start language is marked to switch on as the video starts. Thai goes before them all while Thai
  // subtitles are on (the app switches the first Thai one on itself, with "Start with Thai subtitles")
  // With "Only Thai and English subtitles", nothing else is handed over (but Stremio's own subtitle
  // language, when one is set). The TV's player fetches every file it is handed as the video starts:
  // two in each of forty languages was eighty requests at once to the subtitle addon's server, which
  // answered most of them "too many requests", the Thai and English ones as likely as any.
  async function pickSubtitles(list, language) {
    const preferred = language || (await profileSettings()).subtitlesLanguage || "";
    const thai = thaiOn();
    if (thaiEnglishOnly()) list = list.filter((x) => x && (THAI.test(x.lang || "") || /^(eng|en|english)$/i.test(x.lang || "") || sameLanguage(x.lang, preferred)));
    const rank = (lang) => (thai && THAI.test(lang) ? -1 : sameLanguage(lang, preferred) ? 0 : /^(eng|en)$/.test(lang) ? 1 : 2);
    const count = {};
    const out = [];
    let started = false;
    for (const sub of list.filter((x) => x && x.url).sort((a, b) => rank(a.lang || "") - rank(b.lang || ""))) {
      const lang = sub.lang || "";
      // ("th" and "tha" are one language: the app numbers its own Thai files on from these)
      const key = thai && THAI.test(lang) ? "tha" : lang;
      if ((count[key] || 0) >= (rank(lang) < 2 ? 3 : 2)) continue;
      count[key] = (count[key] || 0) + 1;
      // "English", "English 2", "English 3"
      // (where it came from: the stream's own, or a subtitle addon's search by title, which may not fit this release)
      const pick = { url: sub.url, lang, label: (key === "tha" ? "Thai" : subtitleLabel(lang)) + (count[key] > 1 ? ` ${count[key]}` : ""), source: sub.source || "addon" };
      if (language && !started && sameLanguage(lang, language)) pick.start = started = true;
      out.push(pick);
      if (out.length >= 120) break;
    }
    return out;
  }

  // Whether Stremio's streaming server (on this TV, or a computer picked in Settings) is answering
  async function streamingServerUp() {
    // An iPhone: Stremio's page (https) isn't allowed to reach a server at an http:// address, so
    // Stremio always thinks it's offline there. The app asks the server itself
    if (bridge.serverUp) {
      const url = (await profileSettings()).streamingServerUrl;
      try { return !!url && !!(await bridge.serverUp(TOKEN, url)); } catch (_) { return false; }
    }
    try {
      const s = await core().getState("streaming_server");
      return !!(s && s.settings && s.settings.type === "Ready");
    } catch (_) {
      return false;
    }
  }

  // The title's page a player screen belongs to: its list of streams (or of episodes)
  function detailOf(state) {
    const sel = state && state.selected;
    const meta = sel && sel.metaRequest && sel.metaRequest.path;
    if (!meta || !meta.type || !meta.id) return "";
    const video = sel.streamRequest && sel.streamRequest.path && sel.streamRequest.path.id;
    return `#/detail/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}${video ? `/${encodeURIComponent(video)}` : ""}`;
  }

  async function startHandoff() {
    const hash = location.hash;
    if (!/^#\/player\//.test(hash) || (handoff && handoff.hash === hash)) return;
    handoff = { hash, pending: true };
    let state = null;
    // With no streaming server online, torrents play on the TV itself: nothing to wait for
    const serverUp = await streamingServerUp();
    // The player screen fills in over a moment: wait until the stream is known, and give the
    // title's details (name, episode, saved position) a few seconds more to arrive
    let known = 0;
    let thaiAskedHere = false;
    for (let i = 0; i < 60 && location.hash === hash; i++) {
      state = await playerState();
      const stream = state && state.selected && state.selected.stream;
      if (stream && stream.ytId) break;
      // Thai subtitles: asked again as soon as the stream is known, while the rest gets ready (the app
      // finds the lookup the title's streams started, or starts one when the player was opened another way)
      if (stream && !thaiAskedHere) {
        thaiAskedHere = true;
        const lookup = thaiOn() && thaiLookup(state.selected.streamRequest && state.selected.streamRequest.path && state.selected.streamRequest.path.id, stream);
        if (lookup) native.thaiSubtitles(JSON.stringify(lookup));
      }
      const streamKnown = stream && (stream.url || (state.stream && state.stream.type === "Ready") || stream.infoHash || stream.externalUrl);
      if (streamKnown) {
        known++;
        const metaReady = state.metaItem && state.metaItem.type !== "Loading";
        // A torrent's address comes from the streaming server, which can take a while to answer:
        // wait for it (up to ~10 s) before saying there's no server
        const waitingForServer = serverUp && !stream.url && stream.infoHash && !(state.stream && /^(Ready|Err)$/.test(state.stream.type));
        if ((metaReady && state.libraryItem !== undefined && !waitingForServer) || known >= (waitingForServer ? 40 : 12)) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (location.hash !== hash || !state || !state.selected) { handoff = null; return; }
    const stream = state.selected.stream || {};
    // Trailers are YouTube videos, which Stremio plays through a streaming server (none on a TV).
    // StreamFlix's trailer player shows them; only one whose owner forbids embedding goes to the YouTube app
    if (stream.ytId) {
      const youtube = () => native.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`);
      const dx = window.__dxbi;
      const meta = state.metaItem && state.metaItem.type === "Ready" ? state.metaItem.content : {};
      handoff = null;
      if (dx && dx.openTrailer) dx.openTrailer({ id: stream.ytId, start: 0, title: meta.name || "Trailer", logo: meta.logo, onFail: youtube });
      else youtube();
      history.back();
      return;
    }
    silenceWebPlayer();

    const ready = state.stream && state.stream.type === "Ready" && state.stream.content;
    // (for a torrent, Stremio gives a streaming server address even when none is running)
    let url = (ready && ready.url && (serverUp || !stream.infoHash) ? ready.url : null) || stream.url || null;
    // A torrent and no streaming server. StreamFlix TV can download it itself, but only when that's switched
    // on in StreamFlix settings (off by default: debrid, or a computer's streaming server, is the usual way);
    // otherwise the choice is offered for this stream
    let torrent = false;
    // (an iPhone can't download torrents itself: without a streaming server they can't play)
    // (an iPhone's page can't reach the server, so Stremio may not have made its address: made here)
    const server = bridge.serverUp && stream.infoHash ? (await profileSettings()).streamingServerUrl : "";
    if (!url && server && serverUp) {
      const trackers = [...(stream.announce || []), ...(stream.sources || [])].filter((x) => /^tracker:/.test(x)).map((x) => `tr=${encodeURIComponent(x.replace(/^tracker:/, ""))}`);
      url = `${server.replace(/\/?$/, "/")}${encodeURIComponent(stream.infoHash)}/${Number.isInteger(stream.fileIdx) ? stream.fileIdx : -1}${trackers.length ? `?${trackers.join("&")}` : ""}`;
    }
    // An iPhone or iPad with a TV chosen for Play on TV, and no streaming server to hand: the TV's app
    // fetches the torrent and passes it on (TvReceiver.kt), to play here or to download. The TV has to
    // be on, with the app open. (__dxbiIos.tvTorrents: { base, key }, from TvRemote.swift)
    let viaTv = null;
    const tvSource = !url && stream.infoHash && !bridge.torrentUrl && window.__dxbiIos && window.__dxbiIos.tvTorrents;
    if (tvSource && tvSource.base && tvSource.key) {
      const tr = [...(stream.announce || []), ...(stream.sources || [])].filter((x) => /^tracker:/.test(x)).map((x) => `&tr=${encodeURIComponent(x.replace(/^tracker:/, ""))}`).join("");
      const name = (stream.behaviorHints && stream.behaviorHints.filename) || "";
      url = `${tvSource.base}/streamflix/torrent/${encodeURIComponent(String(stream.infoHash).toLowerCase())}/${Number.isInteger(stream.fileIdx) ? stream.fileIdx : -1}?n=${encodeURIComponent(name)}${tr}`;
      viaTv = { "X-StreamFlix": "1", "X-StreamFlix-Key": tvSource.key };
    }
    if (!url && stream.infoHash && !bridge.torrentUrl) {
      handoff = null;
      if (location.hash === hash) history.back();
      toast(server
        ? `Couldn't reach your streaming server (${server.replace(/^https?:\/\/|\/$/g, "")}). Check that StreamFlix is running there, and that this iPhone is on the same network (or the same VPN, like Tailscale).`
        : "This is a torrent, and it needs a streaming server: choose your TV with the TV button (with the app open on the TV), set a streaming server in Settings, or pick a debrid stream.", 9000);
      return;
    }
    if (!url && stream.infoHash) {
      let onTv = playHereOnce === hash || readSettings(PLUGIN.replace(/\.plugin\.js$/, "")).tvTorrents === true;
      playHereOnce = null;
      // The phone app's screens cover the page, so the question below would be asked where nobody
      // can see it (the video just never started): the app asks instead
      if (!onTv && PHONE) {
        const choice = await native.askTorrent();
        if ((choice === 0 || choice === 1) && location.hash === hash) {
          onTv = true;
          if (choice === 1) native.saveSetting(PLUGIN.replace(/\.plugin\.js$/, ""), "tvTorrents", "true");
        } else {
          handoff = null;
          if (location.hash === hash) history.back();
          if (choice === null) toast("This is a torrent, and it needs a streaming server. Pick a debrid stream, set a streaming server in Profile → Playback, or turn on StreamFlix settings → Player → Play torrents on this phone.", 9000);
          return;
        }
      }
      if (!onTv) {
        const choice = await dialog({
          title: "This stream needs a streaming server",
          message: "It's a torrent, and this TV has no streaming server. Use the one in StreamFlix or Stremio on a computer on your network, or let this TV download it itself (it connects to other people sharing the file).\n\nDebrid streams play without either. To always play torrents on this TV: StreamFlix settings → Play torrents on this TV.",
          buttons: ["Find one on my network", "Play it on this TV", "Cancel"],
        });
        if (choice === 1 && location.hash === hash) onTv = true;
        else {
          handoff = null;
          if (location.hash === hash) history.back();
          if (choice === 0) findServer(() => { playHereOnce = hash; location.hash = hash; });
          return;
        }
      }
      // (an addon's "sources" reach the player as "announce")
      const trackers = [...(stream.announce || []), ...(stream.sources || [])].filter((x) => /^tracker:/.test(x)).map((x) => x.replace(/^tracker:/, ""));
      const name = (stream.behaviorHints && stream.behaviorHints.filename) || "";
      url = native.torrentUrl(JSON.stringify({ infoHash: stream.infoHash, fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : -1, trackers, name })) || null;
      torrent = !!url;
      if (!url) {
        handoff = null;
        history.back();
        toast("Couldn't start the torrent. Try another stream.", 5000);
        return;
      }
    }
    if (!url && stream.externalUrl) {
      handoff = null;
      // A link to another of Stremio's own pages ("detail/movie/tt…", stremio:///detail/…): that page,
      // in place of this player screen. It used to go to Android as an outside link and open nothing
      const inside = /^(?:stremio:\/\/\/?|#?\/?)((?:detail|discover|library|search|addons)\/.*)$/.exec(stream.externalUrl);
      if (inside) location.replace(`#/${inside[1]}`);
      else {
        native.openExternal(stream.externalUrl);
        history.back();
      }
      return;
    }
    // (a kind of stream the native player can't take: Stremio's own player is never let play on the TV,
    // so back to the list rather than a player screen that waits for ever)
    if (!url) {
      handoff = null;
      history.back();
      toast("This stream can't play on the TV. Try another one.", 5000);
      return;
    }

    const meta = state.metaItem && state.metaItem.type === "Ready" ? state.metaItem.content : (state.metaItem && state.metaItem.content) || {};
    const videoId = state.selected.streamRequest && state.selected.streamRequest.path && state.selected.streamRequest.path.id;
    const video = (meta.videos || []).find((v) => v.id === videoId);
    const lib = state.libraryItem && state.libraryItem.state;
    const resumeMs = lib && lib.video_id === videoId && lib.timeOffset > 0 ? lib.timeOffset : 0;
    const headers = { ...((stream.behaviorHints && stream.behaviorHints.proxyHeaders && stream.behaviorHints.proxyHeaders.request) || {}), ...(viaTv || {}) };
    const episode = video && video.season != null ? `S${video.season} E${video.episode}${video.title || video.name ? ` · ${video.title || video.name}` : ""}` : "";

    const profile = await profileSettings();
    const subtitleLanguage = await startSubtitleLanguage();
    // Skip intro / recap / credits: the times StreamFlix has for this episode (looked up while the player
    // gets ready, never holding it up for long). Meanwhile the subtitle addons get a moment to answer
    const metaPath = state.selected.metaRequest && state.selected.metaRequest.path;
    const dx = window.__dxbi;
    const [withSubtitles, skips] = await Promise.all([
      subtitlesSoon(state, subtitleLanguage, hash, 4000),
      dx && dx.skipSegments && videoId
        ? Promise.race([dx.skipSegments(meta.type || (metaPath && metaPath.type), meta.id || (metaPath && metaPath.id), videoId).catch(() => []), new Promise((r) => setTimeout(() => r([]), 4000))])
        : [],
    ]);
    if (location.hash !== hash) { handoff = null; return; }
    // the stream's own subtitle files first, then the subtitle addons'
    const subtitles = await pickSubtitles([
      ...(stream.subtitles || []).map((s) => ({ ...s, source: "stream" })),
      ...(withSubtitles.subtitles || []).map((s) => ({ ...s, source: "addon" })),
    ], subtitleLanguage);
    // (where the end credits start, in seconds: stopped past there counts as finished)
    const credits = (skips || []).find((s) => s && s.type === "credits");
    handoff = { hash, videoId, started: Date.now(), detail: detailOf(state), creditsAt: credits && credits.start > 0 ? credits.start : 0 };
    tv.partyVideo = new NativeVideo();
    tv.scrobbleVideo = new ScrobbleVideo(hash);
    partySeen = "";
    note(`playing in StreamFlix's player: ${describeStream(stream, url, torrent, headers)}`);
    native.play(JSON.stringify({
      hash,
      videoId,
      skips,
      torrent,
      autoSkip: (dx && dx.settings && dx.settings.autoSkip) || "off",
      clock: !(dx && dx.settings) || dx.settings.playerClock !== false,
      accent: await accentFor(meta),
      next: nextLink(state) ? { title: nextTitle(state.nextVideo), thumbnail: state.nextVideo.thumbnail || "" } : null,
      upNext: (dx && dx.settings && dx.settings.upNext) || "10",
      audioLanguage: profile.audioLanguage || "",
      // (empty: subtitles start off)
      subtitleLanguage,
      // Stremio's subtitle settings (Settings → Player), drawn the same way by the native player
      subtitleStyle: {
        size: profile.subtitlesSize,
        offset: profile.subtitlesOffset,
        bold: profile.subtitlesBold,
        text: profile.subtitlesTextColor,
        background: profile.subtitlesBackgroundColor,
        outline: profile.subtitlesOutlineColor,
        opacity: profile.subtitlesOpacity,
      },
      url,
      title: meta.name || state.title || stream.title || "StreamFlix",
      subtitle: episode,
      startMs: resumeMs,
      headers,
      subtitles,
      thaiSubtitles: thaiOn(),
      thaiStart: thaiStart(),
      thaiLookup: thaiOn() ? thaiLookup(videoId, stream) : null,
      background: meta.background || meta.poster || "",
      // (the lock screen's picture)
      poster: meta.poster || "",
    }));
  }

  // Watch party: the party works with a video element, so it gets this stand-in for the native player
  class NativeVideo extends EventTarget {
    constructor() {
      super();
      Object.assign(this, { time: 0, length: NaN, stopped: true, rate: 1, buffering: true, seeking: false, checked: 0 });
    }
    get currentTime() { return this.time; }
    set currentTime(s) {
      this.time = s;
      native.control({ cmd: "seek", ms: Math.round(s * 1000) });
    }
    get duration() { return this.length; }
    get paused() { return this.stopped; }
    get readyState() { return this.buffering ? 2 : 4; }
    get playbackRate() { return this.rate; }
    set playbackRate(r) {
      this.rate = r;
      native.control({ cmd: "rate", rate: r });
    }
    play() {
      native.control({ cmd: "play" });
      return Promise.resolve();
    }
    pause() { native.control({ cmd: "pause" }); }
    // The native player's latest: plays, pauses and jumps show as the events a video would fire
    update(ms, durationMs, paused, buffering, rate) {
      const now = Date.now();
      const expected = this.time + (this.stopped ? 0 : ((now - this.checked) / 1000) * this.rate);
      const jumped = this.checked && Math.abs(ms / 1000 - expected) > 1.5;
      const changed = paused !== this.stopped;
      Object.assign(this, { time: ms / 1000, length: durationMs > 0 ? durationMs / 1000 : NaN, stopped: paused, buffering, checked: now });
      this.rate = rate;
      if (jumped) {
        this.dispatchEvent(new Event("seeking"));
        this.dispatchEvent(new Event("seeked"));
      }
      if (changed) this.dispatchEvent(new Event(paused ? "pause" : "play"));
      this.dispatchEvent(new Event("timeupdate"));
    }
  }

  // Marking what you watch on Simkl: the plugin's scrobbler listens to this stand-in as it would to a
  // <video>. The native player's reports (every few seconds: PROGRESS_INTERVAL_MS in PlayerActivity.kt,
  // which tickGap tells the plugin) become timeupdate, playing and pause events, and how the player
  // closed becomes a last timeupdate, with ended when it played through. One per handoff, carrying the
  // player route it belongs to, so the plugin never takes it for the next title's.
  class ScrobbleVideo extends EventTarget {
    constructor(hash) {
      super();
      Object.assign(this, { hash, time: 0, length: NaN, stopped: true, buffering: true, seeking: false, ended: false, closed: false, tickGap: 5000 });
    }
    get currentTime() { return this.time; }
    get duration() { return this.length; }
    get paused() { return this.stopped; }
    get readyState() { return this.buffering ? 2 : 4; }
    update(ms, durationMs, paused, buffering) {
      if (this.closed) return;
      const changed = paused !== this.stopped;
      Object.assign(this, { time: ms / 1000, length: durationMs > 0 ? durationMs / 1000 : NaN, stopped: paused, buffering });
      if (changed) this.dispatchEvent(new Event(paused ? "pause" : "playing"));
      this.dispatchEvent(new Event("timeupdate"));
    }
    // The player closed: where it got to (the end, when it played through). A close is not a pause:
    // the page leaves the player screen next, and the plugin sends where it got to then
    close(ms, durationMs, ended) {
      if (this.closed) return;
      this.closed = true;
      if (durationMs > 0) this.length = durationMs / 1000;
      if (ms > 0) this.time = ms / 1000;
      if (ended && this.length > 0) this.time = this.length;
      this.buffering = false;
      if (ended) this.stopped = true;
      this.dispatchEvent(new Event("timeupdate"));
      this.stopped = true;
      if (ended) {
        this.ended = true;
        this.dispatchEvent(new Event("ended"));
      }
    }
  }

  tv.partyToast = (text) => native.control({ cmd: "toast", text });
  tv.onPartyTick = (ms, durationMs, paused, buffering, rate) => {
    if (tv.partyVideo) tv.partyVideo.update(ms, durationMs, paused, buffering, rate);
  };
  // Who's in the party, for the player's Party button (and a stream changed by the host: the player
  // on screen closes, and the new one opens)
  let partySeen = "";
  setInterval(() => {
    if (!handoff || !handoff.started || !window.__dxbi || !window.__dxbi.partyInfo) return;
    if (handoff.hash !== location.hash) {
      handoff = null;
      native.control({ cmd: "close" });
      return;
    }
    const info = window.__dxbi.partyInfo();
    const now = JSON.stringify(info);
    if (now === partySeen) return;
    partySeen = now;
    native.control({ cmd: "party", on: !!info, code: info ? info.code : "", people: info ? info.people : [] });
  }, 1000);

  // The native player reports where it is every few seconds, and once more when it closes. Paused is
  // the viewer's pause (or the end); buffering is a wait for data, which Stremio counts as not playing
  // but the Simkl scrobbler must not take for a pause
  // The phone apps: Watch stats count the time between reports while it plays (a long gap, asleep
  // or stalled, doesn't)
  // A jump further than playing could explain is a skip, and Stremio is told so ("Seek"). Told as
  // plain progress, a place further back is not taken: Stremio only moves its saved place forwards
  // for that, so after going back ten minutes and leaving, the next play started from the furthest
  // point reached, not from where it was left.
  let playingSince = 0;
  let reported = null;
  tv.onProgress = (timeMs, durationMs, paused, buffering) => {
    if (!handoff || !/^#\/player\//.test(location.hash)) return;
    const now = Date.now();
    const before = reported && reported.hash === location.hash ? reported : null;
    reported = { hash: location.hash, time: timeMs, at: now, still: !!paused || !!buffering };
    const gone = before ? now - before.at : 0;
    const jumped = !!before && Math.abs(timeMs - (before.time + (before.still ? 0 : gone))) > Math.max(3000, gone * 1.5);
    const dx = window.__dxbi;
    if (window.__dxbiEngine && !paused && playingSince && now - playingSince < 15000 && dx && dx.statsPlayed) dx.statsPlayed((now - playingSince) / 1000);
    playingSince = paused ? 0 : now;
    silenceWebPlayer();
    dispatch({ action: "Player", args: { action: jumped ? "Seek" : "TimeChanged", args: { time: Math.max(0, Math.round(timeMs)), duration: Math.max(0, Math.round(durationMs)), device: "dxbi-tv" } } });
    dispatch({ action: "Player", args: { action: "PausedChanged", args: { paused: !!paused || !!buffering } } });
    if (tv.scrobbleVideo) tv.scrobbleVideo.update(timeMs, durationMs, !!paused, !!buffering);
  };

  // The title's own colour for the player's seek bar when StreamFlix has one quickly, else the accent
  async function accentFor(meta) {
    const dx = window.__dxbi;
    const colour = dx && dx.titleColourOf
      ? await Promise.race([dx.titleColourOf(meta.background || meta.poster), new Promise((r) => setTimeout(r, 900))]).catch(() => "")
      : "";
    return colour || getComputedStyle(document.documentElement).getPropertyValue("--dx-accent").trim();
  }

  const nextTitle = (v) => `S${v.season} · E${v.episode}${v.title || v.name ? ` · ${v.title || v.name}` : ""}`;

  // The next episode's list of streams, or its own player screen
  function nextLink(state) {
    const links = state && state.nextVideo && state.nextVideo.deepLinks;
    return links && (links.player || links.metaDetailsStreams);
  }

  // Straight into the next episode with the same release, as on a computer, when one is found quickly
  async function nextLinkFor(state) {
    const dx = window.__dxbi;
    const sel = state && state.selected;
    const mp = sel && sel.metaRequest && sel.metaRequest.path;
    if (dx && dx.findStream && mp && state.nextVideo) {
      const media = { type: mp.type, metaId: mp.id, videoId: state.nextVideo.id, hints: dx.streamHints(sel.stream) };
      const found = await Promise.race([dx.findStream(media, () => true), new Promise((r) => setTimeout(r, 8000))]).catch(() => null);
      if (found && found.link) return found.link.startsWith("#") ? found.link : `#${found.link}`;
    }
    return nextLink(state);
  }

  // Back from the native player goes back a screen in the page, which is the title's page. Should the
  // page still be on that player screen a moment later (the screen before it was the same player
  // screen, so the address didn't change and nothing else noticed), it is taken to the title's page.
  function leavePlayerScreen(detail) {
    setTimeout(async () => {
      if (handoff || !onPlayerScreen()) return;
      const to = detail || detailOf(await playerState()) || "#/";
      if (!handoff && onPlayerScreen()) location.replace(to);
    }, 1500);
  }

  // An episode: its watched tag (on its own: the season's others stay as they are). A film: marked
  // watched unless the 70% rule already did (that would count it watched twice)
  async function markFinished(videoId) {
    const state = await playerState();
    const meta = (state && state.metaItem && state.metaItem.content) || {};
    const video = videoId && (meta.videos || []).find((v) => v.id === videoId);
    const lib = state && state.libraryItem && state.libraryItem.state;
    if (video) dispatch({ action: "Player", args: { action: "MarkVideoAsWatched", args: [video, true] } });
    else if (meta.id && meta.type === "movie" && !(lib && lib.flaggedWatched)) {
      try { core().dispatch({ action: "Ctx", args: { action: "LibraryItemMarkAsWatched", args: { id: meta.id, is_watched: true } } }); } catch (_) { /* not this time */ }
    }
  }

  async function closeHandoff(timeMs, durationMs, ended, error, next) {
    tv.partyVideo = null;
    // (the stream that was playing: on an error the next best of its title plays instead)
    let failedLink = "";
    // Simkl hears where it got to: at once when it played through, otherwise as the page leaves the player
    const scrobble = tv.scrobbleVideo;
    tv.scrobbleVideo = null;
    if (scrobble) scrobble.close(timeMs, durationMs, ended);
    if (handoff && /^#\/player\//.test(location.hash)) {
      if (timeMs > 0) tv.onProgress(timeMs, durationMs, true);
      if (ended) dispatch({ action: "Player", args: { action: "Ended" } });
      const detail = handoff.detail || "";
      // The phone apps: finished (played to the end, or closed past the end credits) is marked
      // watched, as Mark as watched does. Stremio only marks a video it saw 70% of playing, so one
      // with its intro skipped, or closed in the credits, moved Continue Watching on without it
      const finished = ended || (durationMs > 0 && timeMs >= durationMs * 0.9) || (handoff.creditsAt > 0 && timeMs >= handoff.creditsAt * 1000);
      const phone = !!window.__dxbiEngine;
      const videoId = handoff.videoId;
      if (phone && finished) {
        // Stremio moves Continue Watching on to the next episode as the player closes, when it's
        // past 90%: closed in the credits before that, it's told it got there
        if (durationMs > 0 && timeMs < durationMs * 0.9) tv.onProgress(Math.ceil(durationMs * 0.95), durationMs, true);
        await markFinished(videoId);
      }
      if (error) failedLink = handoff.hash;
      handoff = null;
      const link = next && await nextLinkFor(await playerState());
      note(`player closed at ${Math.round(timeMs / 1000)}/${Math.round(durationMs / 1000)} s${ended ? ", ended" : ""}${next ? ", next" : ""}${error ? `, error: ${error}` : ""}`);
      if (link) location.replace(link);
      else {
        history.back();
        leavePlayerScreen(detail);
      }
      // The phone apps: its series page picks the next episode (or the one it closed on), once the
      // page has left the player (a page it goes back to may load the old one first)
      if (phone && window.__dxbiEngine.afterPlaying && !(link && /^#\/player\//.test(link))) {
        setTimeout(() => window.__dxbiEngine.afterPlaying(videoId, finished), 1200);
      }
    } else {
      if (error) note(`player closed (page had moved on), error: ${error}`);
      handoff = null;
    }
    // A stream that didn't play: on to the next best before asking the viewer to choose. Quick
    // Play's own spares first (a stream it picked), else the best of the title's other streams,
    // from where this one stopped: whether the viewer picked it or StreamFlix did
    const dx = window.__dxbi;
    if (error && dx && (dx.quickPlayNext || dx.streamNext)) {
      await new Promise((r) => setTimeout(r, 500));
      let label = dx.quickPlayNext ? dx.quickPlayNext() : "";
      if (!label && failedLink && dx.streamNext) {
        toast("That stream didn't play. Finding another…", 4000);
        try { label = await dx.streamNext(failedLink); } catch (_) { label = ""; }
      }
      if (label) return toast(`That stream didn't play. Playing ${label} instead.`, 5000);
    }
    if (error) toast(`This stream couldn't play: ${error}. Try another one.`, 7000);
  }

  // The native player closed: the app keeps how (see PlaybackBus) until the page takes it
  let resuming = false;
  tv.playerClosed = () => {
    if (resuming) return; // picked up once the restarted page is back on the player screen
    const raw = native.takePendingClose();
    if (!raw) return;
    try {
      const c = JSON.parse(raw);
      closeHandoff(c.timeMs, c.durationMs, c.ended, c.error, c.next);
    } catch (err) {
      console.warn("[StreamFlix TV] couldn't read how the player closed", err);
    }
  };

  // Android restarted the page while a video played (TVs short of memory): go back to that video's
  // player screen, silently, so its watch progress is still recorded, and finish up if it has closed
  async function resumePlayback() {
    let target = null;
    try {
      const active = native.activePlayback();
      const closed = active ? null : native.takePendingClose();
      const info = JSON.parse(active || closed || "null");
      if (info && /^#\/player\//.test(info.hash || "")) target = { info, closed };
    } catch (_) { /* nothing to pick up */ }
    if (!target) return;
    const { info, closed } = target;
    resuming = true;
    handoff = { hash: info.hash, videoId: info.videoId || null, started: Date.now(), resumed: true };
    if (location.hash !== info.hash) location.hash = info.hash;
    // Stremio needs a moment to load the player screen before it takes progress
    for (let i = 0; i < 60 && location.hash === info.hash; i++) {
      const state = await playerState();
      if (state && state.selected) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    silenceWebPlayer();
    resuming = false;
    if (closed) {
      closeHandoff(info.timeMs, info.durationMs, info.ended, info.error, info.next);
    } else {
      tv.playerClosed(); // it may have closed while we waited
    }
  }

  // ---------------------------------------------------------------------------
  // The remote's Back button: closes what's open, otherwise goes back a screen.
  // Returns false on Home, where the app decides (it leaves).
  // ---------------------------------------------------------------------------
  tv.back = () => {
    if (openModal) { closeModal(); menuAgain(); return true; }
    // the small menu on a download button (Play, Delete…): Back shuts it, the remote stays on the button
    const pop = document.querySelector(".dxd-pop");
    if (pop) {
      const btn = pop._btn;
      pop.remove();
      if (btn && btn.isConnected) btn.focus({ preventScroll: true });
      return true;
    }
    const who = window.__dxbi && window.__dxbi.whoIsWatching;
    if (who && who.el) { who.back(); menuAgain(); return true; }
    const sheet = document.querySelector(".dxe-modal");
    if (sheet) {
      // (the Simkl dialog waiting for its code has Cancel instead: Back gives up the sign-in, as it should)
      const close = sheet.querySelector("[data-act=close], [data-act=cancel]");
      if (close) close.click(); else sheet.remove();
      menuAgain();
      return true;
    }
    // Anime Ultra, over Discover: Back closes it, the remote goes back to Discover's first menu
    if (window.__dxbi && typeof window.__dxbi.closeAnimeUltra === "function" && window.__dxbi.closeAnimeUltra()) return true;
    if (window.__dxbi && typeof window.__dxbi.closeTrailer === "function" && window.__dxbi.closeTrailer()) return true;
    if (window.__dxbi && typeof window.__dxbi.closeParty === "function" && window.__dxbi.closeParty()) return true;
    if (window.__dxbi && typeof window.__dxbi.closePreview === "function" && window.__dxbi.closePreview()) return true;
    // Stremio's own dialogs (addon install, promotions…) close with their × button
    const stremioModal = document.querySelector('[class*="modal-container"]');
    if (stremioModal) {
      const close = stremioModal.querySelector('[class*="close-button"]');
      if (close) { close.click(); return true; }
    }
    // One of the stream bar's menus (order, quality, language, source): Back shuts it and the
    // remote carries on from the button that opened it. (Back left the title altogether.)
    const barMenu = document.querySelector(".dx-streambar .dx-sb-btn.is-open");
    if (barMenu) {
      barMenu.click();
      if (barMenu.isConnected) barMenu.focus({ preventScroll: true });
      return true;
    }
    // (an open popup menu: the profile menu's is only marked by its direction class, so it was
    // missed and Back left the remote stuck in it)
    const menu = document.querySelector('[class*="menu-container"][class*="open"], [class*="popup-menu-container"], [class*="menu-container"][class*="menu-direction"]');
    if (menu) {
      const toggle = menu.parentElement;
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      // the remote carries on from the button that opened it
      setTimeout(() => { if (toggle && toggle.isConnected) toggle.focus({ preventScroll: true }); }, 60);
      return true;
    }
    const route = (location.hash || "#/").replace(/^#\/?/, "").split(/[/?]/)[0];
    if (!route || route === "board") return false;
    history.back();
    return true;
  };

  // ---------------------------------------------------------------------------
  // Stremio's web app updates itself: a new build's service worker fetches it and waits, and Stremio
  // shows "A new version of Stremio is available · Reload the user interface" along the bottom, again
  // every time the app comes to the front, until it's pressed. On a TV that read as StreamFlix nagging. The
  // bar stays hidden (STYLE above) and the TV presses it itself, always, at a moment when nobody is in
  // the middle of anything:
  //  - as the page starts (an update found last time), while the intro or the first screen covers it;
  //  - when StreamFlix leaves the screen (Home, another app, the TV going to sleep: the app says so);
  //  - when the remote has been put down for a few minutes.
  // Never while the native player has a stream, since the page is keeping its watch progress, and never
  // on a player screen, in a watch party or with no network.
  // Stremio only looks for a new build when its page comes back into view, and a TV's page can stay in
  // view for days: the TV asks too, each time StreamFlix comes to the front and every few hours.
  // ---------------------------------------------------------------------------
  const webUpdate = {
    // when one was last taken: a build that can't take over isn't pressed again and again
    LAST: "dxtv-web-update",
    HOLD_MS: 30 * 60 * 1000,
    START_MS: 15 * 1000,
    IDLE_MS: 4 * 60 * 1000,
    CHECK_MS: 3 * 60 * 60 * 1000,
    used: Date.now(), // when the remote was last pressed (or the screen touched)
    checked: Date.now(), // when a new build was last looked for
    banner: () => document.querySelector('[class*="web-update-banner"] [role="status"]'),
    apply(why) {
      const banner = this.banner();
      if (!banner || handoff || resuming) return false;
      // Nor on a player screen (the page would come back on it and hand its stream over again: the one
      // that just ended, while Up next looks for the next), with no network (it would come back from
      // its own cache with every row failing to load), or in a watch party (it would leave it)
      if (/^#\/player\//.test(location.hash) || navigator.onLine === false) return false;
      const dx = window.__dxbi;
      if (dx && dx.partyInfo && dx.partyInfo()) return false;
      let playing = false;
      try { playing = !!native.activePlayback(); } catch (_) { /* the app will say */ }
      if (playing) return false;
      let last = 0;
      try { last = Number(localStorage.getItem(this.LAST)) || 0; } catch (_) { /* no storage */ }
      if (Date.now() - last < this.HOLD_MS) return false;
      // the bar's button, not its ×: Stremio moves the page onto the new build and reloads it
      const button = banner.querySelector('[class*="button"]:not([class*="close"])');
      if (!button) return false;
      try { localStorage.setItem(this.LAST, String(Date.now())); } catch (_) { /* no storage */ }
      console.log(`[StreamFlix TV] taking Stremio's update (${why})`);
      button.click();
      return true;
    },
    // Is there a new build? (Stremio's own page hears the answer, and shows its bar)
    check() {
      this.checked = Date.now();
      try {
        navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => { /* offline: next time */ });
      } catch (_) { /* no service worker here */ }
    },
    // Something is open that a reload would take away
    busy() {
      return /^#\/player\//.test(location.hash) || !!openModal || !!document.querySelector(".dxe-modal, .dxe-who, .dxe-theatre, .dxe-trailer");
    },
    watch() {
      // An update found last time: Stremio shows it as soon as the page is up
      const since = Date.now();
      const starting = setInterval(() => {
        if (Date.now() - since > this.START_MS || this.apply("start")) clearInterval(starting);
      }, 500);
      // One found while StreamFlix is on: once the remote has been down for a while
      setInterval(() => {
        const now = Date.now();
        if (now - this.checked > this.CHECK_MS) this.check();
        if (now - this.used > this.IDLE_MS && !this.busy()) this.apply("idle");
      }, 60 * 1000);
    },
  };
  for (const type of ["keydown", "pointerdown"]) window.addEventListener(type, () => { webUpdate.used = Date.now(); }, { capture: true, passive: true });
  // the app: StreamFlix has left the screen (what's open is still there when it comes back)
  tv.hidden = () => !webUpdate.busy() && webUpdate.apply("background");
  // the app: StreamFlix is back on screen
  tv.shown = () => {
    webUpdate.used = Date.now();
    webUpdate.check();
  };

  // ---------------------------------------------------------------------------
  // Load the built-in StreamFlix plugin once the page is up, the way Stremio Enhanced does
  // ---------------------------------------------------------------------------
  function loadPlugin() {
    if (document.getElementById(PLUGIN)) return;
    const source = native.pluginSource();
    if (!source) return;
    const base = PLUGIN.replace(/\.plugin\.js$/, "");
    const script = document.createElement("script");
    script.id = PLUGIN;
    script.textContent = `(function () {
      const StremioEnhancedAPI = {
        logger: {
          info: (m) => window.StremioEnhancedAPI.info(${JSON.stringify(base)}, m),
          warn: (m) => window.StremioEnhancedAPI.warn(${JSON.stringify(base)}, m),
          error: (m) => window.StremioEnhancedAPI.error(${JSON.stringify(base)}, m),
        },
        getSetting: (key) => window.StremioEnhancedAPI.getSetting(${JSON.stringify(base)}, key),
        saveSetting: (key, value) => window.StremioEnhancedAPI.saveSetting(${JSON.stringify(base)}, key, value),
        registerSettings: (schema) => window.StremioEnhancedAPI.registerSettings(${JSON.stringify(base)}, schema),
        onSettingsSaved: (cb) => window.StremioEnhancedAPI.onSettingsSaved(${JSON.stringify(base)}, cb),
        showAlert: window.StremioEnhancedAPI.showAlert,
        showPrompt: (t, m, d) => window.StremioEnhancedAPI.showPrompt(${JSON.stringify(base)}, t, m, d),
      };
      try {
        ${source}
      } catch (err) {
        console.error("[StreamFlix TV] plugin crashed", err);
      }
    })();`;
    document.body.append(script);
  }

  // Text boxes (Search, an episode list's search): the TV's keyboard opened the moment the
  // selection reached one and took over the arrows, so the remote seemed stuck. A box is just a
  // stop on the way until OK is pressed on it; then the keyboard opens.
  // (only for the remote: a tap on a phone or tablet has no OK to press, so it types straight away)
  const typable = (t) => t && t.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|color|file|range|hidden)$/.test(t.type);
  let lastTouch = 0;
  window.addEventListener("pointerdown", () => { lastTouch = Date.now(); }, true);
  window.addEventListener("focusin", (e) => {
    const t = e.target;
    if (!typable(t) || t.readOnly || t.dataset.dxtvTyping || t.closest(".dxtv-modal")) return;
    if (Date.now() - lastTouch < 1000) return;
    t.readOnly = true;
    t.dataset.dxtvLocked = "1";
  }, true);
  window.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.dxtvLocked) {
      t.readOnly = false;
      delete t.dataset.dxtvLocked;
    }
    delete t.dataset.dxtvTyping;
  }, true);
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.key !== "Enter" || !typable(t) || !t.dataset.dxtvLocked) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    t.blur();
    t.dataset.dxtvTyping = "1";
    t.focus();
    t.click(); // what makes Android bring up its keyboard
  }, true);

  // An actor's or director's name on a title opens Search with the name filled in. Stremio then
  // puts the cursor in the search box, and the TV's keyboard covered the results: the results get
  // the remote instead (Up still reaches the box to type)
  let searchWatch = 0;
  function resultsFirst() {
    clearInterval(searchWatch);
    const since = Date.now();
    searchWatch = setInterval(() => {
      if (!/^#\/search\?search=./.test(location.hash) || Date.now() - since > 4000) {
        clearInterval(searchWatch);
        return;
      }
      const field = document.activeElement;
      const first = document.querySelector('#app [class*="search-content"] [class*="meta-item-container"] a[href], #app [class*="search-content"] [class*="meta-item-container"] [tabindex]');
      if (field && field.tagName === "INPUT") field.blur();
      if (first) {
        first.focus({ preventScroll: true });
        clearInterval(searchWatch);
      }
    }, 100);
  }

  function onRoute() {
    ensureSettingsEntry();
    if (/^#\/player\//.test(location.hash)) startHandoff();
    if (/^#\/detail\//.test(location.hash)) thaiEarly();
    if (/^#\/search\?search=./.test(location.hash) && document.activeElement && document.activeElement.tagName !== "INPUT") resultsFirst();
  }

  window.addEventListener("hashchange", onRoute);
  const start = () => {
    ensureStyle();
    loadPlugin();
    resumePlayback();
    onRoute();
    webUpdate.watch();
    new MutationObserver(ensureSettingsEntry).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
