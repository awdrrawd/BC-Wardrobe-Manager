/**
 * BC Wardrobe Manager – main UI logic
 */

// ── i18n (7) — translations live in editable JSON files under src/locales/ ─────
// Strings use {placeholder} tokens; fmt() fills them. Users can add a new language
// by dropping a <code>.json file in locales/ (and adding it to the menu list).
let LANG = localStorage.getItem("uiLang") || ((navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en");
let T = {};
function fmt(s, vars) {
  return typeof s === "string" ? s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? vars[k] : "") : "";
}
async function loadLocale() {
  // Prefer the editable external lang/ folder (next to the exe) via IPC, so users can
  // add/edit translations without repacking; fall back to the bundled copy.
  if (window.api && window.api.lang) {
    let t = await window.api.lang.get(LANG);
    if (!t) t = await window.api.lang.get("en");
    if (t) { T = t; return; }
  }
  for (const lang of [LANG, "en"]) {
    try {
      const r = await fetch(`locales/${lang}.json`);
      if (r.ok) { T = await r.json(); return; }
    } catch (e) { /* try next */ }
  }
  T = {};
}

/** Apply translations to all [data-i18n] / [data-i18n-ph] / [data-i18n-title] elements. */
function applyI18n() {
  document.documentElement.lang = LANG === "zh" ? "zh-Hant" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const v = T[el.dataset.i18n];
    if (typeof v === "string") el.innerHTML = v;
  }
  for (const el of document.querySelectorAll("[data-i18n-ph]")) {
    const v = T[el.dataset.i18nPh];
    if (typeof v === "string") el.placeholder = v;
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const v = T[el.dataset.i18nTitle];
    if (typeof v === "string") el.title = v;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let wardrobes = [];        // saved outfits list
let selectedId = null;     // currently selected outfit id
let currentBundle = null;  // parsed BCX bundle being previewed
let bcReady = false;       // true once BC assets are loaded
let collapsedFolders = new Set(JSON.parse(localStorage.getItem("collapsedFolders") || "[]"));
// Folders created by the user that may have no outfits yet (persisted client-side).
let extraFolders = new Set(JSON.parse(localStorage.getItem("extraFolders") || "[]"));
function saveExtraFolders() { localStorage.setItem("extraFolders", JSON.stringify([...extraFolders])); }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const listEl       = document.getElementById("outfit-list");
const canvas       = document.getElementById("preview-canvas");
const importBox    = document.getElementById("import-box");
const saveBtn      = document.getElementById("btn-save");
const saveNameIn   = document.getElementById("save-name");
const saveFolderIn = document.getElementById("save-folder");
const importBtn    = document.getElementById("btn-import");
const copyBtn      = document.getElementById("btn-copy");
const deleteBtn    = document.getElementById("btn-delete");
const statusEl     = document.getElementById("status");
const progressBar  = document.getElementById("progress");
const progressWrap = document.getElementById("progress-wrap");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText  = document.getElementById("loading-text");

function showLoading(msg) { loadingText.textContent = msg; loadingOverlay.classList.remove("hidden"); }
function hideLoading() { loadingOverlay.classList.add("hidden"); }

// ── Custom modal prompt (Electron disables window.prompt) ─────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle   = document.getElementById("modal-title");
const modalInput   = document.getElementById("modal-input");
function promptModal(title, defaultValue = "") {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalInput.value = defaultValue;
    modalOverlay.classList.remove("hidden");
    modalInput.focus();
    modalInput.select();
    const done = (val) => {
      modalOverlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      modalInput.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onOk = () => done(modalInput.value);
    const onCancel = () => done(null);
    const onKey = (e) => { if (e.key === "Enter") onOk(); else if (e.key === "Escape") onCancel(); };
    const okBtn = document.getElementById("modal-ok");
    const cancelBtn = document.getElementById("modal-cancel");
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    modalInput.addEventListener("keydown", onKey);
  });
}

// ── Right-click context menu ──────────────────────────────────────────────────
const ctxMenu = document.getElementById("ctx-menu");
function showContextMenu(x, y, items) {
  ctxMenu.innerHTML = "";
  for (const it of items) {
    if (it.sep) { const s = document.createElement("div"); s.className = "ctx-sep"; ctxMenu.appendChild(s); continue; }
    const el = document.createElement("div");
    el.className = "ctx-item" + (it.danger ? " danger" : "");
    el.textContent = it.label;
    el.addEventListener("click", () => { ctxMenu.classList.add("hidden"); it.action(); });
    ctxMenu.appendChild(el);
  }
  ctxMenu.style.left = Math.min(x, window.innerWidth - 160) + "px";
  ctxMenu.style.top = Math.min(y, window.innerHeight - 10 - items.length * 30) + "px";
  ctxMenu.classList.remove("hidden");
}
document.addEventListener("click", () => ctxMenu.classList.add("hidden"));
document.addEventListener("scroll", () => ctxMenu.classList.add("hidden"), true);

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULT_COLORS = { accent: "#e94560", preview: "#12122b", panel: "#16213e", text: "#e0e0e0" };
// Asset-server templates. {ver} is replaced with the (editable) version so the app
// keeps working when BC bumps its version — just change Version (or the server URL).
const SERVER_TEMPLATES = [
  { id: "elementfx", label: "bondageprojects.elementfx.com", tpl: "https://www.bondageprojects.elementfx.com/{ver}/BondageClub/" },
  { id: "europe",    label: "bondage-europe.com",            tpl: "https://www.bondage-europe.com/{ver}/BondageClub/" },
  { id: "asia",      label: "bondage-asia.com",              tpl: "https://www.bondage-asia.com/club/{ver}/" },
];
function detectedVersion() {
  try { const m = new URL(window.BCRender.cdnBase).pathname.match(/R\d+/); if (m) return m[0]; } catch (e) {}
  return "R129";
}
function getSettings() {
  return {
    colors: { ...DEFAULT_COLORS, ...JSON.parse(localStorage.getItem("uiColors") || "{}") },
    serverId: localStorage.getItem("serverId") || "elementfx",
    version: localStorage.getItem("cdnVersion") || detectedVersion(),
    customUrl: localStorage.getItem("customServer") || "",
    pluginUrls: JSON.parse(localStorage.getItem("pluginUrls") || "[]"),       // [{url, enabled}]
    disabledFiles: new Set(JSON.parse(localStorage.getItem("pluginFilesOff") || "[]")),
  };
}
function effectiveServerBase(s) {
  if (s.serverId === "custom") return s.customUrl;
  const t = SERVER_TEMPLATES.find((x) => x.id === s.serverId) || SERVER_TEMPLATES[0];
  return t.tpl.replace("{ver}", s.version || "R129");
}
function applyColors(c) {
  document.documentElement.style.setProperty("--accent", c.accent);
  document.documentElement.style.setProperty("--bg-preview", c.preview);
  document.documentElement.style.setProperty("--bg-panel", c.panel);
  document.documentElement.style.setProperty("--text", c.text);
}
function applyStartupSettings() {
  const s = getSettings();
  applyColors(s.colors);
  const base = effectiveServerBase(s);
  if (base && window.BCRender) window.BCRender.setCdnBase(base);
}

let _pluginFiles = [];   // local .js files from the plugin folder (filled at openSettings)
function renderPluginList(s) {
  const list = document.getElementById("plug-list");
  list.innerHTML = "";
  const entries = [
    ..._pluginFiles.map((f) => ({ kind: "file", name: f.name, key: f.name, enabled: !s.disabledFiles.has(f.name) })),
    ...s.pluginUrls.map((p, i) => ({ kind: "url", name: p.url, key: "url" + i, enabled: p.enabled !== false, idx: i })),
  ];
  if (entries.length === 0) { list.innerHTML = `<div class="plug-empty">${T.plugNone}</div>`; return; }
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "plug-item";
    row.innerHTML = `<input type="checkbox" ${e.enabled ? "checked" : ""}><span class="plug-name" title="${esc(e.name)}">${esc(e.name)}</span><button class="plug-del">✕</button>`;
    row.querySelector("input").addEventListener("change", (ev) => {
      if (e.kind === "file") { ev.target.checked ? s.disabledFiles.delete(e.name) : s.disabledFiles.add(e.name); }
      else { s.pluginUrls[e.idx].enabled = ev.target.checked; }
    });
    row.querySelector(".plug-del").addEventListener("click", async () => {
      if (e.kind === "file") { if (window.api.plugins) await window.api.plugins.delete(e.name); _pluginFiles = _pluginFiles.filter((f) => f.name !== e.name); }
      else { s.pluginUrls.splice(e.idx, 1); }
      renderPluginList(s);
    });
    list.appendChild(row);
  }
}

