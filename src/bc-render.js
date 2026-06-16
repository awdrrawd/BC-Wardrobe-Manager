/**
 * BC Wardrobe Renderer
 * Canvas2D renderer that uses BC's loaded asset database.
 * Supports AEE LayerOverrides (position, rotation, scale, skew, flip, opacity).
 */

// Verbose debug logging (off by default). Toggle with BCRender.setDebug(true) in the
// console to dump per-layer plans / draw geometry for troubleshooting.
let _DEBUG = false;
function dbg(...args) { if (_DEBUG) console.log(...args); }
function dbgGroup(label, lines) {
  if (!_DEBUG) return;
  console.groupCollapsed(label);
  for (const l of lines) console.log(l);
  console.groupEnd();
}

// CDN base: version set from BC's GameVersion global (populated by Game.js at startup)
let BC_CDN_BASE = "https://www.bondageprojects.elementfx.com/R129/BondageClub/";
// ECHO asset images live in the repo's resources/ folder, served via jsdelivr.
// Path structure matches our rel exactly: resources/Assets/Female3DCG/<group>/<file>
const ECHO_CDN_BASE = "https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@main/resources/";

/** Read GameVersion global (set by BC's Game.js) and update CDN base */
function initCdnVersion() {
  const ver = typeof GameVersion !== "undefined" ? GameVersion : null;
  if (ver) {
    BC_CDN_BASE = `https://www.bondageprojects.elementfx.com/${ver}/BondageClub/`;
    console.log("[BCRender] CDN version:", ver);
  }
}
const CANVAS_W = 500;
const CANVAS_H = 1000;

// Image cache: url → Promise<HTMLImageElement|null>
const _imgCache = new Map();

// ECHO's authoritative asset-override manifest: relative path → versioned jsdelivr URL.
// This is the SAME data ECHO uses internally (fetchAssetOverrides). It covers BOTH
// ECHO's custom assets AND the V2-redrawn versions of vanilla BC clothing — so a
// garment like Cloth/CorsetShirt resolves to ECHO's V2 image instead of BC's original.
let _echoOverrideMap = null;
const ECHO_OVERRIDE_MANIFEST = "https://sugarchain-studio.github.io/echo-clothing-ext/assetOverrides.lz";
const ECHO_JSDELIVR_BASE = "https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext";

async function loadEchoOverrides() {
  if (_echoOverrideMap) return _echoOverrideMap;
  try {
    const r = await fetch(ECHO_OVERRIDE_MANIFEST);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const lz = await r.text();
    const obj = JSON.parse(LZString.decompressFromBase64(lz)); // { commit: [paths] }
    const map = new Map();
    for (const [version, paths] of Object.entries(obj)) {
      for (const p of paths) map.set(p, `${ECHO_JSDELIVR_BASE}@${version}/resources/${p}`);
    }
    _echoOverrideMap = map;
    console.log("[BCRender] ECHO override manifest loaded:", map.size, "paths");
  } catch (e) {
    console.warn("[BCRender] ECHO override manifest failed:", e.message);
    _echoOverrideMap = new Map();
  }
  return _echoOverrideMap;
}

/**
 * Resolve a relative asset path to a full URL.
 *   1. ECHO override manifest (ECHO custom assets + V2-redrawn vanilla clothing)
 *   2. ECHO's live image mapping (custom redirects like ArmMask)
 *   3. BC CDN (vanilla originals)
 */
function resolveUrl(rel) {
  if (_echoOverrideMap && _echoOverrideMap.has(rel)) return _echoOverrideMap.get(rel);
  const ns = window.__BC_LUZI_GLOBALS__;
  if (ns) {
    for (const k of Object.keys(ns)) {
      if (k.startsWith("ImageMapping") && ns[k] && typeof ns[k].mapImgSrc === "function") {
        const mapped = ns[k].mapImgSrc(rel);
        if (typeof mapped === "string" && mapped !== rel && /^https?:/i.test(mapped)) return mapped;
        break;
      }
    }
  }
  return BC_CDN_BASE + rel;
}

/** Load and cache an image. Falls back to ECHO CDN (same rel path) on a BC CDN 404. */
function loadImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (url.startsWith(BC_CDN_BASE)) {
        const echoUrl = ECHO_CDN_BASE + url.slice(BC_CDN_BASE.length);
        const img2 = new Image();
        img2.onload = () => { _imgCache.set(echoUrl, Promise.resolve(img2)); resolve(img2); };
        img2.onerror = () => { console.warn("[BCRender] img 404:", url); resolve(null); };
        img2.src = echoUrl;
      } else {
        console.warn("[BCRender] img 404:", url);
        resolve(null);
      }
    };
    img.src = url;
  });
  _imgCache.set(url, p);
  return p;
}

/**
 * Convert a BCX appearance bundle (array of {Name, Group, Color, Property}) to
 * BC internal Item objects (requires AssetMap to be populated).
 */
