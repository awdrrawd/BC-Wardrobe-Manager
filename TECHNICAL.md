# BC Wardrobe Manager — 技術與維護文件

> 本文件記錄整個工具「如何運作」，供日後維護使用。
> 核心難點是：**在沒有完整 BC 遊戲客戶端的情況下，借用 BC 與 ECHO 的真實程式碼來繪製外觀。**
> 讀完本文，你應該能理解：如何連進 BC、如何抓取 ECHO 資產、如何正確定位、服裝屬性如何處理，以及壞掉時怎麼修。

---

## 0. 名詞

| 名詞 | 說明 |
|------|------|
| **BC** | Bondage Club，本體遊戲。素材（圖片）放在 BC 的 CDN。 |
| **BCX 字串** | 玩家匯出的外觀，是一個 LZString 壓縮的 JSON 陣列，每個元素是 `{Name, Group, Color, Property}`。 |
| **ECHO** | `echo-clothing-ext`，一個 BC 服裝擴充（mod），新增大量服裝與「V2 身體」。 |
| **bcModSdk** | BC mod 社群的 hook/patch 框架，ECHO 依賴它。 |
| **Asset / Group** | BC 的資產定義。`AssetGroup` 是部位（如 `Cloth`），`Asset` 是該部位的單品（如 `CorsetShirt`）。 |
| **Layer** | 一個 Asset 由多個圖層組成，每個 Layer 對應一張 PNG。 |

---

## 1. 總覽 / 檔案地圖

這是一個 **Electron** 應用。沒有後端，所有繪製都在 renderer（Chromium）內完成。

```
main.js              Electron 主行程：視窗、bc:// 協議、選單、IPC、資料夾、備份
preload.js           contextBridge，把主行程能力暴露給 renderer（window.api.*）
src/index.html       UI 結構，並「依特定順序」載入所有腳本
src/styles.css       樣式（顏色用 CSS 變數 --accent/--bg-preview/--bg-panel/--text）
src/app.js           UI 邏輯：i18n、設定、資料夾、縮放、呼叫繪製
src/bc-render.js      ★繪製核心（window.BCRender）：URL 解析、圖層管線、ECHO override manifest
src/bc-stubs.js       BC 全域變數/函式的最小 stub（讓 BC 腳本能在非遊戲環境執行）
src/bc-hook-stubs.js  自動產生：BC 資產 hook 函式的 no-op（ECHO 引用它們）
src/bc-runtime-stubs.js 受保護的 no-op：ECHO 引用、但我們沒載入的 BC runtime 函式
src/bc-hooked-stubs.js  確保「ECHO 會 hook 的函式」都存在（含 ElementButton.* 等點號路徑）
src/bc-vivify-stubs.js  自我繁殖 Proxy：DialogMenuMapping 之類深層存取的物件
src/bcmodsdk-patched.js 修補過的 bcModSdk：hook 不存在的函式時自動補 no-op 而非丟錯
src/locales/*.json    內建預設翻譯（打包用）
lang/*.json           ★執行時可編輯的翻譯（放在 .exe 旁，首次啟動由 locales 種入）
```

`index.html` 的腳本載入順序非常重要（見 §3、§5）。

---

## 2. 設計哲學（為什麼這樣做）

我們**沒有**重寫 BC 的繪製邏輯，而是**直接載入並執行 BC / ECHO 的真實程式碼**。原因：
- BC 的上色是 **WebGL 著色器**（FullAlpha / HalfAlpha），用 Canvas2D `multiply` 永遠對不上。
- ECHO 的定位、遮罩、V2 身體都綁在 BC 的繪製管線與 hook 上。

代價：BC / ECHO 預期在「完整遊戲客戶端」執行，會引用大量我們沒有的全域。
解法：用一整套 **stub（替身）** 補齊缺的全域，讓那些程式碼能跑起來（§9）。

---

## 3. 連進 BC（載入 BC 的真實腳本）

