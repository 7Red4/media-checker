# media-checker

Chrome 擴充功能（Manifest V3）：在任何網頁上以燈箱檢視圖片與影片。

## 安裝

1. 開啟 `chrome://extensions`，打開右上角「開發人員模式」
2. 點「載入未封裝項目」，選擇這個資料夾
3. 已開啟的分頁會自動生效，不需重新整理

本機 `file://` 頁面需在擴充功能詳細資料中另外開啟「允許存取檔案網址」。

## 使用

| 操作 | 效果 |
| --- | --- |
| 右鍵選單 `media-check` | 開啟燈箱 |
| `Alt` + 右鍵 | 開啟燈箱（頁面禁用右鍵時也有效） |
| 滾輪 | 以游標為中心縮放 |
| 左鍵拖曳 | 移動媒體 |
| 右下角區塊內滾輪 | 旋轉媒體（按住 `Shift` 為微調） |
| `Esc` | 有縮放、旋轉或移動時復原；已是原狀態時退出 |
| 空白鍵、點影片 | 播放／暫停 |
| `Alt` + `C` | 複製目前頁面網址，成功時顯示「已複製網址連結」 |

`Alt` + `C` 需要焦點在網頁內；焦點在網址列，或在 Chrome 不允許注入的頁面上不會作用。焦點在 iframe 內時，複製的是分頁本身的網址。

## 媒體偵測

依座標判斷，不依賴事件目標，因此能處理：

- `img`（含 `srcset` 取最高解析度、`<picture>`、lazy-load 的 `data-src`）、`video`、`canvas`、inline `svg`、SVG `<image>`、`input[type=image]`、`object`／`embed`
- `background-image`、`::before`／`::after`、`content: url()`、`mask-image`、`border-image`、`image-set()`
- `pointer-events: none`、透明遮罩、`spacer.gif` 這類佔位圖、疊在媒體上的小圖示
- open 與 closed shadow DOM、`visibility: hidden`、`inert`
- 同來源與跨來源 iframe，包含 `pointer-events: none` 的 iframe，以及蓋在媒體上的透明 iframe

## 載入失敗時的退回順序

**圖片**：直接載入 → 由 background 帶 cookie 重新抓取 → 拷貝原元素已解碼的畫面。

**影片**：複製一份新元素載入 → 鏡像原元素畫面（MSE、串流；控制列直接操作原影片）→ 目前畫面的截圖 → poster。

iframe 內的媒體會交給頂層頁面開啟；頂層載入不到時（例如防盜連），改在媒體所在的 iframe 內開啟。

## 已知限制

- `chrome://`、線上應用程式商店、內建 PDF 檢視器等頁面，Chrome 不允許擴充功能注入
- DRM 影片（Widevine 等）無法複製或鏡像，畫面可能全黑
- 未開啟 `preserveDrawingBuffer` 的 WebGL canvas，擷取結果可能是空白
- canvas 顯示的是開啟當下的靜態畫面
- 跨來源且被污染的 canvas 無法傳到頂層，會在所在的 iframe 內開啟

## 結構

```
manifest.json
background.js        右鍵選單、frame 間訊息轉送、圖片重抓
content/detect.js    座標 → 媒體
content/lightbox.js  燈箱 UI 與互動
content/main.js      事件攔截、跨 frame 探測
icons/               圖示（SVG 原稿與 PNG）
test/                手動測試頁
```

## 手動測試

跨來源案例需要 HTTP 伺服器，且須從 `localhost` 開啟（頁面會以 `127.0.0.1` 載入跨來源 iframe）：

```
npx http-server test -p 8080
```

接著開啟 <http://localhost:8080/index.html>。