function bundleToAppearance(bundle) {
  const items = [];
  for (const entry of bundle) {
    const assetName = entry.Name ?? entry.Asset;
    if (!assetName) continue;
    const key = `${entry.Group}/${assetName}`;
    const asset = typeof AssetMap !== "undefined" ? AssetMap.get(key) : null;
    if (!asset) {
      console.debug("[BCRender] Asset not in DB (likely ECHO custom):", key);
      continue;
    }
    const prop = entry.Property ? { ...entry.Property } : {};
    // BC converts Property.Type (string) → TypeRecord when TypeRecord is missing
    // e.g. "0" → {typed: 0} for typed items.  We do a simplified version here.
    if (typeof prop.Type === "string" && !prop.TypeRecord) {
      const typeNum = parseInt(prop.Type, 10);
      if (!isNaN(typeNum)) {
        // Build TypeRecord from CreateLayerTypes or fallback key "typed"
        const createLayerTypes = asset.CreateLayerTypes ?? asset.Layer?.[0]?.CreateLayerTypes;
        if (Array.isArray(createLayerTypes) && createLayerTypes.length > 0) {
          const rec = {};
          for (const k of createLayerTypes) rec[k] = typeNum;
          prop.TypeRecord = rec;
        } else {
          prop.TypeRecord = { typed: typeNum };
        }
      }
    }
    items.push({
      Asset: asset,
      Color: Array.isArray(entry.Color) ? [...entry.Color] : [entry.Color ?? "Default"],
      Property: prop,
    });
  }

  // Inject default items for groups that have AllowNone:false and an empty-name asset
  // (e.g. ArmsLeft, ArmsRight) — BCX does not export these but they are always drawn.
  if (typeof AssetMap !== "undefined") {
    const presentGroups = new Set(items.map((i) => i.Asset?.Group?.Name));
    for (const [key, asset] of AssetMap) {
      if (asset.Name !== "") continue;
      if (asset.Group?.AllowNone !== false) continue;
      if (presentGroups.has(asset.Group.Name)) continue;
      items.push({ Asset: asset, Color: ["Default"], Property: {} });
      console.debug("[BCRender] Injected default item for AllowNone:false group:", asset.Group.Name);
    }
  }

  return items;
}

/**
 * BC's CharacterAppearanceAllowForTypes algorithm (exact copy).
 * Returns true if the typeRecord satisfies the layer's AllowTypes constraint.
 * @param {{TypeToID: Object, IDToTypeKey: Object}} allowTypes - AssetParseAllowTypes result
 * @param {Object} typeRecord - e.g. { typed: 1 }
 */
function allowForTypes(allowTypes, typeRecord) {
  const idUnion = new Set();
  const typeKeys = new Set();
  for (const [key, index] of Object.entries(typeRecord)) {
    const idSet = allowTypes.TypeToID[`${key}${index}`];
    if (idSet == null) continue;
    typeKeys.add(key);
    for (const id of idSet) idUnion.add(id);
  }
  for (const id of idUnion) {
    if (allowTypes.IDToTypeKey[id].every((k) => typeKeys.has(k))) return true;
  }
  return false;
}

/**
 * Sort all layers across all items by their effective drawing priority.
 * Returns array of {item, layer, priority, layerIdx}.
 */
function sortLayers(appearance) {
  const pairs = [];
  for (const item of appearance) {
    const layers = item.Asset.Layer ?? [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.HasImage) continue;
      if (layer.TextureMask) continue; // mask layers are used for masking, not drawn
      let priority = layer.Priority ?? item.Asset.Group?.DrawingPriority ?? 0;
      const op = item.Property?.OverridePriority;
      if (typeof op === "number") {
        priority = op;
      } else if (op && typeof op === "object" && layer.Name != null && op[layer.Name] != null) {
        priority = op[layer.Name];
      }
      pairs.push({ item, layer, priority, layerIdx: i });
    }
  }
  pairs.sort((a, b) => a.priority - b.priority);
  return pairs;
}

/**
 * Collect texture-mask layers (layer.TextureMask) keyed by the groups they affect.
 * Mirrors BC's CommonDrawAppearancePrepareMaskLayers. These image-based masks cut
 * holes in higher-priority layers of the masked group — e.g. a dress's ArmMask cuts
 * the dress where the hands are, so the hands (lower priority) show through on top.
 * @returns {{ maskMap: Map<string, Array>, maskUrls: Set<string> }}
 */
