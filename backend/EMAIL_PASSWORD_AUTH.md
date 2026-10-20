## Issue #75：Email 認證的 D1 核心（尚未公開）

`backend/src/email-auth-core.ts` 現已實作以下**未接公開路由**的流程：
- `prepareEmailSignup`：先執行 600k 次 PBKDF2、查驗既有 Email，將 salt/verifier 與 30 分鐘一次性 token **雜湊**寫入 `auth_email_signup_pending`；沒有完成 Email token 驗證前不建立可登入的正式帳號。
- `confirmEmailSignup`：在 D1 `batch()` 事務內消耗 token，條件式新增 `account_users`、`auth_email_credentials`；SQL 內防重複 Email，回傳只含伺服器產生的新 userId。
- `loginEmailPassword`：未知帳號也執行等量 PBKDF2；正確密碼且憑證仍啟用後，D1 寫入短效 hashed bearer Session。不能只憑 Email/UUID 登入。
- `authenticateEmailSession`、`logoutEmailSession`：每次 JOIN 驗證帳號未停用、token 未撤銷、15 分鐘 TTL 和最新 password_version；登出只撤銷該 Session。
- `preparePasswordReset`：只對已驗證的 Email 寫入 15 分鐘高熵重設 token 雜湊。
- `confirmPasswordReset`：在 D1 原子 `batch()` 中耗用 token，更新密碼 KDF、版本號 +1、使其他尚未使用的重設連結失效。所有之前取得的 Session 因密碼版本不符，於下一次受保護操作立即無效。

`tests/email-auth-core.test.ts` 有 fake D1 並行／冪等性／重設／過期／資料隔離模擬，**不代表 Cloudflare 真實 D1 的交易競速已驗收**。未部署 `0005` 時不能呼叫上述操作；新 API、Email WAF、同 IP/Email 限速和寄送通知還在 Issue #75 後續階段。生產環境仍要保持 `/v1/*` 預設 503。


## 已決議：直接共用原本的 MLB Cloudflare Worker 寄信（Issue #76）

原先規劃的「在 OrderLead Worker 重新設定一份 Gmail SMTP Secrets」**不採用**。使用者希望 Gmail 寄信與應用程式密碼只保存在已部署的 **`mlb-score-notify` Worker**。

- MLB Worker 內新增 **named RPC entrypoint `OrderLeadMailService`**，並繼續使用原有 `SMTP_USER`、`SMTP_PASSWORD` 及已存在的 `FeedbackService` Durable Object 配額與去重機制。原本 MLB 意見回饋的公開 HTTP 路由不變，仍只能寄給管理者。
- OrderLead `backend/wrangler.jsonc` 的 `MLB_MAIL` Service Binding 指向 `mlb-score-notify` 的這個特定 entrypoint。由 OrderLead **可信後端**的 `requestAuthEmail()` 在驗證/重設 token 成功存入 D1 及通過 WAF/IP/Email 配額後才呼叫它。
- 沒有任何新的公開寄信路由，也沒有在 OrderLead 設定 Gmail Secrets 或公開郵件寄件帳密。Cloudflare 同帳號的 Service Binding 是私有 Worker-to-Worker 呼叫，**不能讓 App/瀏覽器直接呼叫**。
- 寄信限制：用途只有 `verify` / `reset`，Email 必須單一有效地址，連結固定在 OrderLead PWA 的 HTTPS origin，Token 在 URL fragment，資料僅傳到受控內部 entrypoint。原來 MLB Worker 的限流是寄信層的最後保護，OrderLead 前端／後端仍須實作註冊、重設與身份驗證的獨立反濫用機制。
- 這是**跨專案程式準備／配置**，不代表有人註冊成功、收到信或雲端備份成功。OrderLead 與 MLB 必須屬於同一 Cloudflare 帳號；在實際啟用時需先確保 MLB Workers Builds 已發布 named entrypoint，並驗證 Service Binding RPC 可以連上，再做真正的信件投遞測試。

# OrderLead — Email + 自訂密碼驗證架構（Issue #53/#73）

> 決策日期 2026-10-19。**這是新方案的設計和未公開基礎，不代表已可以註冊、登入、寄 Email 或雲端備份。**
> 使用者不需自行管理 UUID、P-256 私鑰或亂數恢復金鑰。舊版已儲存的本機金鑰不得自動刪除。