let _settingsState = null;
async function openSettings() {
  const s = getSettings();
  _settingsState = s;
  // Language (list read from the editable lang/ folder)
  const langSel = document.getElementById("set-language");
  langSel.innerHTML = "";
  let langs = [{ code: "en", label: "English" }, { code: "zh", label: "中文" }];
  if (window.api && window.api.lang) {
    const got = await window.api.lang.list();
    if (Array.isArray(got) && got.length) langs = got;
  }
  for (const l of langs) {
    const o = document.createElement("option"); o.value = l.code; o.textContent = l.label;
    if (l.code === LANG) o.selected = true; langSel.appendChild(o);
  }
  // Server presets (+ custom) and version
  const srvSel = document.getElementById("set-server");
  srvSel.innerHTML = "";
  for (const t of SERVER_TEMPLATES) {
    const o = document.createElement("option"); o.value = t.id; o.textContent = t.label;
    if (t.id === s.serverId) o.selected = true; srvSel.appendChild(o);
  }
  const co = document.createElement("option"); co.value = "custom"; co.textContent = T.serverCustom;
  if (s.serverId === "custom") co.selected = true; srvSel.appendChild(co);
  const versionRow = document.getElementById("set-version").closest(".set-row");
  const customInput = document.getElementById("set-server-custom");
  document.getElementById("set-version").value = s.version;
  customInput.value = s.customUrl;
  const syncSrv = () => {
    const custom = srvSel.value === "custom";
    customInput.style.display = custom ? "block" : "none";
    versionRow.style.display = custom ? "none" : "flex";
  };
  srvSel.onchange = syncSrv; syncSrv();
  // Colors
  document.getElementById("col-accent").value = s.colors.accent;
  document.getElementById("col-preview").value = s.colors.preview;
  document.getElementById("col-panel").value = s.colors.panel;
  document.getElementById("col-text").value = s.colors.text;
  // Plugins: load local files from folder, then render
  _pluginFiles = (window.api.plugins ? await window.api.plugins.list() : []) || [];
  renderPluginList(s);
  document.getElementById("settings-overlay").classList.remove("hidden");
}
// Live color preview as the user picks
for (const [id, key] of [["col-accent", "accent"], ["col-preview", "preview"], ["col-panel", "panel"], ["col-text", "text"]]) {
  document.getElementById(id).addEventListener("input", (e) => {
    const v = { accent: "--accent", preview: "--bg-preview", panel: "--bg-panel", text: "--text" }[key];
    document.documentElement.style.setProperty(v, e.target.value);
  });
}
document.getElementById("col-reset").addEventListener("click", () => {
  document.getElementById("col-accent").value = DEFAULT_COLORS.accent;
  document.getElementById("col-preview").value = DEFAULT_COLORS.preview;
  document.getElementById("col-panel").value = DEFAULT_COLORS.panel;
  document.getElementById("col-text").value = DEFAULT_COLORS.text;
  applyColors(DEFAULT_COLORS);
});
document.getElementById("plug-add").addEventListener("click", async () => {
  const url = await promptModal(T.plugUrlPrompt, "");
  if (url && url.trim()) { _settingsState.pluginUrls.push({ url: url.trim(), enabled: true }); renderPluginList(_settingsState); }
});
document.getElementById("plug-folder").addEventListener("click", () => { if (window.api.plugins) window.api.plugins.openFolder(); });
document.getElementById("settings-cancel").addEventListener("click", () => {
  applyColors(getSettings().colors); // revert live color preview
  document.getElementById("settings-overlay").classList.add("hidden");
});
document.getElementById("settings-save").addEventListener("click", () => {
  const s = _settingsState;
  const lang = document.getElementById("set-language").value;
  const colors = {
    accent: document.getElementById("col-accent").value,
    preview: document.getElementById("col-preview").value,
    panel: document.getElementById("col-panel").value,
    text: document.getElementById("col-text").value,
  };
  const serverId = document.getElementById("set-server").value;
  const version = document.getElementById("set-version").value.trim() || "R129";
  const customUrl = document.getElementById("set-server-custom").value.trim();
  localStorage.setItem("uiColors", JSON.stringify(colors));
  localStorage.setItem("serverId", serverId);
  localStorage.setItem("cdnVersion", version);
  localStorage.setItem("customServer", customUrl);
  localStorage.setItem("pluginUrls", JSON.stringify(s.pluginUrls));
  localStorage.setItem("pluginFilesOff", JSON.stringify([...s.disabledFiles]));
  applyColors(colors);
  const base = effectiveServerBase({ serverId, version, customUrl });
  if (window.BCRender && base) window.BCRender.setCdnBase(base);
  document.getElementById("settings-overlay").classList.add("hidden");
  if (lang !== LANG) { localStorage.setItem("uiLang", lang); location.reload(); return; }
  setStatus(T.settingsSaved);
});
// The native menu's Settings item asks the renderer to open this panel.
if (window.api && window.api.onOpenSettings) window.api.onOpenSettings(openSettings);