function collectTextureMasks(appearance, activePoses) {
  const maskMap = new Map();
  const maskUrls = new Set();
  for (const item of appearance) {
    if (item.Asset.Visible === false) continue;
    const layers = item.Asset.Layer ?? [];
    for (const layer of layers) {
      if (!layer.TextureMask || !layer.HasImage) continue;
      // Blending mode must be a destination-* mask op (else skip)
      let mode = "destination-in";
      if (layer.BlendingMode === "destination-in" || layer.BlendingMode === "destination-out") mode = layer.BlendingMode;
      else if (layer.BlendingMode) continue;

      const poseDL = layer.DrawingLeft, poseDT = layer.DrawingTop;
      let X = poseDL?.[""] ?? 0, Y = poseDT?.[""] ?? 0;
      if (poseDL) for (const p of activePoses) { if (poseDL[p] != null) { X = poseDL[p]; break; } }
      if (poseDT) for (const p of activePoses) { if (poseDT[p] != null) { Y = poseDT[p]; break; } }

      // ECHO clothing ArmMask layers reference a SHARED LuziArmMask image (not per-asset).
      // ECHO normally remaps this via image mapping, but the custom mapping doesn't always
      // resolve for us — so build the LuziArmMask URL directly.
      const armMaskNames = ["ArmMask", "ArmMask1", "ArmMaskR", "ArmMaskH", "ArmMaskShort"];
      let url;
      if (armMaskNames.includes(layer.Name)) {
        // Pose subdir (TapedHands) and body-size suffix for BodyUpper-parented masks
        const poseResult = resolveLayerPose(layer, activePoses);
        const poseSeg = (poseResult && poseResult !== "Hide") ? poseResult + "/" : "";
        const parentBU = layer.ParentGroup?.[""] === "BodyUpper" || layer.ParentGroup === "BodyUpper";
        const bodyUpper = appearance.find((i) => i.Asset?.Group?.Name === "BodyUpper");
        const size = parentBU && bodyUpper ? `_${bodyUpper.Asset.Name}` : "";
        url = resolveUrl(`Assets/Female3DCG/LuziArmMask/${poseSeg}${layer.Name}${size}.png`);
      } else {
        url = resolveUrl(buildLayerUrl(item, layer, appearance, activePoses));
      }
      maskUrls.add(url);

      const op = item.Property?.OverridePriority;
      const basePriority = (typeof op === "number") ? op : (op?.[layer.Name ?? ""] ?? layer.Priority);
      const priority = layer.TextureMask.ApplyToAbove ? -1 : basePriority;

      const maskLayer = { Url: url, X, Y, Mode: mode, Priority: priority };
      const groups = layer.TextureMask.Groups ?? [item.Asset.Group?.Name];
      for (const g of groups) {
        if (!maskMap.has(g)) maskMap.set(g, []);
        maskMap.get(g).push(maskLayer);
      }
    }
  }
  return { maskMap, maskUrls };
}

/**
 * Resolve the ColorSuffix filename component for a layer.
 * BC skin/body groups bake the skin color into the PNG filename (e.g. Normal_White.png).
 * Returns "" when no suffix is needed.
 */
function resolveColorSuffixStr(item, layer, appearance) {
  const colorSuffix = layer.ColorSuffix;
  if (!colorSuffix || Object.keys(colorSuffix).length === 0) return "";

  // InheritColor groups (ArmsLeft, BodyLower, etc.) take color from another group's item
  const inheritColor = item.Asset.InheritColor;
  let colorSource = item;
  if (inheritColor) {
    const inherited = appearance.find((i) => i.Asset?.Group?.Name === inheritColor);
    if (inherited) colorSource = inherited;
  }

  const colors = Array.isArray(colorSource.Color) ? colorSource.Color : [colorSource.Color ?? "Default"];
  const rawColor = colors[layer.ColorIndex ?? 0] ?? colors[0] ?? "Default";

  let suffix;
  if (rawColor == null || rawColor === "Default") {
    suffix = colorSuffix.Default ?? "White";
  } else if (typeof rawColor === "string" && rawColor.startsWith("#")) {
    suffix = colorSuffix.HEX_COLOR ?? "White";
  } else {
    // Named color (White, Asian, Black…) — look up in map; use as-is if not found
    suffix = colorSuffix[rawColor] ?? rawColor;
  }
  // BC excludes "Default" from URL: colorSegment = suffix !== "Default" ? suffix : ""
  if (suffix === "Default") return "";
  return suffix || "";
}

/**
 * Compute hidden groups and items from the appearance (BC's Hide system).
 * Each worn item can hide whole groups (Asset.Hide / Property.Hide) or specific
 * group+asset combos (Asset.HideItem / Property.HideItem). Mirrors the core of
 * CharacterAppearanceVisible (without the rarely-needed recursive/permission bits).
 * @returns {{hiddenGroups: Set<string>, hiddenItems: Set<string>}}
 */
function buildHidden(appearance) {
  const hiddenGroups = new Set();
  const hiddenItems = new Set();
  for (const item of appearance) {
    if (item.Asset.Visible === false) continue; // invisible items don't hide
    const hide = item.Asset.Hide;
    if (Array.isArray(hide)) for (const g of hide) hiddenGroups.add(g);
    const propHide = item.Property?.Hide;
    if (Array.isArray(propHide)) for (const g of propHide) hiddenGroups.add(g);
    const hideItem = item.Asset.HideItem;
    if (Array.isArray(hideItem)) for (const gi of hideItem) hiddenItems.add(gi);
    const propHideItem = item.Property?.HideItem;
    if (Array.isArray(propHideItem)) for (const gi of propHideItem) hiddenItems.add(gi);
  }
  return { hiddenGroups, hiddenItems };
}

/**
 * Compute the set of active poses from the current appearance.
 * Returns a Map of poseName → true for every pose forced by any worn item.
 */