### 3.1 `bc://` 協議
`main.js` 註冊一個自訂協議，把 `bc://Scripts/GLDraw.js` 映射到本機的 BC 原始碼檔。

```js
protocol.handle("bc", (request) => {
  const url = new URL(request.url);
  const rel = (url.hostname + url.pathname).replace(/\//g, path.sep);
  const filePath = path.join(getBCPath(), rel);          // 開發：../Bondage-College-master/BondageClub
  return net.fetch("file:///" + filePath.replace(/\\/g, "/")); // 打包：resources/bc
});
```

`getBCPath()`：開發時指向專案旁的 BC 原始碼；打包時指向 `resources/bc/`（由
`package.json` 的 `extraResources` 篩選複製，**必須包含 `GLDraw.js`、`lib/webgl/**`、
`lib/bcmodsdk.min.js`、`Asset.js`、`CommonDraw.js`、`Pose.js`、`Common.js`、`Female3DCG.js`**）。
> ⚠️ 早期打包漏了 `GLDraw.js`，導致 EXE 沒有 WebGL、顏色全錯。修改依賴時務必更新此清單。

### 3.2 `index.html` 載入順序
```
1. bc-stubs.js          先補基礎全域
2. bc-hook-stubs.js
3. lib/LZString.js, lib/webgl/resources/m4.js
4. Common.js → GLDraw.js → Pose.js → Asset.js → Female3DCG.js → CommonDraw.js   （BC 真實腳本）
5. bc-runtime-stubs.js  （在 BC 腳本之後，受 typeof 保護 → 只補真正缺的）
6. bc-hooked-stubs.js → bc-vivify-stubs.js → bcmodsdk-patched.js
7. bc-render.js          我們的繪製核心
8. app.js                UI（ECHO 在這裡才被注入）
```
重點：**真實 BC 函式（function 宣告）會覆蓋先前的 var stub**；而 §5 的 runtime-stub 在
BC 腳本「之後」載入並用 `typeof window[n] === "undefined"` 保護，所以只補真正缺的。

### 3.3 啟動流程（`app.js` → `initBC()`）
```
AssetLoadAll()                 // BC 解析 Female3DCG.js，建立 Asset / AssetGroup（約 2412 / 85）
loadEchoExtension()            // 注入 ECHO（§5）
BCRender.loadEchoOverrides()   // 抓 ECHO 圖片覆寫清單（§6）
```

---

## 4. 渲染管線（`bc-render.js`）

`renderCharacter(canvas, bundle, onProgress, options)` 的步驟：

1. **`bundleToAppearance(bundle)`**：把 BCX 陣列轉成 BC 的 item 物件（用 `AssetMap.get("Group/Name")`）。
   - 同時補上 `AllowNone:false` 但 BCX 沒匯出的群組（如 `ArmsLeft/`、`HandsLeft/`，Asset 名為空字串）。
   - `Property.Type`（字串）→ 轉成 `TypeRecord`。
2. **可選：原版身體 → EchoV2**（`options.replaceBodyWithEcho`，預設開）。
3. **`buildActivePoses`**：永遠包含 `BaseUpper` + `BaseLower`（見 §7 的座標 bug）。
4. **過濾圖層**（§8）：Hide、屬性、AllowTypes、pose、LockLayer。
5. **`sortLayers`**：依 `Priority` 升冪排序（高 priority 蓋在上面）；**跳過 `TextureMask` 圖層**（那是遮罩，不是要畫的）。
6. **預先載入所有圖片**（`loadImage`，含 ECHO fallback），再灌進 BC 的 `GLDrawImageCache`。
7. **逐層用 BC 真實的 `GLDrawImage` 畫到共用 WebGL canvas（`GLDrawCanvas`，1000 寬）**，再 blit 左半 500×1000 到我們的 canvas。

### 4.1 上色（關鍵）
我們**不自己上色**，而是呼叫 `GLDrawImage(url, gl, x, y, opts)`：
- `shouldColorize = AllowColorize && color 是 #hex`。
- 是 → 傳 `HexColor` + `FullAlpha`：
  - `FullAlpha: true`（預設）→ `programFull`：所有非黑像素染成目標色。
  - `FullAlpha: false`（眼睛）→ `programHalf`：保留白/黑像素，只染中灰。
