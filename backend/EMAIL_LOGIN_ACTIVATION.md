# Issue #93 — Email 登入改由 GitHub 部署開關

**這次不新增任何 SMTP 設定。** OrderLead 保留 `MLB_MAIL` 私有 Service Binding，繼續透過現有 `mlb-score-notify` 的 Gmail 寄信功能。

## GitHub 已自動管理（不需在 Dashboard 建三筆 Text 變數）

`backend/wrangler.jsonc` 宣告下列可公開的 Worker runtime `vars`：

- `AUTH_ROUTES_ENABLED = "true"`
- `AUTH_BASIC_LIMITS_READY = "true"`
- `EMAIL_AUTH_ENABLED = "true"`

Email 路由使用前三項旗標。Issue #99 額外以 GitHub Wrangler 管理 **`BACKUP_RECOVERY_ENABLED=true`**，但雲端備份只接受有效、未撤銷 Email Session，無憑證一律 HTTP 401；使用者不按「立即備份」就不會寫任何交易。`AUTH_EDGE_PROTECTED`、`LEGACY_DEVICE_AUTH_ENABLED` 未設定，舊設備登入仍停用。

既有 D1 每 IP／Email 限速、Worker Rate Limiting Binding、HTTPS/Origin 規則繼續執行。沒有自訂 WAF、付費網域、Turnstile 或新 SMTP Worker。

## 唯一剩下的私密設定：PASSWORD_PEPPER

Cloudflare 管理的 *orderlead-api* Worker → Settings → Variables and Secrets → Add → Secret：

- Variable name: `PASSWORD_PEPPER`
- Value: 在自己的終端機執行 `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` 產生的 **32-byte base64url 43-character** 隨機字串。
- 不要把 Secret 值提交 GitHub、貼到聊天或填成一般 Wrangler `vars`。
- **不得共用 MLB 的 SMTP_PASSWORD 當 Pepper**：電子郵件登入與寄信須分開保護。

`wrangler.jsonc` 另外宣告 `secrets.required=["PASSWORD_PEPPER"]`。
若 Cloudflare 尚未配置此 Secret，Workers Builds 正式發佈應 **拒絕部署**，避免把沒有密碼金鑰的登入當成已上線。

若已設定 Secret：確認 Cloudflare Workers Builds 將 GitHub main 新版部署成功；若部署在加入 Secret 前失敗，按 **Retry deployment** 或重新部署 main。現在程式仍需要測試私人收件地址收到驗證信、登入成功與重設密碼。

## 最後真實驗收

1. Cloudflare Workers Builds 最新 main 部署成功，而且 Runtime `PASSWORD_PEPPER` 是 **Secret**。
2. 在 OrderLead PWA 設定 → 雲端帳號輸入自己的 Email、12 字元以上密碼，按寄驗證信。
3. 查看信箱／垃圾郵件；打開驗證連結後，回到 PWA 登入。
4. 同一信箱測試忘記密碼，再登入。若有錯誤，先確認 Cloudflare Worker 實際 log／CPU 限制與 `MLB_MAIL` Binding；**不要重設 MLB SMTP 密碼**。
5. 備份開關已透過 GitHub 設定為 true，但無 Session 時只能得到 HTTP 401，請先實測本人註冊／收信／登入。之後以非敏感少量測試紀錄按「立即備份」，確認 server-side checksum、另一個瀏覽器登入還原成功後，再備份實際交易資料。真正點選前不會自動上傳。

**GitHub CI / D1 Read-only 驗收 ≠ 真實 Email 已投遞。** 本 Issue 不使用 D1 Read Token 做任何寫入，不需要重新套用 SQL 0005。

Cloudflare 官方：
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/workers/configuration/secrets/
