/**
 * Minimal stubs so BC's asset-loading scripts can run outside the game.
 * Loaded BEFORE any BC script.
 */

// ── Canvas / display ────────────────────────────────────────────────────────
// Real BC values (from Appearance.js, which we don't load). ECHO's device/asset
// modules reference these constants at module-eval time.
var CanvasUpperOverflow = 700;
var CanvasLowerOverflow = 150;
var CanvasDrawWidth = 500;
var CanvasDrawHeight = 1000; // our render pipeline uses a 1000px-tall canvas
var CanvasBlink = null;
var CanvasCacheData = {};
var CanvasTextAlign = "left";
var MainCanvas = null;
var MainCanvasHeight = 1000;

// ── Drawing/GLDraw deps (so BC's real GLDraw.js can run for colorized rendering) ─
var Character = [];                       // GLDraw's DrawRefreshCharacterForImage iterates this
var DrawLastCharacters = [];              // referenced by GLDrawRebuildCharacters
var DrawCacheImage = new Map();           // Drawing.js image cache
// We preload images ourselves, so redraw-on-image-load is a no-op.
var DrawRefreshCharacterForImage = () => {};
// BC's image loader — ECHO's cachePreload uses it to warm images. Minimal working version.
var DrawGetImage = function (Source) {
  let img = DrawCacheImage.get(Source);
  if (!img) { img = new Image(); DrawCacheImage.set(Source, img); img.src = Source; }
  return img;
};
// Text string cache — AssetManager.init() reads from this Map.
var TextAllScreenCache = new Map();
// GLDrawLoadMask calls these. With empty AlphaMasks the forEach never runs.
var DrawClearRect = (Canvas, x, y, w, h) => { try { Canvas.clearRect(x, y, w, h); } catch (e) {} };
function DrawClearAlphaMasks(Canvas, X, Y, AlphaMasks) {
  if (!Array.isArray(AlphaMasks)) return;
  AlphaMasks.forEach(([x, y, w, h]) => DrawClearRect(Canvas, x - X, y - Y, w, h));
}

// ── Network (no-op) ─────────────────────────────────────────────────────────
var ServerSocket = { on: () => {}, emit: () => {}, connected: false };
var CommonFetch = async (url) => ({ status: 404, text: async () => "", json: async () => ({}) });
var CommonCSVCache = {};
var CommonParseCSV = () => [];
var AssetBuildDescription = () => {};
var AssetLoadDescription = async () => {};

// ── Extended item system ──────────────────────────────────────────────────────
// ExtendedArchetype is normally in Female3DCGExtended.js; define it here so ECHO can use it.
const ExtendedArchetype = /** @type {const} */ ({
  MODULAR: "modular",
  TYPED: "typed",
  VIBRATING: "vibrating",
  VARIABLEHEIGHT: "variableheight",
  TEXT: "text",
  NOARCH: "noarch",
});
// NOTE: AssetBuildExtended itself is the REAL one from Asset.js (loaded). It calls these
// per-archetype register functions (defined in ModularItem.js/TypedItem.js/etc. which we
// don't load). For rendering we only need the asset's layers + AllowTypes (parsed during
// AssetAdd), so returning null here is fine — the asset still registers with its archetype.
var ModularItemRegister = () => null;
var TypedItemRegister = () => null;
var VibratorModeRegister = () => null;
var VariableHeightRegister = () => null;
var TextItemRegister = () => null;
var NoArchItemRegister = () => null;
var ExtendedItemManualRegister = () => {};
var LoginInventoryFixups = [];   // array — ECHO .push()es fixup callbacks onto it
var LoginPerformCraftingFixups = () => {};

// Asset-script hook functions referenced by ECHO items that copy BC lock configs
// (e.g. ECHO's "magic seal" copies HighSecurityPadlock). No-op them so ECHO's
// module evaluation doesn't throw ReferenceError and abort group registration.
var InventoryItemMiscHighSecurityPadlockInitHook = () => {};
var InventoryItemMiscHighSecurityPadlockLoadHook = () => {};
var InventoryItemMiscHighSecurityPadlockDrawHook = () => {};
var InventoryItemMiscHighSecurityPadlockClickHook = () => {};
var InventoryItemMiscHighSecurityPadlockExitHook = () => {};
// Property opacity hooks (referenced by ECHO items with adjustable opacity)
var PropertyOpacityInit = () => {};
var PropertyOpacityLoad = () => {};
var PropertyOpacityDraw = () => {};
var PropertyOpacityExit = () => {};

// Constants referenced in asset definition files (from ExtendedItem.js / ModularItem.js)
const ModularItemChatSetting = { PER_OPTION: "default", PER_MODULE: "perModule" };