- 否 → 直接畫（命名色已烘進檔名，見 §6 的 ColorSuffix）。

> 顏色由 `resolveLayerColor` 解析，**忠實移植 BC 的 `CommonDrawResolveLayerColor`**（`Scripts/CommonDraw.js`）：
> 1. `item.Color[layer.ColorIndex]` 優先（這才是 BC 繪製用的色）。
> 2. 為 `Default` 時 → `item.Property.DefaultColor` → `item.Asset.DefaultColor`。
> 3. 仍為 `Default` 時 → 沿 `InheritColor` 鏈取**父群組 item 的第一個顏色**（只有自身為 Default 才繼承）。
>
> **關鍵陷阱（踩過的雷）**：
> - **不要用 `Property.Color`** 當繪製色 —— BC 根本不讀它。它常是殘留/全 Default 的陣列，若拿來蓋
>   `item.Color` 會讓染色錯誤（例：靴子 `item.Color=#1C1C1D` 黑，卻被 `Property.Color=#70ADCC` 染成藍）。
> - **InheritColor 必須「自身色優先」**：早期版本一開始就把 colorSource 切到繼承來源，導致 ECHO 髮型
>   自己的紫色被隱藏的原版 HairFront 灰色蓋掉。BC 只在自身為 Default 時才繼承。
> - 有 `ColorSuffix` 的身體圖層（BodyUpper 等）仍要回傳 hex，讓 `_White` 底圖被染成膚色 —— 早期回傳 null
>   導致身體看起來蒼白。

### 4.2 透明度（`resolveLayerOpacity`）
每層的最終 opacity = `layer.Opacity`（資產預設）→ 被 `Property.Opacity[該層索引]` 覆蓋（使用者用圖層透明度
UI 設的，依層名比對位置）→ 再**乘上** AEE `Property.LayerOverrides[idx].Opacity`。
- **關鍵陷阱**：AEE LayerOverride 的 Opacity 要**相乘不是覆蓋**。某些服裝同時帶 `Property.Opacity`（使用者把
  面板設 0 隱藏，如「吊带式裤」只露束帶）**和** AEE LayerOverride 預設的 `Opacity:1`。早期用 `=` 覆蓋會
  讓那個預設 1 把真正的 0 蓋掉、面板全顯示。改成 `opacity *= lo.Opacity` 後兩者意圖都保留（`0×1=0`、`1×0.5=0.5`）。
- `opacity <= 0` 的圖層**直接 `continue` 不畫**：BC 的純圖層 GL 程式理論上吃 `u_alpha`，但在本環境 alpha=0
  仍會透出，故直接跳過最保險。

### 4.3 程序化繪圖圖層（ECHO ScriptHook 重現）
有些 ECHO 物件**沒有圖片**（`DrawImages:false`、各層 `HasImage:false`），靠執行時的 `AfterDraw` ScriptHook
用 canvas 程式化繪製。我們的 renderer 不跑 ECHO 的繪圖 hook，所以需逐一**重現**其演算法。
- 目前實作：`額外头发_Luzi` 的「渐变叠加 / 双渐变叠加」（頭髮漸層染色），見 `buildGradientOverlays()`。
  對照 ECHO 原始碼 `echo-clothing-ext/.../化妆美发/渐变叠加.js` 的 `afterDraw`：用已繪製的髮型圖層合成
  「髮型形狀遮罩」（等同 ECHO 的 `PartsMask`），畫線性漸層後 `destination-in` 裁切，當成**已烘焙顏色的合成
  圖層**插進 GL 繪製順序（Back/Front 各依其 layer Priority）。漸層色取自物件自身 Color（InheritColor HairFront），
  Default 時用 ECHO 的 `#FF8888` fallback。