function buildActivePoses(appearance) {
  const active = new Set();
  // Item-forced poses first (highest priority in the find loops).
  for (const item of appearance) {
    const setPose = item.Asset?.SetPose;
    if (Array.isArray(setPose)) {
      for (const p of setPose) active.add(p);
    } else if (typeof setPose === "string") {
      active.add(setPose);
    }
  }
  // BC's default ActivePoseMapping: every character has BaseUpper + BaseLower active.
  // Pose-keyed Left/Top often only define these (no "" default), so without them we'd
  // wrongly fall back to the group default (e.g. SuitLower Left=95 → stockings shift right).
  active.add("BaseUpper");
  active.add("BaseLower");
  return active;
}

/**
 * Resolve the effective pose for a layer given the set of active poses.
 * Returns the PoseMapping value (subdirectory name), "Hide", or null (default/no subdirectory).
 */
function resolveLayerPose(layer, activePoses) {
  const pm = layer.PoseMapping;
  if (!pm || !activePoses || activePoses.size === 0) return null;
  for (const pose of activePoses) {
    if (pose in pm) {
      const mapped = pm[pose];
      if (mapped === "Hide") return "Hide";
      if (mapped === "") return null; // PoseType.DEFAULT — use default image
      return mapped; // subdirectory name
    }
  }
  return null;
}

/**
 * Resolve expression URL segment for expression groups (Eyes, Mouth, Blush, etc.)
 * Returns "Happy/" or "" etc. — the subdirectory to insert before the filename.
 */
function resolveExpressionSegment(item) {
  const expr = item.Property?.Expression;
  return expr ? expr + "/" : "";
}

/**
 * Build relative URL for a given item + layer.
 * Handles DynamicGroupName, ParentGroup, layer type, ColorSuffix, Pose, Expression, BodyStyle Override.
 * URL format: Assets/{family}/{group}/{pose}/{expression}/{assetName}_{parentAsset}_{layerType}_{colorSegment}_{layerName}.png
 */
function buildLayerUrl(item, layer, appearance, activePoses) {
  const asset = item.Asset;
  const group = asset.Group;
  const groupName = asset.DynamicGroupName ?? group.Name;
  const family = group.Family ?? "Female3DCG";

  // Resolve active pose for this layer
  const poseResult = resolveLayerPose(layer, activePoses);
  const poseSegment = (poseResult && poseResult !== "Hide") ? poseResult + "/" : "";

  // Layer type from TypeRecord (e.g. breast size variant key)
  const typeRecord = item.Property?.TypeRecord ?? {};
  let layerType = "";
  if (layer.CreateLayerTypes?.length) {
    layerType = layer.CreateLayerTypes.map((k) => `${k}${typeRecord[k] ?? 0}`).join("");
  }

  // ParentGroup lookup — pose-aware: check pose key first, then default ("")
  const activePoseArr = activePoses ? [...activePoses] : [];
  let parentGroupName = null;
  if (layer.ParentGroup) {
    for (const p of activePoseArr) {
      if (layer.ParentGroup[p] != null) { parentGroupName = layer.ParentGroup[p]; break; }
    }
    if (!parentGroupName && layer.ParentGroup[""] != null) parentGroupName = layer.ParentGroup[""];
  }
  let parentAssetName = "";
  if (parentGroupName && typeof parentGroupName === "string") {
    const parentItem = appearance.find((i) => i.Asset?.Group?.Name === parentGroupName);
    if (parentItem) parentAssetName = parentItem.Asset.Name;
  }

  const layerSegment = layer.Name ?? "";
  const colorSuffixStr = resolveColorSuffixStr(item, layer, appearance);
  // Expression subdirectory (Eyes, Mouth, Blush etc.)
  const expressionSegment = resolveExpressionSegment(item);

  // BC URL parts order: assetName_parentAsset_layerType_colorSuffix_layerName
  const parts = [asset.Name, parentAssetName, layerType, colorSuffixStr, layerSegment].filter(Boolean);
  const fileName = parts.join("_") + ".png";

  // BodyStyle override (mirrors BC's AssetBaseURL): EchoV1/EchoV2 redirect body/skin
  // layers to Assets/Female3DCG/Override/<Style>/<group>/...
  // NOTE: after AssetParse, StyleOverride lives on the BodyStyle asset's Layer[0],
  // and the type gate uses the *drawn layer's* CreateLayerTypesOverride.
  const bodyStyleItem = appearance.find((i) => i.Asset?.Group?.Name === "BodyStyle");
  const bodyStyleAsset = bodyStyleItem?.Asset;
  const bodyStyleName = bodyStyleAsset?.Name ?? "Original";
  const styleOverrideList = bodyStyleAsset?.Layer?.[0]?.StyleOverride ?? bodyStyleAsset?.StyleOverride ?? [];
  const layerTypeNum = parseInt((layerType || "").slice(5), 10);
  if (styleOverrideList.includes(groupName) || layer.StyleOverride?.includes(bodyStyleName)) {
    if (!layer.CreateLayerTypesOverride?.length || layer.CreateLayerTypesOverride.includes(layerTypeNum)) {
      return `Assets/${family}/Override/${bodyStyleName}/${groupName}/${poseSegment}${expressionSegment}${fileName}`;
    }
  }

  return `Assets/${family}/${groupName}/${poseSegment}${expressionSegment}${fileName}`;
}