## 1. 界線與使用流程

- **註冊**：Email + 自訂密碼 + 確認密碼 → 後端用密碼 KDF 衍生 verifier、建立可過期的 `auth_email_signup_pending` → 寄送單次 Email 驗證連結 → 使用者在有效期內驗證 → 原子地建立 `account_users` (伺服器產生 UUID) 與 `auth_email_credentials`。未驗證 Email 不可建立正式可登入身分；不同人不得用未驗證註冊永久佔住別人的 Email。
- **登入**：Email + 密碼 → 強制 HTTPS、精確 Origin 檢查、WAF 與 D1 限速 → 查已驗證且未停用身分 → 用相同耗時的慢速 KDF 驗證 → 建立隨機 256-bit、15 分鐘有效的 server-managed Session，回傳 HTTP-only? **跨 GitHub Pages / Workers 域名時不使用跨站 Cookie**；採 `Authorization: Bearer`，只放記憶體，不放 localStorage、URL 或日誌。後端保存 Session Token digest，於每個受保護 API 驗證。
- **登入失敗**：錯誤密碼、未知 Email、未驗證、帳戶停用，一律回通用失敗訊息；未知帳號也要執行經校準的 dummy KDF 以減少時間側信道，且加入同 IP + 雜湊 Email 頻率限制、Cloudflare WAF/Turnstile 等反機器人保護。
- **忘記密碼**：使用者輸入 Email → 不管存在與否都顯示「如果帳號存在，會寄送重設信」且 HTTP body/時間盡可能一致 → 只有已驗證 Email 的帳號收到含 256-bit token 的連結；D1 只存域隔離的 token SHA-256 → 15 分鐘內完成，使用者設定新的密碼，**原子消耗** token、更新 KDF verifier、`password_version += 1`，全部舊 Session 失效（包含其他裝置）→ 寄送密碼變更通知，建議重新登入。
- **Email 驗證 token**：30 分鐘有效，單次使用；**與重設 token 不可互用**。Token 不以明文入庫、進入日誌、分析、或外部 Referer。建議連結採 frontend URL fragment（例如 `/#/auth/email-verify/<token>`）；前端第一次讀取後立即從歷史紀錄清除 fragment，再透過 POST body 送給 Workers。畫面設 `Referrer-Policy: no-referrer`。實際路由暫未實作。
- **登出與失效**：撤銷目前 session；重設密碼時提升 version，所有之前發行的 sessions 自動失效。每次 server 請求都核對 `auth_email_credentials.password_version`、停用狀態、token hash、過期與撤銷。
- **換手機**：使用同一 Email + 密碼登入，完成 Email 驗證與伺服器 Session 後才能領取自己帳號的雲端資料，禁止只憑 UUID、Email 或本機草稿便認領舊帳號。

## 2. 祕密資料處理

`backend/src/email-password-primitives.ts` 使用 WebCrypto PBKDF2-HMAC-SHA256 **600,000 iterations**，每次註冊／重設隨機 128-bit salt，先使用獨立的 **32-byte Cloudflare Secret `PASSWORD_PEPPER`** 作 HMAC domain separation，才執行 PBKDF2。只有 KDF output、salt、演算法/iterations 存 D1。**不能將 pepper、密碼、重設 token、Email 專屬連結提交到 GitHub、console 或 Worker log**。API 必須在缺少 pepper 的環境下 fail closed。不要用舊的 `recoveryVerifier` 或一般 SHA-256 對人選的密碼做直接雜湊。

Argon2id 為較理想的密碼儲存選擇，但 Cloudflare Workers 內建 WebCrypto 可直接使用 PBKDF2，Argon2id 需獨立評估 Wasm、CPU/Memory 上限與供應鏈安全。600k PBKDF2 也需在真實 Workers 上量測 Free plan CPU 時間後才可啟用。密碼採長度 15～128 Unicode 碼點、NFC normalization、不強制特定特殊字元；後續應再加 breached-password blocklist 與多因素驗證。

Email 使用保守 ASCII mailbox 正規化 `normalizeEmailAddress()`，不執行 Gmail 點號／+tag 消除，並明確拒絕尚未支援的國際化／quoted mailbox，避免意外將別人的帳號合併。

## 3. D1 migration