- 顯示與否由 `Property.TypeRecord`（`f`/`b` 模組選項，0=有）控制，與 ECHO 一致。
- **侷限**：其他程序化繪圖物件（呆毛等特效）尚未重現；要加就照同模式移植該物件的 `afterDraw`。

---

## 5. 載入 ECHO（最難的部分）

ECHO 是設計給「完整 BC 客戶端」的 mod。把它塞進我們的最小環境經歷了多層問題，依序解決：

### 5.1 注入
`loadEchoExtension()` 以 `<script type="module" src="https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js">`
注入。`bc-cloth.js` 內部再 `import("./main-XXXX.js")`（hash 檔名，等於 ECHO 當前 build）。

### 5.2 三類錯誤與對策
ECHO 的 bundle 在「模組求值」時會引用一堆我們沒有的全域，分三類處理：

1. **資產定義裡的 hook 值**（如 `ScriptHooks.Init: PropertyOpacityInit`）→
   `bc-hook-stubs.js`（從 BC 原始碼枚舉所有 `*Hook` / `Property*` 函式，全部 no-op）。
2. **常數**（`CanvasUpperOverflow=700`、`CanvasLowerOverflow=150`、`CanvasDrawWidth=500`、
   `ExtendedArchetype`、`ChatRoomMessageHandlers=[]` 等）→ `bc-stubs.js`。
3. **runtime 函式**（Dialog*/ChatRoom*/Draw* 等，約 137 個）→ `bc-runtime-stubs.js`
   （ECHO 原始碼 ∩ BC 原始碼，受 `typeof` 保護）。

### 5.3 真正的註冊機制（為什麼一開始 +0 groups）
ECHO 用 `@sugarch/bc-asset-manager` 註冊資產。關鍵發現：
- 註冊靠 `mod.invokeOriginal("AssetGroupAdd"/"AssetAdd", ...)` 真正呼叫 BC 函式。
- 我們原本的 **no-op bcModSdk** 讓 `invokeOriginal/callOriginal` 回傳 `undefined`，資產**靜默不註冊**。

對策：**載入真實的 bcModSdk**（`bc://Scripts/lib/bcmodsdk.min.js`），但它的 `hookFunction`
若 hook 一個不存在的函式會**丟錯**。於是：
- `bc-hooked-stubs.js`：確保所有 ECHO 會 hook 的函式都存在（含點號路徑 `ElementButton.Create`、`ElementMenu.Create`）。
- `bcmodsdk-patched.js`：**修補版** bcModSdk —— hook 找不到目標函式時**自動補一個 no-op**（並 `console.warn`），
  而非丟錯。這讓較新的 ECHO build 即使 hook 了我們沒列出的函式也不會中斷。

### 5.4 設定面 / 觸發
- ECHO 的 `AssetManager` 在 `AssetGroup.length > 50` 時**立即註冊**（我們有 85 個，符合），不需等登入事件。
- ECHO 的初始化鏈需要一個「已登入的 Player」：在 `bc-stubs.js` 提供 mock `Player`
  （`Crafting/ExtensionSettings/PermissionItems/Appearance` 等欄位 + `CanInteract()/HasEffect()` 等方法）。
- 深層存取（`DialogMenuMapping.items.clickStatusCallbacks`）→ `bc-vivify-stubs.js` 的**自我繁殖 Proxy**
  （任何 `.x.y` 都回傳新 Proxy、寫入會被吞），讓拘束類元件初始化不丟錯，使**所有元件（含服裝）都能註冊**。
- 其他散落的全域：`TextAllScreenCache = new Map`、`TranslationLanguage`、`LoginInventoryFixups=[]`、
  以及 `ModularItemRegister/TypedItemRegister/...` 回傳 `null`（我們只要圖層，不需要延伸物品 UI）。

成功後：`AssetGroup` 從 85 → 120（+35 群組），`Asset` +2064。
> 偵錯指令：在 console 執行 `echoList()` 會列出 ECHO 新增的群組。

---

## 6. 素材網址解析（`resolveUrl`）