// ── Folder picker (tree) for moving outfits ───────────────────────────────────
function pickFolder(currentFolder) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("picker-overlay");
    const list = document.getElementById("picker-list");
    list.innerHTML = "";
    const done = (val) => { overlay.classList.add("hidden"); resolve(val); };
    const addItem = (label, value, cls) => {
      const el = document.createElement("div");
      el.className = "picker-item" + (cls ? " " + cls : "");
      el.textContent = label + (value === (currentFolder || "") ? "  ✓" : "");
      el.addEventListener("click", () => done(value));
      list.appendChild(el);
    };
    addItem("📁 " + T.uncategorized, "");
    const folders = new Set([...extraFolders, ...wardrobes.map((w) => (w.folder || "").trim()).filter(Boolean)]);
    [...folders].sort().forEach((f) => addItem("📁 " + f, f));
    const newEl = document.createElement("div");
    newEl.className = "picker-item new";
    newEl.textContent = T.pickerNew;
    newEl.addEventListener("click", async () => {
      const name = await promptModal(T.newFolderPrompt, "");
      if (name && name.trim()) { extraFolders.add(name.trim()); saveExtraFolders(); done(name.trim()); }
    });
    list.appendChild(newEl);
    document.getElementById("picker-cancel").onclick = () => done(null);
    overlay.classList.remove("hidden");
  });
}