/**
 * Resolve the effective color string for a layer (CSS hex, a named color, or null).
 * Mirrors BC's CommonDrawResolveLayerColor: returns the raw color value.
 * The caller decides whether to colorize (only #hex colors are colorized via the
 * shader; named colors are baked into the PNG filename via resolveColorSuffixStr).
 *
 * NOTE: ColorSuffix layers (BodyUpper/BodyLower/Hands skin) MUST still return their
 * hex so the _White base file gets tinted to the actual skin tone — exactly as BC does.
 * Returning null here is what made the body look pale/"deprecated".
 */
function resolveLayerColor(item, layer, appearance) {
  if (!layer.AllowColorize) return null;

  // InheritColor: some groups take their color from another group's item
  const inheritColor = layer.InheritColor ?? item.Asset.InheritColor;
  let colorSource = item;
  if (inheritColor) {
    const inherited = appearance.find((i) => i.Asset?.Group?.Name === inheritColor);
    if (inherited) colorSource = inherited;
  }

  // CopyLayerColor: this layer uses the color of another named layer on the same asset
  if (layer.CopyLayerColor) {
    const srcLayer = item.Asset.Layer?.find((l) => l.Name === layer.CopyLayerColor);
    if (srcLayer) {
      const srcIdx = srcLayer.ColorIndex ?? 0;
      const srcColors = Array.isArray(colorSource.Color) ? colorSource.Color : [colorSource.Color ?? "Default"];
      const raw = srcColors[srcIdx] ?? srcColors[0] ?? "Default";
      return raw === "Default" || raw == null ? null : raw;
    }
  }

  const propColor = colorSource.Property?.Color;
  const baseColor = colorSource.Color;
  const effectiveColors = Array.isArray(propColor) ? propColor : (Array.isArray(baseColor) ? baseColor : [baseColor]);

  const idx = layer.ColorIndex ?? 0;
  let raw = effectiveColors[idx] ?? effectiveColors[0] ?? "Default";

  // BC resolves "Default" to the asset's DefaultColor (often a skin-tone hex for the body)
  if (raw === "Default" || raw == null) {
    const def = colorSource.Asset?.DefaultColor;
    const defColor = Array.isArray(def) ? (def[idx] ?? def[0]) : def;
    raw = defColor ?? "Default";
  }

  return raw === "Default" || raw == null ? null : raw;
}

/**
 * Resolve a layer's effective opacity, mirroring BC's CommonDrawAppearanceBuild:
 *   1. base = item.Property.Opacity (scalar), else layer.Opacity
 *   2. if Property.Opacity is an array, pick the entry matching this layer
 *   3. clamp to [layer.MinOpacity, layer.MaxOpacity]
 *   4. AEE LayerOverride.Opacity, if present, takes final precedence
 * This is what makes EditOpacity items (e.g. Decals/Eclipse) render semi-transparent.
 */
function resolveLayerOpacity(item, layer, lo) {
  const prop = item.Property;
  let opacity = (prop && typeof prop.Opacity === "number") ? prop.Opacity : (layer.Opacity ?? 1);
  if (prop && Array.isArray(prop.Opacity)) {
    let pos = 0;
    const layers = item.Asset.Layer;
    if (Array.isArray(layers)) {
      for (let p = 0; p < layers.length && p < prop.Opacity.length; p++) {
        if (layer.Name === layers[p].Name) pos = p;
      }
    }
    if (typeof prop.Opacity[pos] === "number") opacity = prop.Opacity[pos];
  }
  const maxO = typeof layer.MaxOpacity === "number" ? layer.MaxOpacity : 1;
  const minO = typeof layer.MinOpacity === "number" ? layer.MinOpacity : 0;
  opacity = Math.min(maxO, Math.max(minO, opacity));
  // AEE per-layer override wins if specified
  if (lo && lo.Opacity != null) opacity = lo.Opacity;
  return opacity;
}

/**
 * Get AEE per-layer transform data (rotation, scale, skew, flip).
 * Position override (DrawingLeft/Top) is handled separately in renderCharacter.
 */
function getAeeTransform(item, layerIdx) {
  const lo = item.Property?.LayerOverrides?.[layerIdx];
  if (!lo) return null;
  if (lo.ScaleX == null && lo.ScaleY == null && lo.Rotation == null &&
      lo.SkewX == null && lo.SkewY == null && !lo.FlipX && !lo.FlipY) return null;
  return {
    scaleX: lo.ScaleX ?? 1,
    scaleY: lo.ScaleY ?? 1,
    rotation: lo.Rotation ?? 0,
    skewX: lo.SkewX ?? 0,
    skewY: lo.SkewY ?? 0,
    flipX: !!lo.FlipX,
    flipY: !!lo.FlipY,
  };
}

/**
 * True when BC's real WebGL renderer is available.
 * We use it for pixel-identical colorization (FullAlpha / HalfAlpha shaders).
 */
function glAvailable() {
  return typeof GLDrawCanvas !== "undefined" && GLDrawCanvas && GLDrawCanvas.GL &&
    typeof GLVersion !== "undefined" && GLVersion !== "No WebGL" &&
    typeof GLDrawImage === "function";
}

