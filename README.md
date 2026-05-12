# 拿破崙與秘書｜Firebase 多人對戰版

這是一個可部署到 GitHub Pages 的靜態網頁遊戲。玩家用房號加入同一桌，最多 5 位真人；不足 5 位時，房主可以用電腦補位。遊戲採台灣常見「拿破崙與秘書」核心玩法，並把常見分歧放進房主選單。

## 功能

- Firebase Realtime Database 多人同步
- Firebase Authentication 匿名登入
- 建立房間、輸入房號加入、複製邀請連結
- 5 人對戰，真人不足可補電腦
- 電腦難度 1–20 級
- 台式常見設定：底牌頭處理、首攻規則、是否無王、末三輪鬼牌變小、王牌 2/3 召鬼、是否允許獨裁
- GitHub Pages workflow 已附好
- 無需打包工具，直接靜態部署

## 重要限制

這是休閒對戰版。因為網頁本身部署在 GitHub Pages，牌局主持端是「房主的瀏覽器」，而非可信任伺服器。一般朋友對戰可以使用；若要正式比賽、防作弊或隱藏所有玩家手牌，建議把牌局裁判邏輯搬到 Cloud Functions、自架伺服器或其他可信任後端。

## Firebase 設定

1. 到 Firebase Console 建立專案。
2. 建立 Web App，複製 Firebase config JSON。
3. 啟用 Authentication → Sign-in method → Anonymous。
4. 建立 Realtime Database，記下 databaseURL。
5. 到 Realtime Database → Rules，貼上本專案的 `database.rules.json` 內容並發布。
6. 開啟網頁後，把 config JSON 貼到畫面上的 Firebase 設定欄位。

範例格式請看 `firebase-config.example.json`。

## GitHub Pages 部署

1. 在 GitHub 建立一個新 repository。
2. 把本資料夾所有檔案推到 `main` 分支。
3. 到 repository 的 Settings → Pages，把 Build and deployment 選為 GitHub Actions。
4. 推送後 Actions 會使用 `.github/workflows/pages.yml` 自動部署。
5. 開啟 GitHub Pages 網址，貼上 Firebase config，即可建立房間。

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
- `firebase-config.example.json`：Firebase 設定範例
- `database.rules.json`：Realtime Database 基礎規則
- `.github/workflows/pages.yml`：GitHub Pages 自動部署 workflow
- `.nojekyll`：避免 GitHub Pages 使用 Jekyll 處理靜態檔案

## 遊戲流程

1. 玩家連線 Firebase。
2. 房主建立房間並分享房號或邀請連結。
3. 其他玩家加入；房主可用電腦補滿 5 人。
4. 房主調整規則並開始。
5. 依序叫牌、選王牌、換底牌、指定秘書、打 10 墩牌。
6. 結算後房主可開始下一局。
