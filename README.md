
# BC Wardrobe Manager

> A standalone, **install-free** desktop tool that renders **Bondage Club (BC)** character
> appearances — including **ECHO** custom clothing — and lets you save, categorize and
> manage outfits offline.
>
> 一個**免安裝**的獨立桌面工具，能繪製 **Bondage Club（BC）** 角色外觀（含 **ECHO**
> 擴充服裝），並讓你儲存、分類、管理多套外觀。

**Author / 作者:** Likolisu  ·  **Version / 版本:** 1.0
**Repository:** https://github.com/awdrrawd/BC-Wardrobe-Manager

---

## English

### What it does
- Paste a **BCX appearance string** (BCX → Appearance → Export) and preview the character.
- Renders with BC's **real WebGL shaders**, so colors and layering match the game.
- Loads **ECHO** custom clothing automatically (eyes, hair, dresses, masks, etc.).
- Save outfits into **folders**, drag-and-drop to organize, rename, back up and restore.
- Multi-language UI, themeable colors, switchable asset servers.

### Requirements
- **Windows 64-bit.**
- An **internet connection** — the tool downloads character images from BC's CDN and
  ECHO's CDN (jsDelivr) at render time. These are external servers and may occasionally
  be slow or unavailable.

### Install / Run
There is **no installer**. Just:
1. Unzip `BC-Wardrobe-Manager-v1.0-win64.zip` anywhere.
2. Run **`BC Wardrobe.exe`**.

Your saved outfits live in the app's data folder (you can change its location from
**File → Change save folder location…**).

### Quick start
1. In **BCX** in-game: *Appearance → Export* and copy the string.
2. Paste it into the **Import BCX String** box on the right.
3. Click **▶ Preview**.
4. Give it a name (and optional folder) and click **💾 Save as New Outfit**.

### Features
| Area | What you can do |
|------|-----------------|
| **Preview** | Drag to pan, mouse-wheel + `Ctrl` to zoom, **Full body** button to reset. |
| **Outfits** | Save many outfits; double-click to rename. |
| **Folders** | Create folders, drag outfits between them, right-click to rename/move/delete. |
| **Echo body** | Toggle "Use Echo V2 body instead of original". |
| **Settings (⚙ menu)** | Language, asset server + version, 4 themeable UI colors, plugin manager. |
| **File menu** | Backup / Restore wardrobe (JSON), change the save-folder location. |
| **Help → About** | Version, author, repo link. |

### Asset server / version (important)
BC periodically bumps its game version (e.g. `R129 → R130`). When that happens the old
image URLs can stop working. In **Settings → Asset server** you can:
- pick a mirror (**elementfx / europe / asia**), and
- edit the **Version** field to the current BC version,
- or enter a fully **Custom** base URL.

### Translating the UI
Translations are plain **JSON files** in the **`lang/`** folder next to the `.exe`:
- Edit `lang/en.json` / `lang/zh.json` to change wording.
- To add a language: copy `en.json` → e.g. `fr.json`, translate the values, set
  `"_name": "Français"`. It appears automatically in **Settings → Language**.
- Keep the `{n}` / `{m}` placeholders intact.
- Shortcut: **Settings → Open language folder…**

### Clothing plugins
ECHO is built in. To add other clothing extensions:
- **Settings → plugins → 📁** opens the plugin folder; drop `.js` plugin files there, or
- **Settings → plugins → ＋** to add a plugin by URL.
- Toggle each on/off, delete with ✕. Restart to apply.

### Notes & limitations
- This tool **only renders and saves** appearances. It does **not** connect to your BC
  account and cannot change your in-game character.
- Some ECHO restraints have complex behavior that this tool does not simulate; clothing
  is the primary focus.
- Rendering fidelity depends on BC/ECHO assets being reachable online.

---

## 繁體中文

### 這是什麼
- 貼上 **BCX 外觀字串**（BCX → 外觀 → 匯出）即可預覽角色。
- 使用 BC 的**真實 WebGL 著色器**繪製，顏色與圖層與遊戲內一致。
- 自動載入 **ECHO** 擴充服裝（眼睛、髮型、洋裝、面具等）。
- 將外觀存進**資料夾**、拖曳分類、重新命名、備份與還原。
- 多語系介面、可自訂顏色、可切換素材伺服器。

### 系統需求
- **Windows 64 位元。**
- **需要網路** — 繪製時會從 BC 的 CDN 與 ECHO 的 CDN（jsDelivr）下載角色圖片。
  這些是外部伺服器，偶爾可能較慢或無法連線。

### 安裝 / 執行
**免安裝**，直接：
1. 將 `BC-Wardrobe-Manager-v1.0-win64.zip` 解壓縮到任意位置。
2. 執行 **`BC Wardrobe.exe`**。

已存外觀放在程式的資料夾中（可由 **檔案 → 變更儲存資料夾位置…** 變更）。

### 快速上手
1. 在遊戲內 **BCX**：*外觀 → 匯出*，複製字串。
2. 貼到右側的 **匯入 BCX 字串** 欄位。
3. 點擊 **▶ 預覽**。
4. 命名（可選擇資料夾）後點 **💾 另存為新服裝**。

### 功能
| 區塊 | 可做的事 |
|------|----------|
| **預覽** | 拖曳平移、`Ctrl`＋滾輪縮放、**全身** 按鈕還原。 |
| **服裝** | 儲存多套；雙擊重新命名。 |
| **資料夾** | 新增資料夾、拖曳搬移、右鍵重新命名／移動／刪除。 |
| **Echo 身體** | 切換「用 Echo V2 身體取代原版」。 |
| **設定（選單）** | 語言、素材伺服器＋版本、四種介面顏色、插件管理。 |
| **檔案選單** | 備份／還原衣櫃（JSON）、變更儲存資料夾位置。 |
| **說明 → 關於** | 版本、作者、倉庫連結。 |

### 素材伺服器 / 版本（重要）
BC 會不定期更新版本（例如 `R129 → R130`），舊的圖片網址可能會失效。
在 **設定 → 素材伺服器** 可以：
- 選擇鏡像（**elementfx / europe / asia**），
- 編輯 **版本** 欄位為目前 BC 版本，
- 或輸入完整的**自訂** 基底網址。

### 翻譯介面
翻譯是 `.exe` 旁邊 **`lang/`** 資料夾內的純 **JSON 檔**：
- 編輯 `lang/en.json` / `lang/zh.json` 即可改字。
- 新增語言：複製 `en.json` → 例如 `fr.json`，翻譯內容，設定 `"_name": "Français"`，
  會自動出現在 **設定 → 語言**。
- 請保留 `{n}` / `{m}` 佔位符。
- 捷徑：**設定 → 開啟語言資料夾…**

### 服裝插件
ECHO 已內建。要加入其他服裝擴充：
- **設定 → 插件 → 📁** 開啟插件資料夾，把 `.js` 插件丟進去，或
- **設定 → 插件 → ＋** 以網址新增插件。
- 每個插件可開關、用 ✕ 刪除。重啟後生效。

### 注意事項
- 本工具**只負責繪製與儲存**外觀，**不會**連到你的 BC 帳號，也無法更改遊戲內角色。
- 部分 ECHO 拘束具有複雜行為，本工具不模擬；服裝為主要目標。
- 繪製品質取決於 BC／ECHO 素材能否在線上取得。