/**
 * Draw a single layer using BC's real GLDrawImage onto the shared WebGL canvas.
 * This uses BC's exact color shaders, so colorization matches the game precisely.
 *   - shouldColorize: AllowColorize && color is an explicit #hex → colorized shader
 *     (FullAlpha picks the full-tint vs half-tint/eye-white-preserving program).
 *   - otherwise: drawn plain (named colors are already baked into the PNG filename).
 */
function drawLayerGL(img, drawX, drawY, color, opacity, fullAlpha, flipX, masks, texMasks) {
  if (!img) return;
  const gl = GLDrawCanvas.GL;
  const shouldColorize = !!(color && typeof color === "string" && color[0] === "#");
  const opts = {
    AlphaMasks: masks && masks.length ? masks : [],
    Alpha: Math.max(0, Math.min(1, opacity)),
    Invert: false,
    Mirror: !!flipX,
    BlendingMode: undefined,
    TextureAlphaMask: texMasks && texMasks.length ? texMasks : [],
  };
  if (shouldColorize) {
    opts.HexColor = color;
    opts.FullAlpha = fullAlpha !== false; // default true
  }
  GLDrawImage(img.src, gl, drawX, drawY, opts, 0);
}

/**
 * Render a full character appearance onto the given canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} bundle - Parsed BCX appearance bundle
 * @param {Function} [onProgress] - (loaded, total) progress callback
 */
