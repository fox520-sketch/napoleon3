# 拿破崙與秘書｜單人離線・Firebase 多人對戰版

這是一個可部署到 GitHub Pages 的靜態網頁遊戲。主畫面可直接開始「單人離線」局，系統會自動補 4 位電腦；也可以使用 Firebase Realtime Database 建立多人房間，最多 5 位真人，不足時房主可補電腦。

## 功能

- 單人離線模式：不用建立房間、不用登入，主畫面直接開始
- Firebase Realtime Database 多人同步
- Firebase Authentication 匿名登入
- 建立房間、輸入房號加入、複製邀請連結與 QR Code
- 5 人對戰，真人不足可補電腦
- 電腦難度 1–20 級，叫牌改為「數字＋花色」並採較保守的遞叫策略
- 出牌顯示在各玩家前方；各玩家資訊欄顯示目前吃到的頭數
- 每墩最後一位出牌後保留牌桌 3 秒，再清空進入下一墩
- 本局結算時依玩家陣營顯示勝利／失敗動畫與本局分數變化
- 台式常見設定：底牌頭處理、首攻規則、是否允許無王叫牌、末三輪鬼牌變小、王牌 2/3 召鬼、是否允許獨裁
- GitHub Pages workflow 已附好
- 無需打包工具，直接靜態部署

## 重要限制

這是休閒對戰版。因為網頁本身部署在 GitHub Pages，多人牌局主持端是「房主的瀏覽器」，而非可信任伺服器。一般朋友對戰可以使用；若要正式比賽、防作弊或隱藏所有玩家手牌，建議把牌局裁判邏輯搬到 Cloud Functions、自架伺服器或其他可信任後端。

單人離線模式完全在本機瀏覽器執行，不會建立 Firebase 房間。

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
5. 開啟 GitHub Pages 網址；可直接玩單人離線，或按「連線 Firebase」後建立多人房間。

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
- `app.js`：離線模式、Firebase 多人同步、房間、牌局、AI、計分邏輯
- `database.rules.json`：Realtime Database 基礎規則
- `.github/workflows/pages.yml`：GitHub Pages 自動部署 workflow
- `.nojekyll`：避免 GitHub Pages 使用 Jekyll 處理靜態檔案

## 遊戲流程

### 單人離線

1. 輸入暱稱。
2. 選擇電腦難度。
3. 按「單人離線開始」。
4. 系統自動補滿 4 位電腦並開始叫牌。

### 多人線上

1. 按「連線 Firebase」。
2. 房主建立房間並分享房號、邀請連結或 QR Code。
3. 其他玩家加入；房主可用電腦補滿 5 人。
4. 房主調整規則並開始。
5. 依序叫「數字＋花色」、換底牌、指定秘書、打 10 墩牌。最高叫品的花色即為王牌。
6. 結算後房主可開始下一局。

## 邀請朋友加入

建立房間後，大廳會顯示邀請連結與 QR Code。朋友可以：

1. 按「複製邀請連結」後貼給朋友。
2. 用手機掃描 QR Code 開啟網頁，系統會自動帶入房號並嘗試加入房間。

QR Code 會用公開 QR 圖片服務即時產生；若 QR 圖片沒有出現，仍可使用「複製邀請連結」。

## 近期更新

- 主畫面新增單人離線直接開始。
- 遊戲中收斂非本局資訊，手機上會隱藏頂部大標題，保留牌局操作。
- 每位玩家出的牌改顯示在各自前方。
- 每位玩家資訊欄新增「吃幾頭」。
- 每墩最後一位出牌後停留 3 秒再清桌。
- 電腦叫牌改為較謹慎的估牌與「數字＋花色」遞叫。
- 若啟用「末三輪鬼牌變小」，電腦持有小鬼時會在末三輪前評估先打出，避免小鬼留到最後變弱。
- 本局結算時新增勝利／失敗動畫，並顯示勝方、頭數與你的本局加減分。
- 手機直向時牌桌會自動縮小，手牌橫向滑動排列。


## 叫牌規則更新

- 叫品為「數字＋花色」，例如「10 黑桃」、「11 紅心」。
- 同數字花色大小依照橋牌一般規格：梅花 < 方塊 < 紅心 < 黑桃；若規則允許無王，無王最高。
- 有人叫牌後，必須等其他 4 家連續 Pass，叫牌才結束。
- 最高叫品者成為拿破崙，該叫品花色直接成為王牌；拿破崙拿底牌、蓋牌後再指定秘書。

## 更新紀錄
- 遊戲進行中（叫牌、換底牌、指定秘書、出牌）會隱藏累積分數，避免影響本局判斷；本局結束後才顯示分數。
