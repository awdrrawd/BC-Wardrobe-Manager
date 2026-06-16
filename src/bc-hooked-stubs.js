/**
 * Ensures every BC function ECHO's real bcModSdk tries to hook/patch exists,
 * so the real SDK doesn't throw 'function to be patched not found'. Guarded so
 * real loaded BC functions keep their implementations. Dotted paths (ElementButton.*,
 * ElementMenu.*) get object stubs. Loaded after BC scripts, before the ECHO extension.
 */
"use strict";
(function () {
  const noop = function () {};
  const flat = [
    "ActivityCheckPrerequisites",
    "AppearancePreviewUseCharacter",
    "AssetAdd",
    "AssetBaseURL",
    "AssetBuildDescription",
    "AssetBuildExtended",
    "AssetGet",
    "AssetGroupAdd",
    "AssetLoadAll",
    "AssetTextGet",
    "CharacterAppearanceGetCurrentValue",
    "CharacterAppearanceValidate",
    "CharacterAppearanceVisible",
    "CharacterCheckHooks",
    "CharacterLoadCanvas",
    "CharacterSetFacialExpression",
    "ChatRoomCanBeLeashedBy",
    "ChatRoomCanLeave",
    "ChatRoomDoPingLeashedPlayers",
    "ChatRoomDrawCharacterStatusIcons",
    "ChatRoomPublishAction",
    "ChatRoomPublishCustomAction",
    "CommonDrawCanvasPrepare",
    "CommonDrawComputeDrawingCoordinates",
    "CommonDrawResolveAssetPose",
    "CommonTakePhoto",
    "CraftingItemListBuild",
    "CraftingSaveServer",
    "CraftingValidate",
    "DialogDraw",
    "DialogInventoryAdd",
    "DialogInventoryBuild",
    "DialogMenuButtonBuild",
    "DrawAssetPreview",
    "DrawCharacter",
    "DrawCharacterSegment",
    "DrawRefreshCharacterForImage",
    "ExtendedItemManualRegister",
    "GLDrawAppearanceBuild",
    "GLDrawLoad",
    "GLDrawLoadImage",
    "GLDrawLoadTextureAlphaMask",
    "InterfaceTextGet",
    "InventoryAvailable",
    "InventoryGetRandom",
    "InventoryItemHasEffect",
    "InventorySetPermission",
    "InventoryWear",
    "ItemColorLoad",
    "LoginDoNextThankYou",
    "LoginPerformCraftingFixups",
    "ServerAccountBeep",
    "ServerSend",
    "TranslationAssetProcess",
    "ValidationResolveAppearanceDiff",
    "ValidationResolveRemoveDiff",
    "ValidationResolveSwapDiff",
    "WardrobeFastLoad",
  ];
  for (const n of flat) { if (typeof window[n] === "undefined") window[n] = noop; }
  // Dotted hook targets — ensure container object + method exist.
  const dotted = [
    "ElementButton.Create",
    "ElementButton.CreateForActivity",
    "ElementButton.CreateForAsset",
    "ElementMenu.Create",
    "Player.CanWalk",
    "Player.GetSlowLevel",
  ];
  for (const path of dotted) {
    const [obj, meth] = path.split(".");
    if (typeof window[obj] === "undefined") window[obj] = {};
    if (typeof window[obj][meth] === "undefined") window[obj][meth] = noop;
  }
})();