// ── BC asset init ──────────────────────────────────────────────────────────────
async function initBC() {
  // (3)(item) Keep the overlay generic — just "Initializing…", don't reveal ECHO.
  showLoading(T.initializing);
  setStatus(T.initializing);
  try {
    window.AssetLoadDescription = async () => {};
    window.AssetBuildDescription = () => {};
    window.CommonFetch = async () => ({ status: 404, text: async () => "", json: async () => ({}) });

    AssetLoadAll();
    console.log("[BCWard] AssetLoadAll complete. Assets:", Asset.length, "Groups:", AssetGroup.length);

    await loadEchoExtension();
    // Load ECHO's override manifest (V2-redrawn clothing + custom asset URLs).
    await window.BCRender.loadEchoOverrides();

    bcReady = true;
    hideLoading();
    setStatus(T.ready);
  } catch (e) {
    console.error("AssetLoadAll failed:", e);
    hideLoading();
    setStatus("⚠ BC asset load failed: " + e.message);
  }
}

/**
 * Inject ECHO's clothing extension userscript so that ECHO-added groups/assets
 * are registered into BC's runtime asset structures before we render.
 * After injection, rebuild AssetMap to include the new entries.
 */
async function loadEchoExtension() {
  const ECHO_SCRIPT = "https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js";
  const baseGroups = typeof AssetGroup !== "undefined" ? AssetGroup.length : 0;
  const baseAssets = typeof Asset !== "undefined" ? Asset.length : 0;
  // Snapshot base BC group names so echoList() can show exactly what ECHO added.
  window._bcBaseGroupNames = new Set(AssetGroup.map((g) => g.Name));
  try {
    const injectScript = (src) => new Promise((resolve) => {
      const s = document.createElement("script");
      s.type = "module";
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { console.warn("[BCWard] script failed to load:", src); resolve(); };
      document.head.appendChild(s);
    });
    await injectScript(ECHO_SCRIPT);
    // Extra clothing plugins (Settings → plugins): enabled local files + enabled URLs.
    const s = getSettings();
    if (window.api.plugins) {
      const files = (await window.api.plugins.list()) || [];
      for (const f of files) {
        if (!s.disabledFiles.has(f.name)) await injectScript("file:///" + f.path.replace(/\\/g, "/"));
      }
    }
    for (const p of s.pluginUrls) { if (p.enabled !== false && p.url) await injectScript(p.url); }
    // bc-cloth.js uses dynamic import() internally — wait for the async chain to settle.
    // Poll until AssetGroup count stabilizes (ECHO adds groups asynchronously).
    let prevGroups = typeof AssetGroup !== "undefined" ? AssetGroup.length : 0;
    let stable = 0;
    while (stable < 6) {
      await new Promise((r) => setTimeout(r, 500));
      const cur = typeof AssetGroup !== "undefined" ? AssetGroup.length : 0;
      if (cur === prevGroups) stable++;
      else { stable = 0; prevGroups = cur; }
    }
    rebuildAssetMap();
    const newGroups = (typeof AssetGroup !== "undefined" ? AssetGroup.length : 0) - baseGroups;
    const newAssets = (typeof Asset !== "undefined" ? Asset.length : 0) - baseAssets;
    console.log(`[BCWard] ECHO loaded. +${newGroups} groups, +${newAssets} assets (total groups ${AssetGroup.length}, assets ${Asset.length})`);
  } catch (e) {
    console.warn("[BCWard] ECHO load failed:", e.message);
  }
}

