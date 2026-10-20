# OrderLead：個人使用的 Email 找回資料流程（Issue #89）

> 2026-10-20 使用者最新決策：**只想在換手機、手機遺失或刪 App 時找回交易紀錄**，不需要購買網域、自訂 Cloudflare Zone WAF、Turnstile 或大型帳號系統。
> 這個決策取代 Issue #75 舊版文件中「必須有 Zone WAF 才能啟用 Email」的規定；**不取代**伺服器身分驗證、基本限速、Cloudflare Secret 和驗證備份完整性。

## 使用者最終操作

1. 在舊手機按「啟用雲端備份」，用 Email＋自訂密碼註冊，從信箱點擊驗證。
2. 透過「立即備份」把 **全部 9 個** IndexedDB store 的交易／設定完整上傳，伺服器用 checksum/筆數校驗成功才顯示「已安全備份」及時間。上傳時**不清空本機資料**。
3. 在新手機安裝同一 PWA，以同一 Email/密碼登入，選擇已確認的雲端備份。
4. 先檢查雲端備份來源、筆數、時間與 SHA-256，提供「合併／取代」選項與明確提醒。只有使用者選擇才開始還原；**預設不覆蓋本機交易**。
5. 忘記密碼時，Email 收一次性重設連結；只有已成功備份的交易才可找回。

**注意：沒有在資料消失前成功上傳雲端備份，單憑 Email 無法重建當時只存在 IndexedDB 的紀錄。**

## 最小後端安全範圍（無須購買網域）

- 保持原本 `orderlead-api.b110212000.workers.dev`。
- Gmail 郵件由同一 Cloudflare `mlb-score-notify` Worker 的私有 `MLB_MAIL` Service Binding 寄送；不要複製 SMTP secrets 或建立公開 send-mail API。
- `orderlead-api` 的 Cloudflare **Secret** `PASSWORD_PEPPER` 是 Email 密碼登入必要條件：32 bytes base64url。不能寫入 GitHub Secrets、前端、Issue、聊天或日誌。產生方式及 Cloudflare 介面步驟參見 [AUTH_PRODUCTION_GATE_CHECKLIST.md](AUTH_PRODUCTION_GATE_CHECKLIST.md) 第 1 節。
- 既有 Worker `AUTH_REQUEST_LIMITER` (60 秒) **必須在正式 Worker 配置成功**，認證 API 執行前會使用它，缺少就 fail closed；已有 D1 per-IP + HMAC Email 的原子配額照樣保留。
- Email Auth 三個**手動啟用且預設未設定**的旗標改成：
  `AUTH_ROUTES_ENABLED` + `AUTH_BASIC_LIMITS_READY` + `EMAIL_AUTH_ENABLED`。
  必須確認 Worker limiter、D1、Secret、私有 SMTP 功能測試成功後，才可以逐一設定；**本 PR 不設定任何旗標**。
- `AUTH_EDGE_PROTECTED` 僅保留在舊 UUID 裝置認證路由（還需 `LEGACY_DEVICE_AUTH_ENABLED`）；即便日後開啟 Email，也不可順便開啟舊路由。
- 維持 HTTPS、固定 GitHub Pages Origin、有限 JSON 長度、短效撤銷 Session、Email 驗證／密碼重設 Token 一次性、D1 Owner 過濾、伺服器 checksum 驗證。這些是避免私人交易紀錄被讀走的最低限度。

## 先做什麼

| 里程碑 | 最小驗收 |
| --- | --- |
| A：Email 本人登入 | Cloudflare Pepper Secret 已設定（僅 Worker）；PBKDF2 實際 Workers CPU 運作正常；測試信箱收到驗證信與重設密碼信，登入／過期／退出有效 |
| B：第一次雲端備份 | 登入後使用者按「立即備份」；九個 store 全部驗證、記錄 verified 時間及 checksum；不同 owner 無法讀寫 |
| C：新手機取回 | 登入另一裝置、先預覽並確認筆數／時間與雲端校驗、可合併或取代而無意外清空 |
| D：驗收完成 | iPhone Safari / PWA 實機斷網、重新開啟、備份和還原試跑通過，保留獨立的本機 JSON 匯出 |

## 此次 GitHub 程式變動界線

Issue #89 只改 Email 的選用安全旗標名稱／驗證，**沒有新增公開寄信或備份 API，也沒有上傳任何真實資料**。
正式 D1 0005 已通過唯讀結構查核，不重新套 SQL。前端仍 v1.21.1，登入／雲端備份 UI 尚未開通。