新增 `backend/migrations/0005_email_password_auth.sql` **只新增**：
- `auth_email_credentials`：已驗證、唯一 Email、password_version、salt、KDF verifier、演算法、迭代、停用時間、內部 user_id FK。
- `auth_email_signup_pending`：有時效的待驗證註冊與 token digest，不與已驗證 Email 搶佔永久帳號名稱。
- `auth_email_reset_tokens`：一次性高熵密碼重設 token digest、到期/消耗日期與 owner FK。
- `auth_email_sessions`：非 P-256 裝置也能登入的短效、可撤銷、密碼版本綁定 Session；不可直接重用需要 authorized_device_keys FK 的舊 `auth_device_sessions`。

目前 **0005 尚未在真實 Cloudflare D1 執行**。原本 0001/0002/0003/0004 曾由使用者在 Console 手動建表，所以 Wrangler migration history 可能不存在。後續只能在確認目前結構並備份後謹慎在 D1 Console 執行新增 0005，不可執行 reset 或盲目重放所有 SQL。

## 4. Email 寄送與防濫用（正式 API 的前置）

- 需要可寄發交易性 Email 的**已驗證寄件網域**。可用 Cloudflare Email Service（寄件網域需託管 Cloudflare DNS）或 Resend。必須先決定寄件地址、驗證 DNS SPF/DKIM/DMARC、配置只具有寄信權限的 Worker secret；本階段**未連接任一寄信供應商**。
- 寄信額度/價格依實際帳號服務方案核對。寄信 API key 只放 Cloudflare secret，不在 GitHub、App 或本機資料庫。
- 每 IP 與每雜湊 Email 限速、冷卻期、可選 Turnstile、Token 重試/失效、過期清除、寄信失敗安全狀態、防 Email 枚舉（尤其註冊與重設）、重複申請原子性須有測試。
- 保護驗證／重設連結的標題與 body：不要包含密碼、股票或交易資料；設定可辨認的服務名稱、短效與「未操作請忽略」說明。
- 只有在真實 D1 原子消耗、Email 送達與 Reset 全 Session 撤銷驗收通過後，才可加入新 API 到雙重旗標的路由。**不可把舊 UUID 設備認證端點當作 Email 新版已完成的證據**。

## 5. 相容與回滾策略

- 原本 **九張 `orderlead-local` IndexedDB**、FIFO、交易、備份/匯入一律不修改；新增 D1 資料表不更新舊 `account_users` 或設備/金鑰資料。
- 使用者可能已在 v1.21.0 建立 `orderlead-cloud-auth` 本機草稿：**一律保留，不因改密碼登入而清除**。未來要關聯舊帳號必須先能證明雙邊身分；只憑 UUID 或 email 字串不能認領遠端資料。
- v1.21.1 先移除舊「產生本機金鑰」操作入口，改成清楚的「Email＋密碼登入開發中」提示；不顯示假的可輸入表單，避免讓使用者輸入一組不會保存的密碼。
- 正式伺服器認證開關 `AUTH_ROUTES_ENABLED` / `AUTH_EDGE_PROTECTED` **繼續不設**，`/v1/*` 包含 backup/transactions 皆維持 `503 SYNC_NOT_ENABLED`。
- 真實 Email+密碼流程全部驗證通過，才可開始 Issue #66 首次完整九表雲端上傳，並且需要實機下載復原測試與筆數/hash 核對。

## 6. 驗收 checklist

- [ ] D1 `0005` 在正式資料庫以使用者授權執行，確認前四份表與資料未受影響
- [ ] 真實 Worker PBKDF2 耗時、限速與錯誤時序測量；反暴力登入及 Email 枚舉測試
- [ ] 端到端註冊、驗證 Email、已驗證登入、未驗證失敗、登出、短效 Session 到期
- [ ] Email 忘記密碼、過期／重放／錯誤用途拒絕、原子密碼更新、其他裝置立即登出
- [ ] 失敗寄信、無 Email 接收、寄信供應商超額情況安全處理
- [ ] iPhone PWA 安全輸入、正確錯誤顯示、窄螢幕 RWD、重新開啟身份與資料保持
- [ ] 任何 API 不可只憑 Email 或 UUID 存取別人的交易；舊 IndexedDB 九表與備份不變

本期只有架構、資料表/加密原語與 UI 過渡，**沒有真的收取/驗證使用者密碼，沒有寄送任何 Email，更沒有上傳財務資料**。