/**
 * Rebuild AssetMap from BC's live data structures (includes ECHO-added assets).
 * BC's flat Asset[] array is built by AssetLoadAll(). ECHO may add assets via
 * AssetGroupAdd() which updates AssetGroup[].Asset arrays but may not update
 * the flat Asset[] array, so we scan both.
 */
function rebuildAssetMap() {
  if (typeof AssetMap === "undefined") return;
  AssetMap.clear();
  // From BC's flat Asset array
  if (typeof Asset !== "undefined") {
    for (const asset of Asset) {
      const gn = asset.Group?.Name;
      if (gn != null && asset.Name != null) AssetMap.set(`${gn}/${asset.Name}`, asset);
    }
  }
  // From AssetGroup[].Asset arrays (ECHO adds here via AssetGroupAdd)
  if (typeof AssetGroup !== "undefined") {
    for (const group of AssetGroup) {
      if (!Array.isArray(group.Asset)) continue;
      for (const asset of group.Asset) {
        if (asset.Name == null) continue;
        const key = `${group.Name}/${asset.Name}`;
        if (!AssetMap.has(key)) AssetMap.set(key, asset);
      }
    }
  }
  console.log("[BCWard] AssetMap rebuilt:", AssetMap.size, "entries");
}

/**
 * Console diagnostic: list everything ECHO added on top of base BC.
 * Run `echoList()` in DevTools to verify ECHO registered its groups/assets.
 */
window.echoList = function () {
  const base = window._bcBaseGroupNames ?? new Set();
  const newGroups = AssetGroup.filter((g) => !base.has(g.Name));
  console.log(`%cECHO added ${newGroups.length} new groups:`, "color:#2ecc71;font-weight:bold");
  for (const g of newGroups) {
    const names = (g.Asset ?? []).map((a) => a.Name).filter(Boolean);
    console.log(`  ${g.Name} (${names.length} assets): ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`);
  }
  if (newGroups.length === 0) {
    console.warn("ECHO added 0 groups — it failed to register. Check console for the first ReferenceError from a Chinese-named .js file (e.g. 充气式拘束袋.js) and report it.");
  }
  return newGroups.map((g) => g.Name);
};