一張圖片的相對路徑（rel）長這樣：`Assets/Female3DCG/<group>/<pose>/<expr>/<檔名>.png`，
檔名由 `buildLayerUrl` 組成：`assetName_parentAsset_layerType_colorSuffix_layerName.png`。

解析優先序（順序很重要）：
1. **先用 ECHO live image mapping 正規化路徑**（`window.__BC_LUZI_GLOBALS__["ImageMapping@x"].mapImgSrc`）。
   它會套用 ECHO 的 per-asset 重導，**包含尺寸映射與共用 ArmMask**。回傳可能是完整 URL（直接用）或正規化後的相對路徑。
2. **用我們的 override manifest 把（正規化後的）相對路徑轉成 jsdelivr commit URL**。
   ⚠️ 關鍵：ECHO 內部的 basic-mapping 在我們的環境常是空的，所以 `mapImgSrc` 只會把路徑改成相對路徑（不會變 URL），必須由我們的 manifest 補上 URL。
3. **BC CDN**（`BC_CDN_BASE` + path）。

> **尺寸映射（曾造成某些外套不顯示）**：部分服裝（如「敞開夾克」披肩外套、某些鞋子）不隨胸圍變化，
> ECHO 只畫了部分尺寸並在自家 `.js` 用 `addImageMapping` 註冊映射，例如
> `敞开夹克.js`：`{ Normal: ["Large","XLarge"], Small: ["FlatSmall","FlatMedium"] }`（XLarge/Large 都用 Normal 的圖）。
> 我們組出的檔名用 BodyUpper 尺寸（如 `敞夹克_XLarge_Y_A1.png`），manifest 沒這個尺寸。
> ECHO 本應透過 `mapImgSrc` 做這個映射，但在我們的精簡 harness 裡它不可靠（內部 basic-map 是空的），
> 所以 `resolveUrl` **自己對 manifest 做尺寸 fallback**（`sizeFallbackUrl`）：當某尺寸不在 manifest，
> 就依鄰近順序試其他尺寸（`XLarge→Large→Normal→Small`…），用 manifest 裡有的那個。這對整類「只做部分
> 尺寸的服裝」通用，且只在原尺寸缺檔時才觸發，不影響有完整尺寸的服裝。

### 6.1 ECHO override manifest（V2 服裝的關鍵）
ECHO 把**同一個檔名**的服裝重畫成 V2 版本，放在自己的 CDN。清單在：
```
https://sugarchain-studio.github.io/echo-clothing-ext/assetOverrides.lz   （LZString 壓縮）
解開後 = { "<commit-hash>": [ "Assets/Female3DCG/Cloth/CorsetShirt_XLarge_Shirt.png", ... ], ... }
圖片網址 = https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@<commit>/resources/<path>
```
`loadEchoOverrides()` 在啟動時抓並建表（約 25000 筆）。這同時涵蓋 ECHO 自訂資產與 vanilla 服裝的 V2 覆寫。

### 6.2 BodyStyle override（身體本體）
`EchoV1 / EchoV2` 是 **BC 原生**的 BodyStyle（在 Female3DCG.js 內），其 `Layer[0].StyleOverride`
列出要改走 `Assets/Female3DCG/Override/EchoV2/<group>/` 的群組（BodyUpper/BodyLower/Arms/Hands/Head/Nipples/Pussy）。
`buildLayerUrl` 依此重導（鏡像 BC 的 `AssetBaseURL`）。

### 6.3 伺服器版本
`BC_CDN_BASE` 預設由 `GameVersion`（R129）組成。設定頁可改伺服器與版本（模板用 `{ver}` 取代）。
> BC 更新版本時，舊網址會失效；使用者改「版本」欄即可。`BCRender.setCdnBase(url)` 可動態切換並清快取。

---

## 7. 正確定位

### 7.1 基本座標
`drawX = layer.DrawingLeft[pose]`，`drawY = layer.DrawingTop[pose]`（`AssetParseTopLeft` 解析 `Left/Top`）。
我們的 canvas 高 1000，**直接用** `DrawingTop`（不像 BC 加 `CanvasUpperOverflow=700`，因為我們的可視區就是上半 1000）。

