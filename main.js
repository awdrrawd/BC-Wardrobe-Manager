"use strict";
const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");

// Config store (always at userData) holds pointers like the custom data folder + UI lang.
const config = new Store({ name: "config" });
// Wardrobe store — lives at the user-chosen data folder if set, else userData default.
const _dataDir = config.get("dataDir") || null;
const store = new Store({ name: "wardrobe", ...(_dataDir ? { cwd: _dataDir } : {}) });

const APP_VERSION = "1.0";
const REPO_URL = "https://github.com/awdrrawd/BC-Wardrobe-Manager";

// Plugin folder (drop .js clothing plugins here).
function pluginDir() {
  const dir = path.join(app.getPath("userData"), "plugins");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

// Editable language folder, sitting NEXT TO the .exe (portable) so anyone can add or
// edit translations without repacking. Seeded once from the bundled defaults.
function langDir() {
  const dir = app.isPackaged
    ? path.join(path.dirname(process.execPath), "lang")
    : path.join(__dirname, "lang");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}
function seedLangDir() {
  const dir = langDir();
  const src = path.join(app.getAppPath(), "src", "locales");
  try {
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith(".json")) continue;
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(src, f), dest);
    }
  } catch (e) { console.warn("seedLangDir:", e.message); }
}
// List available languages from the folder (reads each file's "_name").
function langList() {
  try {
    return fs.readdirSync(langDir())
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => {
        const code = f.replace(/\.json$/i, "");
        let label = code;
        try { label = JSON.parse(fs.readFileSync(path.join(langDir(), f), "utf8"))._name || code; } catch (e) {}
        return { code, label };
      });
  } catch (e) { return [{ code: "en", label: "English" }]; }
}