// ── Wardrobe list (folder tree) (4)(5) ──────────────────────────────────────────
async function refreshList() {
  wardrobes = await window.api.wardrobe.list();
  // Refresh folder datalist for the save form
  const folders = [...new Set(wardrobes.map((w) => (w.folder || "").trim()).filter(Boolean))].sort();
  const dl = document.getElementById("folder-list");
  if (dl) dl.innerHTML = folders.map((f) => `<option value="${esc(f)}">`).join("");

  listEl.innerHTML = "";
  if (wardrobes.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">${T.noOutfits}</div>`;
    return;
  }
  // Group outfits by folder ("" → Uncategorized); include empty user-created folders.
  const groups = new Map();
  for (const f of extraFolders) groups.set(f, []);
  for (const w of wardrobes) {
    const key = (w.folder || "").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  // Render uncategorized last, named folders first (sorted)
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  for (const key of keys) {
    listEl.appendChild(renderFolder(key, groups.get(key)));
  }
}

function renderFolder(folderName, items) {
  const label = folderName || T.uncategorized;
  const collapsed = collapsedFolders.has(label);
  const folder = document.createElement("div");
  folder.className = "folder" + (collapsed ? " collapsed" : "");

  const head = document.createElement("div");
  head.className = "folder-head";
  head.innerHTML = `<span class="folder-caret">▼</span><span class="folder-label">📁 ${esc(label)}</span><span class="folder-count">(${items.length})</span>`;
  head.addEventListener("click", () => {
    if (collapsedFolders.has(label)) collapsedFolders.delete(label);
    else collapsedFolders.add(label);
    localStorage.setItem("collapsedFolders", JSON.stringify([...collapsedFolders]));
    folder.classList.toggle("collapsed");
  });
  // Drop an outfit here → move it into this folder ("" for Uncategorized)
  head.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; head.classList.add("drop-target"); });
  head.addEventListener("dragleave", () => head.classList.remove("drop-target"));
  head.addEventListener("drop", async (e) => {
    e.preventDefault(); head.classList.remove("drop-target");
    const id = e.dataTransfer.getData("text/outfit-id");
    const w = wardrobes.find((x) => x.id === id);
    if (w && (w.folder || "") !== folderName) {
      await window.api.wardrobe.save({ id: w.id, name: w.name, data: w.data, thumbnail: w.thumbnail, folder: folderName });
      await refreshList();
    }
  });
  // Right-click a named folder → rename / delete
  if (folderName) {
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: T.ctxRenameFolder, action: () => renameFolder(folderName, items) },
        { sep: true },
        { label: T.ctxDeleteFolder, danger: true, action: () => deleteFolder(folderName, items) },
      ]);
    });
  }
  folder.appendChild(head);

  const body = document.createElement("div");
  body.className = "folder-body";
  for (const w of items) body.appendChild(renderOutfitCard(w));
  folder.appendChild(body);
  return folder;
}

async function renameFolder(folderName, items) {
  const nw = await promptModal(T.renameFolderPrompt, folderName);
  if (nw == null) return;
  const newName = nw.trim();
  for (const w of items) {
    await window.api.wardrobe.save({ id: w.id, name: w.name, data: w.data, thumbnail: w.thumbnail, folder: newName });
  }
  if (extraFolders.has(folderName)) { extraFolders.delete(folderName); if (newName) extraFolders.add(newName); saveExtraFolders(); }
  await refreshList();
}

async function deleteFolder(folderName, items) {
  // Removes the folder; its outfits become Uncategorized (outfits are NOT deleted).
  if (!confirm(fmt(T.confirmDeleteFolder, {n: folderName, c: items.length}))) return;
  for (const w of items) {
    await window.api.wardrobe.save({ id: w.id, name: w.name, data: w.data, thumbnail: w.thumbnail, folder: "" });
  }
  extraFolders.delete(folderName); saveExtraFolders();
  await refreshList();
}