### 7.2 ★Pose 預設（曾造成「往右偏」）
有些資產的 `Left` 是 pose 字典且**沒有 `""` 預設鍵**（如襪子 `{BaseLower:0, KneelingSpread:30}`）。
`AssetParseTopLeft` 會把 `""` 補成「群組 fallback」（SuitLower 是 95）→ 若沒有任何 active pose，就用到錯的 95。
**修正**：`buildActivePoses` **永遠加入 `BaseUpper` + `BaseLower`**（這是 BC 角色的預設 pose），
這樣 pose-keyed 座標會解析到 `BaseLower` 的值（0）。

### 7.3 BodyStyle DrawOffset
EchoV2 的 BodyStyle 帶 `DrawOffset`（把 Pussy / 陰部道具等 Y 上移 16），我們在繪製時套用，鏡像 BC 的 `CommonDrawComputeDrawingCoordinates`。

### 7.4 圖片尺寸
ECHO 服裝有「滿版 500×1000」（畫在 (0,0)）也有「裁切小圖」（靠 Left/Top 定位，如裙子 380×310 @ (60,380)）。
`drawLayerGL` 用圖片自然尺寸畫，不強拉。

> 偵錯：`BCRender.setDebug(true)` 會印出每層的 `pos=(x,y) img=WxH`。

---

## 8. 服裝屬性（可見性與遮罩）

過濾與遮罩都鏡像 BC 的 `CharacterAppearanceSortLayers` / `CommonDrawAppearanceBuild`：

| 屬性 | 行為 | 實作 |
|------|------|------|
| **Hide / HideItem** | 某件物品隱藏其他群組／單品 | `buildHidden()` 收集 `Asset.Hide`、`Property.Hide`、`HideItem`。讓 ECHO 眼睛蓋掉 vanilla `Eyes`。 |
| **HideForAttribute / ShowForAttribute** | 依角色屬性切換圖層 | 收集所有 `Asset.Attribute` 成 set；`HideForAttribute` 命中就隱、`ShowForAttribute` 全不中就隱。**這解決了貓耳重複**（短髮 `ShortHair` 才用 Short 圖層）。 |
| **AllowTypes** | 依 `TypeRecord` 切換圖層變體 | `allowForTypes()` 完整複製 BC 的 `CharacterAppearanceAllowForTypes`（用 `TypeToID/IDToTypeKey` 交集）。 |
| **Opacity** | 半透明（如 Decals 貼花） | `resolveLayerOpacity()`：`Property.Opacity`（純量或陣列）夾在 `[MinOpacity, MaxOpacity]`，AEE override 最後覆蓋。 |
| **Visible:false** | 不畫（如 BodyStyle 本身） | 直接跳過。 |
| **LockLayer** | 只有上鎖時顯示 | 需 `Property.LockedBy`。 |

### 8.1 兩種遮罩
1. **GroupAlpha（矩形遮罩）**：某圖層的 `Alpha` 針對其他群組挖矩形洞。`groupAlphas` 收集後，
   畫某層時把對應矩形傳給 `GLDrawImage` 的 `AlphaMasks`。
2. **TextureMask（圖片遮罩，手在衣服上）**：服裝有 `TextureMask` 圖層（`ArmMask`）。
   - 這些**不畫**，而是當遮罩：`collectTextureMasks()` 依 `priority` 過濾後，傳給 `GLDrawImage` 的 `TextureAlphaMask`，把袖子在手的位置挖空，讓手（低 priority）露出。
   - ArmMask 的圖其實是**共用的** `Assets/Female3DCG/LuziArmMask/<MaskName>_<size>.png`（ECHO 用 image mapping 重導）；
     我們在 `collectTextureMasks` 直接組這個 URL（因為 ECHO 的自訂 mapping 在我們這邊不一定命中）。

---

