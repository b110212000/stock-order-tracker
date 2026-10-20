# OrderLead #75 / #87 — 正式環境 Secret、限速與真實郵件驗收

> 2026-10-20。本文是操作清單，**不是已完成的 Cloudflare 實測證據**。
> Email API 仍受三重閘門保護，所有四個開關保持未設定，
> 不可因為設定 Secret 或建立 Rate Limiting Binding 就啟用登入。
> 正式 D1 0005 Schema 已經通過唯讀驗收，不要重新執行 Migration。

## 1. 建立獨立 Worker 密碼 Pepper（需 Cloudflare Dashboard 操作）

目標 Worker：**orderlead-api**，不是 MLB 的 `mlb-score-notify`。
Cloudflare Dashboard → Workers & Pages → Overview → orderlead-api
→ Settings → Variables and Secrets → Add → **Secret**。

| 欄位 | 值 |
| --- | --- |
| Type | `Secret`（不是 Text） |
| Variable name | `PASSWORD_PEPPER` |
| Value | 32 **隨機 bytes** 的 base64url（正好 43 個字元，無 `=` padding） |

可在自己的電腦上產生，**請勿將產生結果貼在 GitHub Issue、ChatGPT、README、log**：

~~~bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
~~~

Cloudflare 介面按 **Deploy** 套用 Secret，確認條目類型為 Secret。
不要新增同名 GitHub Actions Secret，也**不要**把它設成 `vars` 寫入 Wrangler。
不要經常更換 Pepper：已建立的密碼雜湊使用 Pepper，不做遷移即更換會導致現有密碼無法驗證。

**驗收限制**：目前沒有 Cloudflare Workers 管理權限，不能從 GitHub / D1 Read Token 讀取
Worker Secret 名稱或存在狀態，更不能驗證 Secret 的內容。須在 Cloudflare 管理介面確認。
此步驟不等於 PBKDF2 600,000 次在真正 Worker CPU 預算內已驗收。

## 2. Rate Limiting 與 WAF 的邊界

- Wrangler `AUTH_REQUEST_LIMITER` 綁定：60 秒、每個 key 24 次（Cloudflare 各 colo 限額），
  使用獨立 namespace `87500087`。**在 Cloudflare 帳號內確認 namespace 沒有被其他
  Rate Limiting binding 共用**，否則需先更換 namespace 再發版。
- 一旦 Email API 日後通過三重開關，正確 Origin/Method 的請求會先呼叫
  Rate Limiting Binding，然後才查 D1 配額／執行昂貴的 PBKDF2／排入寄信。
  缺少 Binding 或它發生錯誤 → 503、嚴格拒絕；額度用盡 → 429。
  Token、Email、原始 IP 不加入 Binding 的 key；key 是按操作種類及來源 IP
  用 Pepper HMAC 的摘要。
- 既有 `auth_request_limits` 的 D1 IP／HMAC Email 5 分鐘原子額度**保留**。
  Cloudflare Worker Binding 為 **按 colo 分散且最終一致** 的額外保護，
  無法取代 Cloudflare Zone WAF，也不是嚴格全域限額。
- **目前正式 API 在 `orderlead-api.b110212000.workers.dev`**。
  一般 Cloudflare WAF 自訂規則附屬於自己管理的 Zone。
  **不可因為任意其他網站 Zone 配了規則，便宣稱 workers.dev 已受保護。**
  若要 WAF 自訂規則、IP 阻擋／Managed Challenge 與 WAF Rate Limiting，
  需先有 Cloudflare 託管且啟用的網域，再以 Worker Custom Domain / Route
  與該 Zone 的正確 hostname/path 規則進行實際驗收。
  若仍使用 workers.dev，需另行確認可接受的替代邊界（Workers 內建 Binding
  + D1 global quota + Turnstile／其他反機器人策略），**不能把未完成的
  `AUTH_EDGE_PROTECTED` 設成 true**。
- 若新增自訂網域，需要同步評估前端 API Base URL、Origin/CORS、
  MLB 郵件驗證連結與 iPhone E2E。不可自行假設已相容。

參考：
https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
https://developers.cloudflare.com/waf/custom-rules/
https://developers.cloudflare.com/workers/configuration/secrets/
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## 3. 真實 Gmail SMTP 驗收（仍待執行；不可假稱收到信）

既有寄件架構不變：OrderLead `MLB_MAIL` Private Service Binding →
同帳號 `mlb-score-notify` Worker 的 `OrderLeadMailService` named RPC
→ MLB Durable Object 限額與去重 → 原本 Gmail SMTP。
**Gmail SMTP_USER、SMTP_PASSWORD 只留在 MLB Worker**。
無公開的任意收件人寄信 API、不增加新的 SMTP Worker。

- 先通過 Secret 格式、WAF／等效防護、真實 Worker PBKDF2 CPU 與 D1 原子性測試。
- 使用本人掌控的測試 Email 作為唯一測試對象；登入/驗證頁面完整落地前不可
  公開開放註冊／忘記密碼路由，更不能用 production 任意收件人觸發寄信。
- 驗證「註冊 pending → 私有 Mail RPC → Gmail SMTP 接受 → 測試信箱實際收到
  驗證信 → Token 30 分鐘有效且一次性 → 產生已驗證 Email 帳號」。
- 驗證「忘記密碼 → Gmail SMTP 接受 → 測試信箱收到重設信 → 15 分鐘一次性
  Token → 新密碼可登入、舊密碼失效、所有既有 Session 失效」。
- 驗證錯誤收件人、SMTP quota、斷線、超時及同一 Message ID 去重；
  **RPC 回傳 accepted 不等於 Gmail 收件人已收到信**。
- 密碼變更通知信目前未完成，需要獨立補上再將 Issue #75 視為完成。
- 測試報告僅回報 PASS/FAIL、無敏感細節；絕不把密碼、Token、驗證連結、
  真正電子郵件地址或任何股票交易資料寫進 CI log。

## 4. 完成門檻

下列未完成前，**全部保持未設定**：
`AUTH_ROUTES_ENABLED`, `AUTH_EDGE_PROTECTED`,
`EMAIL_AUTH_ENABLED`, `LEGACY_DEVICE_AUTH_ENABLED`。

正式 /v1/* 應回 503 SYNC_NOT_ENABLED；前端 v1.21.1 及 iPhone IndexedDB 交易紀錄、
舊設備私鑰、MLB 既有回饋功能不變。

還需在實際 Cloudflare Worker 驗證 PBKDF2 600,000 iterations CPU／實際 D1 競速、
真實 SMTP 交付、密碼更改通知、iPhone Safari PWA E2E；全部驗收後方能分階段開啟登入。
