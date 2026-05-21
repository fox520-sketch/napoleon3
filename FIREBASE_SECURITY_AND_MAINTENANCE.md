# Firebase 安全規則與房間維護說明

此版本為 **AI V31｜安全規則・房間清理・維護工具**。

## 1. Realtime Database 規則

專案內提供兩份規則：

- `database.rules.json`：建議直接貼到 Firebase Console 的 Rules，兼顧目前遊戲功能與基本資料格式檢查。
- `database.rules.secure.example.json`：公開版參考規則，額外限制房號格式與房號欄位一致性。若你之後改房號格式，請同步調整這份規則。

Firebase Console 路徑：

```text
Firebase Console → Build → Realtime Database → Rules
```

貼上後按 **Publish**。

## 2. 房間清理策略

遊戲房間現在會寫入：

```text
meta.createdAt
meta.updatedAt
meta.expiresAt
meta.schemaVersion
meta.appBuild
```

預設每個線上房間建議保留 24 小時。超過時間後，遊戲不會強制刪除房間，但會在房間狀態卡與系統測試工具中提示房主：

- 關閉房間
- 或延長 24 小時

## 3. 房主工具

房主在大廳與遊戲中都可以：

- 接管離線玩家，改由電腦代打
- 延長房間 24 小時
- 複製房間維護摘要
- 關閉房間並移除 Firebase 房間資料

## 4. 公開版建議

公開給朋友玩之前，建議確認：

- Anonymous Authentication 已啟用
- Realtime Database Rules 已發布
- Authorized domains 已加入 GitHub Pages 網域
- 跑一次「系統測試工具」
- 跑一次「AI 健康檢查」
- 手機重新載入，確認版本顯示為 AI V31

## 5. 進一步自動清理

目前清理是由房主操作。若日後房間量變多，建議改用 Firebase Cloud Functions 或排程工作，自動刪除 `meta.expiresAt` 已過期的房間。