## 9. Stub 檔案速查（壞掉時先看這裡）

| 檔案 | 補什麼 | 何時要動 |
|------|--------|----------|
| `bc-stubs.js` | 基礎全域、常數、mock Player、ExtendedArchetype、Canvas* 常數、bcModSdk 註解 | ECHO 報「X is not defined」且 X 是常數/物件 |
| `bc-hook-stubs.js` | 所有 BC `*Hook` / `Property*` 函式 no-op（自動產生） | 新版 ECHO 引用新的 hook 值 |
| `bc-runtime-stubs.js` | ECHO 引用的 BC runtime 函式 no-op（自動產生、受保護） | 同上，但屬於 runtime 函式 |
| `bc-hooked-stubs.js` | 確保 ECHO「會 hook 的函式」存在（含點號路徑） | bcModSdk 報「Function X to be patched not found」（理論上 patched 版已自動補） |
| `bc-vivify-stubs.js` | 深層存取的自我繁殖 Proxy | ECHO 報「Cannot read properties of undefined (reading '...')」 |
| `bcmodsdk-patched.js` | 修補版 SDK：缺函式自動補 no-op | 一般不用動；它是由 `bc://Scripts/lib/bcmodsdk.min.js` 修補產生（見檔頭註解） |

**自動產生 stub 的方法**（當 BC/ECHO 更新後想重新枚舉）：用 grep 從
`Bondage-College-master` 抓所有 `function *Hook` / `function Property*`，輸出成
`window.X = ()=>{}` 清單（參考 git 歷史中產生這些檔的 bash 片段）。

---

## 10. 應用層（`app.js` / `main.js` / `preload.js`）

- **i18n**：`lang/` 資料夾的 JSON（`main.js` 透過 IPC 提供，renderer `loadLocale()` 讀取，
  fallback 內建 `src/locales`）。字串用 `{n}` 佔位符，`fmt()` 填值。`_name` 是語言顯示名。
- **設定**：存在 `localStorage`（顏色、伺服器、版本、插件）與 `config` store（語言、資料夾）。
  - 四個顏色 → CSS 變數 `--accent/--bg-preview/--bg-panel/--text`。
  - 伺服器三鏡像 + 自訂；版本可編輯。
  - 插件：本機 `.js`（`userData/plugins`，透過 IPC 列舉/刪除/開資料夾）+ URL 清單，各自可開關。
- **資料夾**：outfit 有 `folder` 欄；空資料夾存在 `localStorage.extraFolders`。
  拖曳 outfit 到資料夾標頭 = 搬移；右鍵選單 + 樹狀 picker。
- **儲存位置**：`config.dataDir` 指向 wardrobe store 的位置；File → 變更會複製資料並 relaunch。
- **IPC（preload `window.api`）**：`wardrobe.*`、`bc.path`、`plugins.*`、`lang.*`、`onOpenSettings`。

---

## 11. 打包

- 開發：`npm start`（讀 `src/`，`getBCPath` 指向專案旁 BC 原始碼）。
- 打包：`package.json` 用 **electron-builder**，BC 腳本由 `extraResources` 篩選複製到 `resources/bc/`。
  - ⚠️ electron-builder 的 NSIS 需要 `winCodeSign`，在**未開啟 Windows 開發者模式**的機器上會因
    macOS symlink 解壓失敗。要嘛開開發者模式，要嘛用**免安裝可攜版**（目前採用）。
- 可攜版：`dist-packaged/BC Wardrobe-win32-x64/`（electron-packager 產物）。維護方式 = 把
  `main.js / preload.js / src/* / locales` 複製進 `resources/app/`，把 BC 腳本複製進 `resources/bc/`，
  再壓成 zip。`lang/` 放在 `.exe` 旁邊。

---

## 12. 常見維護任務

**A. BC 升版（R129 → R130）**
- 圖片 404：使用者改設定的「版本」即可（無需改碼）。
- 若資產定義也變了：更新專案旁的 `Bondage-College-master`，重新打包 `resources/bc/`。