// ExtendedXY: extended-item button position grids (referenced at ECHO module-eval time)
const ExtendedXY = [
  [], [[1385,500]], [[1185,500],[1590,500]], [[1080,500],[1385,500],[1695,500]],
  [[1185,400],[1590,400],[1185,700],[1590,700]],
  [[1080,400],[1385,400],[1695,400],[1185,700],[1590,700]],
  [[1080,400],[1385,400],[1695,400],[1080,700],[1385,700],[1695,700]],
  [[1020,400],[1265,400],[1510,400],[1755,400],[1080,700],[1385,700],[1695,700]],
  [[1020,400],[1265,400],[1510,400],[1755,400],[1020,700],[1265,700],[1510,700],[1755,700]],
];
const ExtendedXYClothesWithoutImages = [
  [], [[1385,450]], [[1220,450],[1550,450]], [[1140,450],[1385,450],[1630,450]],
  [[1220,400],[1550,400],[1220,525],[1550,525]],
  [[1140,400],[1385,400],[1630,400],[1220,525],[1550,525]],
  [[1140,400],[1385,400],[1630,400],[1140,525],[1385,525],[1630,525]],
];
// ExtendedXYWithoutImages: position grid used by extended item UI (not needed for rendering)
const ExtendedXYWithoutImages = [
  [], [[1385,450]], [[1260,450],[1510,450]], [[1135,450],[1385,450],[1635,450]],
  [[1260,450],[1510,450],[1260,525],[1510,525]],
  [[1135,450],[1385,450],[1635,450],[1260,525],[1510,525]],
  [[1135,450],[1385,450],[1635,450],[1135,525],[1385,525],[1635,525]],
  [[1010,450],[1260,450],[1510,450],[1760,450],[1135,525],[1385,525],[1635,525]],
  [[1010,450],[1260,450],[1510,450],[1760,450],[1010,525],[1260,525],[1510,525],[1760,525]],
  [[1135,450],[1385,450],[1635,450],[1135,525],[1385,525],[1635,525],[1135,600],[1385,600],[1635,600]],
];
const ExtendedXYClothes = [
  [], [[1385,450]], [[1220,450],[1550,450]], [[1140,450],[1385,450],[1630,450]],
  [[1220,400],[1550,400],[1220,700],[1550,700]],
  [[1140,400],[1385,400],[1630,400],[1220,700],[1550,700]],
  [[1140,400],[1385,400],[1630,400],[1140,700],[1385,700],[1630,700]],
];

// Other stubs that may be referenced in asset definition files
var AssetsClothCheerleaderTopAfterDrawHook = () => {};
var TypedItemChatSetting = { DEFAULT: "default", PER_TYPE: "perType" };

// AssetFemale3DCGExtended: extended item config (TYPED/MODULAR options UI).
// Not needed for rendering — stub as empty object so AssetLoadAll() can run.
var AssetFemale3DCGExtended = {};

// ── Crafting / Shop (stubs) ──────────────────────────────────────────────────
var CraftingAssetsPopulate = () => [];
var CraftingAssets = [];
var Shop2 = { _PopulateBuyGroups: () => {}, _PopulateKeysAndRemotes: () => {} };

// ── Activities / Preferences (stubs) ────────────────────────────────────────
var AssetLoadCheckActivities = () => {};
var PreferenceArousalUpdateValidation = () => {};
var PropertyAutoPunishHandled = null;
var ActivityFetishItemFactor = () => 1;

// ── Animation (stub) ─────────────────────────────────────────────────────────
var AnimationPersistentDataGet = () => ({});
var AnimationPersistentDataRemove = () => {};

// ── Character helpers (stubs needed by CommonDraw) ───────────────────────────
var InventoryGet = (C, group) =>
  (C?.Appearance ?? []).find((i) => i.Asset?.Group?.Name === group) ?? null;

// ── Game state ───────────────────────────────────────────────────────────────
// ECHO's main setup (CraftingCache/ItemPermissionCache) and various modules expect
// a logged-in Player. We provide a minimal mock covering only the fields/methods
// ECHO actually touches, so its init chain runs and registers assets.
var Player = {
  MemberNumber: 0,
  Appearance: [],
  Crafting: [],
  ExtensionSettings: {},
  PermissionItems: {},
  PoseMapping: {},
  ActivePose: [],
  ArousalSettings: { Active: "Inactive", Visible: "All", Progress: 0 },
  AudioSettings: { Volume: 0 },
  CanInteract: () => true,
  CanWalk: () => true,
  CanKneel: () => true,
  CanChangeToPose: () => true,
  IsKneeling: () => false,
  HasEffect: () => false,
  GetSlowLevel: () => 0,
  IsPlayer: () => true,
  IsBlind: () => false,
  RunHooks: () => {},
};
// Preference / server helpers referenced by ECHO's permission & crafting caches
var PreferencePermissionGetDefault = () => ({ Hidden: false, Permission: "Default", TypePermissions: {} });
var ServerPlayerExtensionSettingsSync = () => {};
var CraftingStatusType = { OK: 2, ERROR: 1, CRITICAL_ERROR: 0 };
var CraftingValidate = () => CraftingStatusType.OK;
var CurrentScreen = "Wardrobe";
var CurrentCharacter = null;
var GameVersion = "R129";
// Current language — ECHO's description/translation flush reads this. CN gives Chinese names.
var TranslationLanguage = "CN";

// ── Server / chat (stubs for ECHO) ───────────────────────────────────────────
// ECHO registers chat message handlers for server sync; stub as empty registry.
var ChatRoomMessageHandlers = [];  // array; ECHO calls .push() to register handlers
var ChatRoomRegisterMessageHandler = (handler) => { ChatRoomMessageHandlers.push(handler); };
var ServerSend = () => {};
var ServerSocket_Initialized = false;

// ── Timer (stub) ─────────────────────────────────────────────────────────────
var CommonTime = () => Date.now();

// ── Sound (stub) ─────────────────────────────────────────────────────────────
var AudioPlayInstantSound = () => {};

// ── Expression resolve (needed by CommonDraw) ─────────────────────────────────
var CommonDrawResolveLayerExpression = (C, item, layer) => null;

// ── AssetCommonFunctions stubs ────────────────────────────────────────────────
// Some asset definitions call dynamic functions; stub them globally.
function AssetsClothCheerleaderTopAfterDrawHook() {}

// ── BCModSdk ──────────────────────────────────────────────────────────────────
// We load the REAL bcModSdk (bc://Scripts/lib/bcmodsdk.min.js) in index.html so that
// ECHO's HookManager.invokeOriginal("AssetGroupAdd"/"AssetAdd") actually calls the real
// BC functions and registers its groups/assets. (A no-op stub silently dropped them.)
// The real SDK throws if a hooked function is missing — bc-hooked-stubs.js guarantees
// every function ECHO hooks exists first.