async function renderCharacter(canvas, bundle, onProgress, options = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  const appearance = bundleToAppearance(bundle);

  // Optional: replace the original BC body with ECHO's V2 base model.
  // EchoV1/EchoV2 redraw the whole base (body, face, hands/feet, vulva, etc.) via
  // StyleOverride. Default ON. Only kicks in when the export uses "Original" (or none).
  if (options.replaceBodyWithEcho !== false && typeof AssetMap !== "undefined") {
    const echoV2 = AssetMap.get("BodyStyle/EchoV2");
    if (echoV2) {
      const bs = appearance.find((i) => i.Asset?.Group?.Name === "BodyStyle");
      if (!bs) {
        appearance.push({ Asset: echoV2, Color: ["Default"], Property: {} });
        dbg("[BCRender] Body style: injected EchoV2");
      } else if (bs.Asset.Name === "Original") {
        bs.Asset = echoV2;
        dbg("[BCRender] Body style: Original → EchoV2");
      }
    }
  }

  // Active BodyStyle asset (for DrawOffset lookups)
  const bodyStyleAsset = appearance.find((i) => i.Asset?.Group?.Name === "BodyStyle")?.Asset ?? null;

  const activePoses = buildActivePoses(appearance);
  dbg("[BCRender] Active poses:", [...activePoses]);

  // Compute hidden groups/items (BC's Hide system): an item's Asset.Hide / Property.Hide
  // lists groups it hides, and Asset.HideItem / Property.HideItem hide specific group+asset.
  // This is what makes ECHO eyes hide vanilla Eyes, ECHO ears hide vanilla ears, etc.
  const { hiddenGroups, hiddenItems } = buildHidden(appearance);
  dbg("[BCRender] Hidden groups:", [...hiddenGroups]);

  // Character attributes (from worn assets) drive HideForAttribute/ShowForAttribute.
  // e.g. a short hairstyle adds "ShortHair", which switches cat ears to their Short
  // variant — without this we'd draw BOTH variants (double ears).
  const charAttributes = new Set();
  for (const item of appearance) {
    const attrs = item.Asset.Attribute;
    if (Array.isArray(attrs)) for (const a of attrs) charAttributes.add(a);
    const pAttrs = item.Property?.Attribute;
    if (Array.isArray(pAttrs)) for (const a of pAttrs) charAttributes.add(a);
  }

  // Filter out HIDE layers before sorting
  const allLayerPairs = sortLayers(appearance);
  const layerPairs = allLayerPairs.filter(({ item, layer }) => {
    const gName = item.Asset.Group?.Name;
    // Asset.Visible === false → never drawn (e.g. BodyStyle)
    if (item.Asset.Visible === false) return false;
    // Hidden by another item's Hide / HideItem
    if (hiddenGroups.has(gName)) return false;
    if (hiddenItems.has(`${gName}${item.Asset.Name}`)) return false;
    // Attribute visibility: hide if the char has any HideForAttribute, or lacks all ShowForAttribute
    if (layer.HideForAttribute && layer.HideForAttribute.some((a) => charAttributes.has(a))) return false;
    if (layer.ShowForAttribute && layer.ShowForAttribute.every((a) => !charAttributes.has(a))) return false;
    // Pose visibility
    const poseResult = resolveLayerPose(layer, activePoses);
    if (poseResult === "Hide") return false;
    // LockLayer: only visible when item is locked
    if (layer.LockLayer && !item.Property?.LockedBy) return false;
    // AllowTypes: use BC's exact CharacterAppearanceAllowForTypes algorithm.
    // Returns true if the typeRecord matches at least one allowed combination.
    if (layer.AllowTypes) {
      const typeRecord = item.Property?.TypeRecord ?? null;
      if (!typeRecord || !allowForTypes(layer.AllowTypes, typeRecord)) return false;
    }
    return true;
  });
  const total = layerPairs.length;

  if (total === 0) {
    console.warn("[BCRender] No renderable layers found.");
    return;
  }

  // GroupAlpha mask system: a layer's Alpha entries can target OTHER groups with
  // rectangular masks that cut transparent holes — this is how BC makes hands/arms
  // show over clothing (the sleeve is cut where the hand is). Collect masks keyed by
  // the group they affect (mirrors CharacterAppearanceSortLayers' groupAlphas).
  const groupAlphas = {};
  for (const { layer } of layerPairs) {
    const alphas = layer.Alpha;
    if (!Array.isArray(alphas)) continue;
    for (const alpha of alphas) {
      if (!alpha.Group || !Array.isArray(alpha.Group)) continue;
      if (alpha.AllowTypes) continue; // type-gated masks: skip (matches our simplified path)
      for (const gName of alpha.Group) {
        (groupAlphas[gName] = groupAlphas[gName] || []).push({ Pose: alpha.Pose, Masks: alpha.Masks });
      }
    }
  }

  // Resolve all image URLs and kick off parallel fetches
  const urlsAndPromises = layerPairs.map(({ item, layer, priority }) => {
    const rel = buildLayerUrl(item, layer, appearance, activePoses);
    const url = resolveUrl(rel);
    return { rel, url, promise: loadImage(url), group: item.Asset.Group.Name, asset: item.Asset.Name, layerName: layer.Name, priority };
  });

  // Debug: full appearance + layer table (only when BCRender.setDebug(true))
  dbg("[BCRender] Appearance items:", appearance.map(i=>i.Asset?.Group?.Name+"/"+i.Asset?.Name).join(", "));
  dbgGroup("[BCRender] Layer plan (" + total + " layers)",
    urlsAndPromises.map(u => `pri=${u.priority} ${u.group}/${u.asset} [${u.layerName??''}] → ${u.url}`));

  // Preload ALL images first (so the one-shot GL render has every texture ready).
  const images = [];
  let loaded = 0;
  for (let i = 0; i < layerPairs.length; i++) {
    let img = null;
    try {
      img = await urlsAndPromises[i].promise;
    } catch (e) {
      console.warn("[BCRender] Image load error:", urlsAndPromises[i].url, e);
    }
    images[i] = img;
    loaded++;
    if (onProgress) onProgress(loaded, total);
  }

  // Texture masks (image-based) for hands-over-clothes etc. Load their images and
  // prime the GL cache keyed by URL, so GLDrawLoadTextureAlphaMask can bind them.
  const { maskMap, maskUrls } = collectTextureMasks(appearance, activePoses);
  const maskImgByUrl = new Map();
  await Promise.all([...maskUrls].map(async (u) => {
    const img = await loadImage(u);
    if (img) maskImgByUrl.set(u, img);
  }));

  const _drawDiag = [];
  const useGL = glAvailable();
  if (useGL) {
    // Prime BC's GLDrawImageCache with our already-loaded images (draw + mask).
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (img && img.complete && img.naturalWidth > 0) GLDrawImageCache.set(img.src, img);
    }
    for (const [u, img] of maskImgByUrl) {
      if (img.complete && img.naturalWidth > 0) GLDrawImageCache.set(u, img);
    }
    // Clear the shared GL canvas, then draw every layer in priority order.
    GLDrawClearRect(GLDrawCanvas.GL, 0, 0, 1000, CANVAS_H, 0);
  }

  for (let i = 0; i < layerPairs.length; i++) {
    const { item, layer, layerIdx, priority } = layerPairs[i];
    const img = images[i];
    if (!img) continue;

    // Layer draw position: pose-aware DrawingLeft/Top, then AEE override
    const lo = item.Property?.LayerOverrides?.[layerIdx];
    const poseDL = layer.DrawingLeft;
    const poseDT = layer.DrawingTop;
    let baseX = poseDL?.[""] ?? 0;
    let baseY = poseDT?.[""] ?? 0;
    if (poseDL && activePoses) {
      for (const p of activePoses) { if (poseDL[p] != null) { baseX = poseDL[p]; break; } }
    }
    if (poseDT && activePoses) {
      for (const p of activePoses) { if (poseDT[p] != null) { baseY = poseDT[p]; break; } }
    }
    let drawX = lo?.DrawingLeft?.[""] ?? baseX;
    let drawY = lo?.DrawingTop?.[""] ?? baseY;

    // BodyStyle DrawOffset: EchoV2 nudges certain groups (Pussy, vulva items, …)
    // so they line up with the redrawn base model. Mirrors BC's CommonDraw logic.
    if (bodyStyleAsset?.DrawOffset) {
      const gName = item.Asset.DynamicGroupName ?? item.Asset.Group?.Name;
      const off = bodyStyleAsset.DrawOffset.find((o) =>
        o.Group === gName &&
        (o.Asset === undefined || o.Asset === item.Asset.Name) &&
        (o.Layer === undefined || o.Layer.includes(layer.Name ?? "")));
      if (off) { drawX += off.X ?? 0; drawY += off.Y ?? 0; }
    }

    const opacity = resolveLayerOpacity(item, layer, lo);
    const color = resolveLayerColor(item, layer, appearance);
    const td = getAeeTransform(item, layerIdx);

    // Alpha masks affecting this layer's group (cut holes so e.g. hands show over sleeves)
    const maskGroup = layer.HideAs?.Group || item.Asset.Group?.Name;
    let masks = null;
    const ga = groupAlphas[maskGroup];
    if (ga && ga.length) {
      masks = [];
      for (const entry of ga) {
        if (entry.Pose && entry.Pose.length && !entry.Pose.some((p) => activePoses.has(p))) continue;
        if (Array.isArray(entry.Masks)) masks.push(...entry.Masks);
      }
      if (masks.length === 0) masks = null;
    }

    // Texture masks affecting this layer's group, at/above this layer's priority.
    const tmGroup = layer.HideAs?.Group || item.Asset.Group?.Name;
    let texMasks = null;
    const tm = maskMap.get(tmGroup);
    if (tm && tm.length) {
      texMasks = tm.filter((m) => m.Priority < 0 || m.Priority >= priority);
      if (texMasks.length === 0) texMasks = null;
    }

    // Diagnostic: draw geometry per layer (collapsed group below)
    _drawDiag.push(`${item.Asset.Group?.Name}/${item.Asset.Name} [${layer.Name??''}] pos=(${drawX},${drawY}) img=${img.naturalWidth}x${img.naturalHeight}${masks?` masks=${masks.length}`:""}${texMasks?` tex=${texMasks.length}`:""}`);

    if (useGL) {
      drawLayerGL(img, drawX, drawY, color, opacity, layer.FullAlpha, td?.flipX, masks, texMasks);
    } else {
      drawLayerCanvas2D(ctx, img, drawX, drawY, color, opacity, td, layer.FullAlpha);
    }
  }
  dbgGroup("[BCRender] Draw geometry (all)", _drawDiag);

  // Blit the GL result (character lives in the left 500px) onto the preview canvas.
  if (useGL) {
    ctx.drawImage(GLDrawCanvas, 0, 0, CANVAS_W, CANVAS_H, 0, 0, CANVAS_W, CANVAS_H);
  }
}