function renderOutfitCard(w) {
  const el = document.createElement("div");
  el.className = "outfit-card" + (w.id === selectedId ? " selected" : "");
  el.dataset.id = w.id;
  el.innerHTML = `
    <div class="outfit-thumb">
      ${w.thumbnail ? `<img src="${w.thumbnail}" alt="">` : '<span class="no-thumb">👗</span>'}
    </div>
    <div class="outfit-name" title="${esc(w.name)}">${esc(w.name)}</div>
  `;
  el.addEventListener("click", () => selectOutfit(w.id));
  el.querySelector(".outfit-name").addEventListener("dblclick", (e) => { e.stopPropagation(); startRename(w.id, el); });
  // Drag an outfit onto a folder to move it there
  el.setAttribute("draggable", "true");
  el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/outfit-id", w.id); e.dataTransfer.effectAllowed = "move"; });
  // Right-click an outfit → rename / move / delete
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: T.ctxRename, action: () => startRename(w.id, el) },
      { label: T.ctxMove, action: () => moveOutfit(w) },
      { sep: true },
      { label: T.ctxDelete, danger: true, action: () => deleteOutfit(w) },
    ]);
  });
  return el;
}

async function moveOutfit(w) {
  const folder = await pickFolder(w.folder || "");
  if (folder === null) return;
  await window.api.wardrobe.save({ id: w.id, name: w.name, data: w.data, thumbnail: w.thumbnail, folder: (folder || "").trim() });
  await refreshList();
}

async function deleteOutfit(w) {
  if (!confirm(fmt(T.confirmDelete, {n: w.name}))) return;
  await window.api.wardrobe.delete(w.id);
  if (selectedId === w.id) selectedId = null;
  await refreshList();
}

function selectOutfit(id) {
  selectedId = id;
  const w = wardrobes.find((x) => x.id === id);
  if (!w) return;
  refreshList();
  importBox.value = w.data;
  saveNameIn.value = w.name;
  saveFolderIn.value = w.folder || "";
  currentBundle = parseBCX(w.data);
  if (currentBundle) renderPreview(currentBundle);
}

function startRename(id, el) {
  const nameEl = el.querySelector(".outfit-name");
  const old = nameEl.textContent;
  nameEl.contentEditable = "true";
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const commit = async () => {
    nameEl.contentEditable = "false";
    const newName = nameEl.textContent.trim() || old;
    nameEl.textContent = newName;
    await window.api.wardrobe.rename(id, newName);
    await refreshList();
  };
  nameEl.addEventListener("blur", commit, { once: true });
  nameEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameEl.blur(); } });
}

// ── Import / parse ─────────────────────────────────────────────────────────────
function parseBCX(raw) {
  raw = raw.trim();
  if (!raw) return null;
  try {
    let json = raw;
    if (raw[0] !== "[") {
      json = LZString.decompressFromBase64(raw);
      if (!json) throw new Error("LZString decompress failed");
    }
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
    return parsed;
  } catch (e) {
    setStatus(fmt(T.parseErr, {m: e.message}));
    return null;
  }
}

importBtn.addEventListener("click", () => {
  const raw = importBox.value.trim();
  if (!raw) return setStatus("⚠ " + T.pastePrompt);
  if (!bcReady) return setStatus("⚠ " + T.notReady);
  const bundle = parseBCX(raw);
  if (!bundle) return;
  currentBundle = bundle;
  setStatus(fmt(T.parsedItems, {n: bundle.length}));
  renderPreview(bundle);
});

// ── Copy current string (3) ───────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
  const text = importBox.value.trim();
  if (!text) return setStatus("⚠ " + T.pastePrompt);
  navigator.clipboard.writeText(text).then(
    () => setStatus(T.copied),
    () => setStatus(T.copyFail)
  );
});

// ── Save as a NEW outfit (4) ──────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  const data = importBox.value.trim();
  if (!data) return setStatus(T.importFirst);
  const name = saveNameIn.value.trim() || "Outfit " + new Date().toLocaleString();
  const folder = saveFolderIn.value.trim();
  const thumbnail = captureThumbnail();
  // id omitted → always creates a NEW entry (never overwrites)
  const id = await window.api.wardrobe.save({ name, data, thumbnail, folder });
  selectedId = id;
  setStatus(fmt(T.saved, {n: name}));
  await refreshList();
});

function captureThumbnail() {
  if (!canvas.width) return null;
  try { return window.BCRender.captureThumbnail(canvas); } catch { return null; }
}