**B. ECHO 改版後載入失敗（`echoList()` 回 0）**
- 看 console **第一個** ReferenceError（通常來自中文檔名 `.js`）。
- 是常數/物件 → 加進 `bc-stubs.js`；是函式 → 應已被 `bcmodsdk-patched` / runtime-stubs 自動補，
  否則手動加。深層存取錯誤 → 把該物件加進 `bc-vivify-stubs.js` 的清單。

**C. 某件 ECHO 服裝沒顯示**
- `BCRender.setDebug(true)` 看該層的 `→ url`，把網址貼進瀏覽器確認是否 404。
- 404 → 檢查 override manifest 是否含此路徑、版本是否正確、`buildLayerUrl` 組出的檔名是否正確。
- **特別注意尺寸**：若檔名是 `_XLarge_` 但 manifest 只有 `_Normal_/_Small_`，多半是該服裝的尺寸映射
  （見 §6.1）。確認 `resolveUrl` 有「先 `mapImgSrc` 正規化、再查 manifest」的順序。
  快速驗證：把 log 的相對路徑換成對應尺寸（XLarge→Normal）後，看是否在 manifest 內。

**D. 位置/圖層錯**
- 先確認 `BaseUpper/BaseLower` 有在 active poses（§7.2）。
- 顏色錯 → 確認走 WebGL（`GLVersion !== "No WebGL"`，且 `resolveLayerColor` 有回傳 hex）。
- 手被衣服蓋住 → 確認 TextureMask（ArmMask）有載入（§8.1）。

**D2. 染色 / 透明度錯（§4.1–4.3）**
- 整件染成怪色（藍/灰）→ 多半是誤用了 `Property.Color`。BC 只認 `item.Color`，`resolveLayerColor` 必須以它為主。
- ECHO 髮型/服裝顏色被原版同群組蓋掉 → InheritColor 要「自身色優先，Default 才繼承」。
- 某些圖層該隱藏卻全顯示（如吊帶褲只露束帶）→ 檢查 `Property.Opacity` 是否被 AEE `LayerOverrides[].Opacity`
  覆蓋。兩者要**相乘**（§4.2）。可暫時在 `resolveLayerOpacity` 印 `op / Property.Opacity / lo.Opacity` 對比。
- 頭髮少了漸層粉色 / 物件「有資料卻完全沒畫」→ 可能是程序化繪圖（ScriptHook）物件（§4.3），需移植其 `afterDraw`。

**D3. 某尺寸服裝 404 / 不顯示（§6 尺寸映射）**
- console 出現 `<衣>_XLarge_…png 404` 後又 jsdelivr `@main 403` → 該服裝只做部分尺寸。確認 `sizeFallbackUrl`
  有涵蓋該尺寸 token，且 manifest 內存在鄰近尺寸（`BCRender.overrideCount` 應 > 0）。

**E. 偵錯 API**
```js
BCRender.setDebug(true)   // 開啟逐層 log（圖層計畫、繪製座標）
BCRender.overrideCount    // ECHO override manifest 筆數
BCRender.cdnBase          // 目前 BC CDN 基底
echoList()                // 列出 ECHO 新增的群組
```

---

## 附錄：外部端點一覽

| 用途 | URL |
|------|-----|
| BC 圖片 CDN（預設） | `https://www.bondageprojects.elementfx.com/{ver}/BondageClub/` |
| BC 鏡像 | `https://www.bondage-europe.com/{ver}/BondageClub/`、`https://www.bondage-asia.com/club/{ver}/` |
| ECHO 載入器 | `https://sugarchain-studio.github.io/echo-clothing-ext/bc-cloth.js` |
| ECHO 圖片覆寫清單 | `https://sugarchain-studio.github.io/echo-clothing-ext/assetOverrides.lz` |
| ECHO 圖片 CDN | `https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@<commit>/resources/<path>` |
| bcModSdk | `bc://Scripts/lib/bcmodsdk.min.js`（本機，修補成 `bcmodsdk-patched.js`） |
