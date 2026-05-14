# 拿破崙與秘書｜Firebase 多人對戰版

這是一個可部署到 GitHub Pages 的靜態網頁遊戲。玩家用房號加入同一桌，最多 5 位真人；不足 5 位時，房主可以用電腦補位。遊戲採台灣常見「拿破崙與秘書」核心玩法，並把常見分歧放進房主選單。

## 功能

- Firebase Realtime Database 多人同步
- Firebase Authentication 匿名登入
- 建立房間、輸入房號加入、複製邀請連結與 QR Code
- 5 人對戰，真人不足可補電腦
- 電腦難度 1–20 級
- 台式常見設定：底牌頭處理、首攻規則、是否無王、末三輪鬼牌變小、王牌 2/3 召鬼、是否允許獨裁
- GitHub Pages workflow 已附好
- 無需打包工具，直接靜態部署

## 重要限制

這是休閒對戰版。因為網頁本身部署在 GitHub Pages，牌局主持端是「房主的瀏覽器」，而非可信任伺服器。一般朋友對戰可以使用；若要正式比賽、防作弊或隱藏所有玩家手牌，建議把牌局裁判邏輯搬到 Cloud Functions、自架伺服器或其他可信任後端。

## Firebase 設定

Firebase Web App 設定已內建在 `app.js` 的 `FIREBASE_CONFIG`，玩家不需要在網頁上輸入設定。

部署前請確認：

1. Firebase Console → Authentication → Sign-in method → Anonymous 已啟用。
2. Firebase Console → Realtime Database → Rules 已貼上本專案的 `database.rules.json` 內容並發布。
3. 部署到 GitHub Pages 後，Firebase Console → Authentication → Settings → Authorized domains 已加入你的 `github.io` 網域，例如 `fox520-sketch.github.io`。

若日後更換 Firebase 專案，只要修改 `app.js` 最上方的 `FIREBASE_CONFIG`。

## GitHub Pages 部署

1. 在 GitHub 建立一個新 repository。
2. 把本資料夾所有檔案推到 `main` 分支。
3. 到 repository 的 Settings → Pages，把 Build and deployment 選為 GitHub Actions。
4. 推送後 Actions 會使用 `.github/workflows/pages.yml` 自動部署。
5. 開啟 GitHub Pages 網址；網頁會自動連線 Firebase，即可建立房間。

## 本機測試

由於瀏覽器對 `file://` 的 ES module 與 Firebase SDK 載入限制較多，建議用簡單靜態伺服器測試：

```bash
python3 -m http.server 8080
```

然後開啟：

```text
http://localhost:8080
```

## 檔案說明

- `index.html`：主頁與遊戲 UI
- `style.css`：簡約清爽海洋風樣式
- `app.js`：Firebase 多人同步、房間、牌局、AI、計分邏輯
- `database.rules.json`：Realtime Database 基礎規則
- `.github/workflows/pages.yml`：GitHub Pages 自動部署 workflow
- `.nojekyll`：避免 GitHub Pages 使用 Jekyll 處理靜態檔案

## 遊戲流程

1. 網頁自動連線 Firebase。
2. 房主建立房間並分享房號、邀請連結或 QR Code。
3. 其他玩家加入；房主可用電腦補滿 5 人。
4. 房主調整規則並開始。
5. 依序叫牌、選王牌、換底牌、指定秘書、打 10 墩牌。
6. 結算後房主可開始下一局。


## 邀請朋友加入

建立房間後，大廳會顯示邀請連結與 QR Code。朋友可以：

1. 按「複製邀請連結」後貼給朋友。
2. 用手機掃描 QR Code 開啟網頁，系統會自動帶入房號並嘗試加入房間。

QR Code 會用公開 QR 圖片服務即時產生；若 QR 圖片沒有出現，仍可使用「複製邀請連結」。

## 2026-05-14 手機版更新

- 手機直向時牌桌會自動縮小。
- 玩家座位、中央出牌區與手牌尺寸會依螢幕高度壓縮。
- 手牌改為橫向滑動排列，避免被牌桌擠到畫面外。