// ── Delete ──────────────────────────────────────────────────────────────────────
deleteBtn.addEventListener("click", async () => {
  if (!selectedId) return setStatus(T.selDelete);
  const w = wardrobes.find((x) => x.id === selectedId);
  if (!confirm(fmt(T.confirmDelete, {n: w?.name}))) return;
  await window.api.wardrobe.delete(selectedId);
  selectedId = null;
  currentBundle = null;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  setStatus(T.deleted);
  await refreshList();
});

// ── New folder (5) ────────────────────────────────────────────────────────────
document.getElementById("btn-new-folder").addEventListener("click", async () => {
  const name = await promptModal(T.newFolderPrompt, "");
  if (name && name.trim()) {
    extraFolders.add(name.trim());
    saveExtraFolders();
    saveFolderIn.value = name.trim(); // pre-fill the save form's folder field too
    await refreshList();
  }
});

// ── Zoom (6) ──────────────────────────────────────────────────────────────────
const zoomRange = document.getElementById("zoom-range");
const zoomLabel = document.getElementById("zoom-label");
let _zoomHideTimer = null;
function applyZoom(pct, showLabel = true) {
  pct = Math.max(20, Math.min(200, pct));
  zoomRange.value = pct;
  zoomLabel.textContent = pct + "%";
  document.documentElement.style.setProperty("--zoom", pct / 100);
  // (9) Show the % transiently while changing, then fade out.
  if (showLabel) {
    zoomLabel.classList.add("show");
    clearTimeout(_zoomHideTimer);
    _zoomHideTimer = setTimeout(() => zoomLabel.classList.remove("show"), 900);
  }
}
zoomRange.addEventListener("input", () => applyZoom(parseInt(zoomRange.value, 10)));
document.getElementById("zoom-in").addEventListener("click", () => applyZoom(parseInt(zoomRange.value, 10) + 10));
document.getElementById("zoom-out").addEventListener("click", () => applyZoom(parseInt(zoomRange.value, 10) - 10));
document.getElementById("zoom-fit").addEventListener("click", () => applyZoom(100));

// Drag-to-pan the preview when zoomed in (not just the scrollbar).
const canvasWrap = document.getElementById("canvas-wrap");
let _panning = false, _panX = 0, _panY = 0, _panSL = 0, _panST = 0;
canvasWrap.addEventListener("mousedown", (e) => {
  _panning = true; canvasWrap.classList.add("panning");
  _panX = e.clientX; _panY = e.clientY;
  _panSL = canvasWrap.scrollLeft; _panST = canvasWrap.scrollTop;
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!_panning) return;
  canvasWrap.scrollLeft = _panSL - (e.clientX - _panX);
  canvasWrap.scrollTop = _panST - (e.clientY - _panY);
});
window.addEventListener("mouseup", () => { _panning = false; canvasWrap.classList.remove("panning"); });
// Ctrl/⌘ + wheel zooms; plain wheel scrolls (pans) as usual.
canvasWrap.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    applyZoom(parseInt(zoomRange.value, 10) + (e.deltaY < 0 ? 10 : -10));
  }
}, { passive: false });

// ── Render preview ──────────────────────────────────────────────────────────────
async function renderPreview(bundle) {
  if (!bcReady) return setStatus("⚠ " + T.notReady);
  const progressLabel = document.getElementById("progress-label");
  if (progressLabel) progressLabel.textContent = T.loadingDots;
  progressWrap.style.display = "flex";
  progressBar.style.width = "0%";

  try {
    const replaceBodyWithEcho = document.getElementById("chk-echo-body")?.checked !== false;
    await window.BCRender.renderCharacter(canvas, bundle, (loaded, total) => {
      progressBar.style.width = Math.round((loaded / total) * 100) + "%";
    }, { replaceBodyWithEcho });
    progressWrap.style.display = "none";
    setStatus(fmt(T.rendered, {n: bundle.length}));
  } catch (e) {
    progressWrap.style.display = "none";
    setStatus("⚠ Render error: " + e.message);
    console.error(e);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusEl.textContent = msg;
}
window.setStatus = setStatus; // allow the native menu (backup/restore) to report status

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Init ────────────────────────────────────────────────────────────────────────
(async () => {
  await loadLocale();   // load translations from locales/<lang>.json
  applyStartupSettings(); // UI color + asset server from saved settings
  applyI18n();
  applyZoom(100, false);
  await refreshList();
  await initBC();
})();