// Current UI language (persisted in config, falls back to system locale).
function currentLang() {
  return config.get("uiLang") || (app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en");
}

// Menu strings come from the SAME editable locale files (lang/<code>.json → "menu").
// So adding/translating a language file also translates the native menu.
const MENU_FALLBACK = {
  file: "File", reload: "Reload", exit: "Exit",
  backup: "Backup wardrobe to file…", restore: "Restore wardrobe from file…",
  changeDir: "Change save folder location…",
  view: "View", fullscreen: "Toggle Fullscreen", devtools: "Developer Tools (F12)",
  settings: "Settings", language: "Language", openSettings: "Open settings panel…", langFolder: "Open language folder…",
  restoreOk: "Wardrobe restored, reloading.", backupOk: "Wardrobe backed up.",
  help: "Help", about: "About", github: "Open GitHub",
  aboutTitle: "About BC Wardrobe Manager",
  aboutBody: "BC Wardrobe Manager  ver " + APP_VERSION + "\nby Likolisu",
};
function menuStrings(lang) {
  const read = (code) => {
    try { return JSON.parse(fs.readFileSync(path.join(langDir(), code + ".json"), "utf8")).menu || null; }
    catch (e) { return null; }
  };
  const m = read(lang) || read("en") || {};
  return { ...MENU_FALLBACK, ...m };
}

function setLanguage(win, lang) {
  config.set("uiLang", lang);
  // Sync the renderer's localStorage and reload so the UI re-translates.
  win.webContents.executeJavaScript(
    `localStorage.setItem("uiLang", ${JSON.stringify(lang)}); location.reload();`
  );
  buildMenu(win); // rebuild the (native) menu in the new language
}

// Backup all outfits to a JSON file the user picks (portable save location).
async function backupWardrobe(win, M) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: M.backup, defaultPath: "bc-wardrobe-backup.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePath) return;
  fs.writeFileSync(filePath, JSON.stringify(store.get("wardrobes", []), null, 2), "utf8");
  win.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(M.backupOk)})`).catch(() => {});
}
// Restore outfits from a JSON file (replaces the current wardrobe).
async function restoreWardrobe(win, M) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: M.restore, properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return;
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    if (Array.isArray(data)) { store.set("wardrobes", data); win.webContents.reload(); }
  } catch (e) {
    dialog.showErrorBox("Restore failed", String(e.message || e));
  }
}

// (6) Change where the wardrobe data is stored. Copies the current data to the new
// folder, saves the pointer, and relaunches so the store re-opens at the new location.
async function changeDataDir(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (canceled || !filePaths || !filePaths[0]) return;
  const newDir = filePaths[0];
  try {
    const dest = path.join(newDir, "wardrobe.json");
    if (fs.existsSync(store.path) && path.resolve(store.path) !== path.resolve(dest)) fs.copyFileSync(store.path, dest);
    config.set("dataDir", newDir);
    app.relaunch(); app.exit(0);
  } catch (e) {
    dialog.showErrorBox("Change folder failed", String(e.message || e));
  }
}

function buildMenu(win) {
  const lang = currentLang();
  const M = menuStrings(lang);
  const template = [
    { label: M.file, submenu: [
      { label: M.reload, accelerator: "CmdOrCtrl+R", click: () => win.webContents.reload() },
      { type: "separator" },
      { label: M.backup, click: () => backupWardrobe(win, M) },
      { label: M.restore, click: () => restoreWardrobe(win, M) },
      { label: M.changeDir, click: () => changeDataDir(win) },
      { type: "separator" },
      { label: M.exit, role: "quit" },
    ]},
    { label: M.settings, submenu: [
      { label: M.openSettings, click: () => win.webContents.send("open-settings") },
      { type: "separator" },
      { label: M.language, submenu: langList().map((l) => ({
        label: l.label, type: "radio", checked: l.code === lang,
        click: () => setLanguage(win, l.code),
      })) },
      { label: M.langFolder, click: () => shell.openPath(langDir()) },
    ]},
    { label: M.view, submenu: [
      { label: M.fullscreen, accelerator: "F11", click: () => win.setFullScreen(!win.isFullScreen()) },
      { label: M.devtools, accelerator: "F12", click: () => win.webContents.toggleDevTools() },
    ]},
    { label: M.help, submenu: [
      { label: M.github, click: () => shell.openExternal(REPO_URL) },
      { type: "separator" },
      { label: M.about, click: () => dialog.showMessageBox(win, { type: "info", title: M.aboutTitle, message: "BC Wardrobe Manager", detail: M.aboutBody + "\n\n" + REPO_URL, buttons: ["OK"] }) },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Resolve BC scripts path: packaged app uses extraResources, dev uses local source
function getBCPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bc");
  }
  return path.join(__dirname, "..", "Bondage-College-master", "BondageClub");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "BC Wardrobe Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow loading from BC CDN without CORS issues
    },
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));

  buildMenu(win);

  // (8) F12 toggles DevTools, like a browser. before-input-event is reliable for
  // renderer keystrokes (globalShortcut can be flaky / global-scoped).
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  return win;
}

app.whenReady().then(() => {
  // Register bc:// protocol to serve local BC files
  // URL format: bc://Scripts/lib/LZString.js  → hostname=Scripts, pathname=/lib/LZString.js
  // We combine hostname + pathname to reconstruct the full relative path
  protocol.handle("bc", (request) => {
    const url = new URL(request.url);
    const rel = (url.hostname + url.pathname).replace(/\//g, path.sep);
    const filePath = path.join(getBCPath(), rel);
    const fileUrl = "file:///" + filePath.replace(/\\/g, "/");
    return net.fetch(fileUrl);
  });

  seedLangDir();   // copy default translations into the editable lang/ folder once
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC: wardrobe CRUD
ipcMain.handle("wardrobe:list", () => store.get("wardrobes", []));

ipcMain.handle("wardrobe:save", (_e, { id, name, data, thumbnail, folder }) => {
  const wardrobes = store.get("wardrobes", []);
  const existing = wardrobes.findIndex((w) => w.id === id);
  const entry = { id: id || Date.now().toString(), name, data, thumbnail, folder: folder || "", updatedAt: new Date().toISOString() };
  if (existing >= 0) wardrobes[existing] = entry;
  else wardrobes.push(entry);
  store.set("wardrobes", wardrobes);
  return entry.id;
});

ipcMain.handle("wardrobe:delete", (_e, id) => {
  const wardrobes = store.get("wardrobes", []).filter((w) => w.id !== id);
  store.set("wardrobes", wardrobes);
});

ipcMain.handle("wardrobe:rename", (_e, { id, name }) => {
  const wardrobes = store.get("wardrobes", []);
  const w = wardrobes.find((w) => w.id === id);
  if (w) { w.name = name; store.set("wardrobes", wardrobes); }
});

ipcMain.handle("bc:path", () => getBCPath());

// ── Plugin folder management (3) ──────────────────────────────────────────────
ipcMain.handle("plugins:list", () => {
  try {
    return fs.readdirSync(pluginDir())
      .filter((f) => f.toLowerCase().endsWith(".js"))
      .map((name) => ({ name, path: path.join(pluginDir(), name) }));
  } catch (e) { return []; }
});
ipcMain.handle("plugins:openFolder", () => shell.openPath(pluginDir()));

// ── Language folder (editable translations next to the exe) ───────────────────
ipcMain.handle("lang:list", () => langList());
ipcMain.handle("lang:get", (_e, code) => {
  try { return JSON.parse(fs.readFileSync(path.join(langDir(), path.basename(code) + ".json"), "utf8")); }
  catch (e) { return null; }
});
ipcMain.handle("lang:openFolder", () => shell.openPath(langDir()));
ipcMain.handle("plugins:delete", (_e, name) => {
  try { fs.unlinkSync(path.join(pluginDir(), path.basename(name))); return true; }
  catch (e) { return false; }
});