/**
 * Canvas2D fallback used only when WebGL is unavailable.
 * (Approximate colorization; the GL path above is the accurate one.)
 */
function drawLayerCanvas2D(ctx, img, drawX, drawY, color, opacity, td, fullAlpha) {
  if (!img) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (td) {
    const pivotX = drawX + CANVAS_W / 2;
    const pivotY = drawY + CANVAS_H / 2;
    ctx.translate(pivotX, pivotY);
    if (td.rotation !== 0) ctx.rotate((td.rotation * Math.PI) / 180);
    if (td.skewX !== 0 || td.skewY !== 0) {
      ctx.transform(1, Math.tan((td.skewY * Math.PI) / 180), Math.tan((td.skewX * Math.PI) / 180), 1, 0, 0);
    }
    ctx.scale((td.flipX ? -1 : 1) * td.scaleX, (td.flipY ? -1 : 1) * td.scaleY);
    ctx.translate(-pivotX, -pivotY);
  }
  if (color && color[0] === "#" && fullAlpha !== false) {
    const off = new OffscreenCanvas(iw, ih);
    const octx = off.getContext("2d");
    octx.drawImage(img, 0, 0);
    octx.globalCompositeOperation = "multiply";
    octx.fillStyle = color;
    octx.fillRect(0, 0, iw, ih);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(img, 0, 0);
    ctx.drawImage(off, drawX, drawY);
  } else {
    ctx.drawImage(img, drawX, drawY);
  }
  ctx.restore();
}

/**
 * Capture a square headshot thumbnail (head + shoulders) from the 500×1000 canvas.
 * A square source region avoids the squished look of cropping a tall region.
 */
function captureThumbnail(canvas, size = 120) {
  const thumb = document.createElement("canvas");
  thumb.width = size;
  thumb.height = size;
  const tctx = thumb.getContext("2d");
  // Head/shoulders square, horizontally centered on the canvas midpoint (no guessing).
  const cw = 240;                         // crop size (square)
  const sx = (canvas.width - cw) / 2;     // center on x = 50%
  tctx.drawImage(canvas, sx, 60, cw, cw, 0, 0, size, size);
  return thumb.toDataURL("image/jpeg", 0.85);
}

// Detect CDN version synchronously from BC global (set by Game.js at load time)
initCdnVersion();

// Public API. setDebug(true) re-enables the verbose per-layer logging for troubleshooting.
window.BCRender = {
  renderCharacter, captureThumbnail, loadImage, resolveUrl, loadEchoOverrides,
  setDebug: (v) => { _DEBUG = !!v; console.log("[BCRender] debug logging", _DEBUG ? "ON" : "OFF"); },
  get overrideCount() { return _echoOverrideMap ? _echoOverrideMap.size : 0; },
  // Override the BC asset CDN base (for the server setting). Clears the image cache
  // so subsequent renders fetch from the new host.
  setCdnBase: (url) => {
    if (typeof url === "string" && url) {
      BC_CDN_BASE = url.endsWith("/") ? url : url + "/";
      _imgCache.clear();
      console.log("[BCRender] CDN base set:", BC_CDN_BASE);
    }
  },
  get cdnBase() { return BC_CDN_BASE; },
};
