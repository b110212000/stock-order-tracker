# OrderLead A-2：免帳密身分、安全換機與資料恢復設計

**2026-10-17，A-2-1：設計／Schema／密碼學原語階段。此文件不是已上線功能。**
原本 GitHub Pages、手機 IndexedDB、交易與 PWA 版本 v1.20.0 不變。Cloudflare 真實 D1、Worker 未由這次提交部署。所有 `/v1/*` API 仍由 Worker 返回 `503 SYNC_NOT_ENABLED`。不得把這個版本當作雲端備份。

## 身分與儲存

- **User ID**：client 使用 `crypto.randomUUID()` 建立 UUIDv4 作為資料擁有人識別碼。它不是密碼，輸入或猜出 UUID 也**不能**讀取交易。伺服器永遠須驗證裝置身分並由驗證結果決定資料 owner，禁止信任請求內隨意提供的 `userId`。
- **Device ID**：每個安裝環境建立不同 UUIDv4，只用來顯示、撤銷及定位裝置。重新安裝或清除 Safari/PWA 網站資料可能連同 Device ID 一起消失；更不能以 Device ID 單獨復原交易。
- **裝置私鑰**：browser WebCrypto `ECDSA P-256`、`extractable: false` 的私鑰儲存在該來源的 IndexedDB 中（CryptoKey 可由 IndexedDB structured clone 持久化的裝置才能啟用）。公鑰以 SPKI 註冊到 D1。若金鑰不能安全保存，應拒絕啟用同步而非降級為明文 bearer UUID。
- **裝置請求**：HTTPS + 已授權公鑰簽署 `orderlead-device-proof-v1\nuserId\ndeviceId\nMETHOD\npath?query\nunixSeconds\nnonce\nSHA256(body)`。後端驗證 P-256 署名、最大 ±120 秒時差、請求正文 hash、裝置未撤銷，並在 D1 原子插入唯一 `(user_id,device_id,nonce)` 防重放。**簽名正確不代表已授權**，未查驗 D1 的 revoked 狀態和 nonce uniqueness 不得使用。
- **恢復金鑰**：安全亂數 32 bytes（256 bits），用 base64url 43 字元表示。使用者在第一次啟用時需要**另存至密碼管理器或離線媒體**。前端不把明文送去 GitHub、網址或 log；日後必須經 HTTPS 受保護的復原程序。後端只存 `HMAC-SHA256(serverPeppper, 'orderlead/recovery/v1/'+key)` 的 43 字元 verifier，pepper 使用 Cloudflare Worker Secret，**不能提交到 GitHub 或 D1**；高熵隨機秘密不需要短密碼式規則。
- **資料隔離**：D1 主交易資料 `user_id` 與 `record_id` 複合主鍵；驗證後從 server session／裝置紀錄導出 `user_id`，而不是只看 query/body 的 UUID。
- **授權前提**：Workers 綁定 D1、部署者設定 secret、HTTPS、精確 Origin allowlist（GitHub Pages 實際 origin），並加上 Cloudflare Rate Limiting / WAF 與 D1 節流計數。Origin 不是身分驗證替代品，任何後端 write 都要逐次驗證。

## A-2-2：首次註冊與已授權設備（下一個獨立 Issue）

1. 使用者明確點選「啟用雲端備份」；本機安全生成 User UUID、Device UUID、裝置簽章金鑰及 256-bit 恢復金鑰。先提示備份恢復金鑰並確認。
2. 提交**不含交易資料**的註冊請求，要求伺服器挑戰／裝置簽名證明對應私鑰存在。服務端確認資料格式、密鑰所有權及節流後，原子建立 `account_users`、`registered_devices`、`recovery_credentials`、`device_credentials`。
3. 顯示已授權裝置列表，登入裝置可撤銷已遺失設備公鑰。撤銷後該裝置所有已簽章請求也不得再有權讀寫。
4. 各授權請求的 server nonce 記錄必須原子寫入成功才算接受，避免重放、跨帳號任意存取、並測試超時與錯誤處理。未獲授權不得建立/讀取用戶資料。

## A-2-3：更換手機／資料遺失復原（獨立 Issue）

**舊手機還在（優先）**
1. 在舊裝置已授權頁面選「新增設備」，產生時效約 3～5 分鐘的一次性配對 QR。
2. 新裝置產生**新** Device UUID 與非匯出的 P-256 私鑰，掃 QR 後送出對應公鑰與短時挑戰。
3. 舊裝置顯示明確的裝置確認畫面，讓使用者授權。伺服器驗證舊裝置簽名／一次性挑戰／TTL，核准新設備。
4. 新裝置**自行持有新私鑰**，以自己簽名請求取回同一 User UUID 對應資料，舊設備金鑰不複製不轉移。

**舊手機不見或 Safari 資料被刪**
1. 新裝置只能透過**獨立保存**的 User UUID + 256-bit 恢復金鑰授權新的 Device UUID／公鑰（不得以 User ID 或 Device ID 取代）。
2. 驗證採有節流的 HTTPS POST；伺服器驗證帶 pepper 的恢復驗證值與新設備簽名，回應不得區分 UUID 存在與否以免枚舉。
3. **必須輪替恢復金鑰**：新金鑰在新裝置顯示並經明確保存確認後，與新設備授權原子更新；舊恢復金鑰失效。任何失敗不可令使用者落入新舊金鑰都無效的鎖死狀態。
4. 撤銷遺失設備可由已授權的新設備進行。若沒有任何已授權設備，也遺失恢復金鑰，**無法恢復雲端資料**；Device ID 無法補救。仍可從當初手動匯出的完整本機備份還原。

**刪除與安全**
- 換機不刪除舊交易、不得默默合併他人的 UUID。
- 同步刪除採墓碑與版本，並留有獨立快照；「雲端同步成功」不代表遭惡意刪改或勒索後一定可復原。
- API 記錄不儲存個資、金鑰、交易明文；恢復及轉移時向使用者清楚顯示意圖。

## A-3 / A-4 / A-5 與 B

- **A-3 首次轉移**：先在目前 iPhone PWA 匯出完整備份，明確授權上傳；比對 D1 與 IndexedDB 交易 ID、筆數、哈希、FIFO 計算；不清除本地原始資料。
- **A-4 雙向同步**：已驗證裝置使用變更游標、CAS 修訂號、去重、離線佇列與可復原的刪除墓碑；拒絕不合理的全量覆寫。
- **A-5 安全驗收**：iPhone Safari、獨立 PWA、Windows 同步與重裝後復原演練，並建立雲端資料庫獨立備份與錯誤告警。
- **B 前端遷移**：只有 A 完成後，才將前端從 GitHub Pages 轉到 Cloudflare；仍沿用相同 UUID／已驗證的 Workers、D1，不能依新網域直接讀取舊 IndexedDB。

## 對應資料表

- `0001_foundation.sql`：account_users、registered_devices、review_trade_records、review_trade_changes（保留原本 migration）。
- `0002_identity_credentials.sql`：recovery_credentials（HMAC verifier + 輪替）、device_credentials（公鑰 + 撤銷）、device_request_nonces（防重放）、device_pairing_requests（限時單次授權）、auth_rate_limits（節流）。
- A-2-1 只有結構及驗證 primitive，**沒有**啟用任何一條驗證／同步路由。A-2-2/3 必須先具備實際 D1 transactional checks、金鑰輪替、節流及安全測試才能公開。

參考 Cloudflare 官方文件：<https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>、<https://developers.cloudflare.com/d1/reference/migrations/>、<https://developers.cloudflare.com/d1/sql-api/foreign-keys/>。
