# OrderLead Cloudflare Workers + D1 — A-1 + A-2-1 (inactive identity design)

**A-2-1 security blueprint:** [AUTH_PROTOCOL.md](AUTH_PROTOCOL.md) documents the chosen UUID + recovery key + separately authorized device keys, implementation stages and recovery limitations. The corresponding SQL migration `0002_auth_credentials.sql` and cryptographic verification functions are inert until subsequent Issues enable authentication routes. Device ID is NOT a credential.

**Current state: backend foundation only. Real trade synchronization is NOT enabled.** The React PWA stays on GitHub Pages and all existing transactions remain only in its IndexedDB until the later explicit, authenticated import step.

## Cloudflare Dashboard-only deployment (Issue #59)

**No Git/Node.js/Wrangler installation on your phone or computer is required.** The `backend/wrangler.jsonc` file is deliberately committed: it contains the non-secret D1 **resource UUID**, but **never** an API token, recovery key, user's records or credentials.

The user already created D1 `orderlead-db` in their own Cloudflare account. The checked-in Wrangler binding is `DB`, matching the Worker code's `env.DB`.

### 1. Connect GitHub to Workers Builds

Cloudflare Dashboard → Workers & Pages → Create application → Workers → Import from Git (the exact navigation labels can change):

| Field | Value |
| --- | --- |
| Repository | `b110212000/stock-order-tracker` |
| Branch | `main` |
| Worker/project name | `orderlead-api` |
| Advanced settings → Path / Root directory | `/backend` |
| Build command | `npm run typecheck` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` |
| API token | Create new token, e.g. `orderlead-deploy`; **do not paste it into GitHub or chat** |
| Build environment variables | None needed |

**Do not use the repo root's `npm run build`**: that builds the React frontend, not this Worker. Cloudflare runs all commands from the configured `/backend` root and installs dependencies from that directory.

### 2. Click Deploy, check the Worker binding

After GitHub main contains `backend/wrangler.jsonc`, click Deploy. The Worker should be named `orderlead-api` and bound to D1 `orderlead-db` as `DB`. Open the deployed `https://<your-subdomain>.workers.dev/health`: expected `{"service":"orderlead-api","status":"ok"}`.

If deployment fails, check that the **Path is /backend** and the Build command uses `npm run typecheck`. If `/health` returns 503, check the `DB` binding, DB UUID and Worker logs. A successful `/health` only verifies basic SQL connectivity (`SELECT 1`); **it does not prove database tables exist or enable account/sync APIs**.

### 3. Create empty D1 schema using only the Dashboard

Workers deployment does **not** run D1 migrations automatically, and Cloudflare's automatically generated Workers Builds API token **does not include D1 Edit permission** by default. Keep `npx wrangler deploy` as the deploy command; do **not** insert remote migrations into it.

For a browser-only first setup, open Cloudflare Dashboard → D1 → `orderlead-db` → Console, then execute the full SQL files in this order:

1. [`migrations/0001_foundation.sql`](migrations/0001_foundation.sql) — tables for users, devices, scoped transaction records and change history.
2. [`migrations/0002_auth_credentials.sql`](migrations/0002_auth_credentials.sql) — hashed recovery verifiers, authorized device public keys, one-time auth challenges.

Copy each file's **complete SQL**, paste into Cloudflare D1 Console and execute, then verify the tables are present. These SQL files create the schema only; no user accounts, keys or real transactions are inserted.

**Migration accounting caveat:** Running raw SQL in the D1 Console does not update Wrangler's `d1_migrations` tracking table. If you later run `wrangler d1 migrations apply --remote`, Wrangler may propose running the prior idempotent `CREATE TABLE IF NOT EXISTS` scripts again. Review the plan first; for future changes, prefer an authenticated Wrangler migration workflow with D1 Edit permission and tracked migration history. Never delete or reset D1 to "fix" migration records.

### Optional: Wrangler CLI if you prefer a local/CI environment later

From `backend/` with Node.js 22+ installed:

```bash
npm install
npx wrangler login
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

The checked-in `wrangler.jsonc` already contains your public DB ID. **Do not overwrite it using `wrangler.example.jsonc`** (that example remains only for creating a brand-new Cloudflare deployment on another account). To apply tracked migrations remotely with a properly authorized token: `npx wrangler d1 migrations apply DB --remote`; do not attempt this in Workers Builds without explicit D1 Edit permission.

**Important:** The frontend is not connected to this Worker. No CORS access is enabled for GitHub Pages yet. All `/v1/*` methods continue to return HTTP 503 `SYNC_NOT_ENABLED`; nobody can upload or download trades. GitHub Pages, browser IndexedDB and all existing financial records are unchanged.

## First complete cloud backup (Issue #64, **not live**)

- The first cloud backup must represent **all nine IndexedDB stores**, not only the active `reviewTrades` ledger. This is different from future A-4 incremental trade synchronization.
- `src/cloud-backup-snapshot.ts` creates deterministic canonical JSON, a whole-snapshot SHA-256 digest and independently checked per-store hashes/counts. It reads via `snapshotLocalData()` from **one readonly IndexedDB transaction**, without modifying data. A 25 MB ceiling and nonempty protection prevent accidental empty or truncated backup acceptance.
- `migrations/0003_first_cloud_backup.sql` adds `cloud_backup_snapshots` (owner-scoped snapshots with `staging` vs `verified` status) and `cloud_backup_entries` (owner+snapshot+store+record key, JSON body and SHA-256). This SQL is **not yet applied** to the real D1; no new Cloudflare interaction is needed until a safe authenticated upload API is ready.
- Issue #66 now includes *unexposed* `src/cloud-backup-chunks.ts` (validated, bounded ≤32-row/256 KB retryable chunks) and `src/cloud-backup-snapshot.ts` manifest plus `backend/src/cloud-backup-d1.ts`. The D1 engine stages the manifest under a per-owner backup UUID, saves rows without overwriting conflicting IDs, reassembles nine stores from D1, independently recalculates whole/per-store SHA-256 and row counts, and atomically transitions to `verified` only on full match. Downloads require `verified` plus another server-side integrity check.
- **No live cloud transfer yet.** New modules are deliberately absent from `backend/src/index.ts` and the App. Issue #53 authentication (secure sessions, Cloudflare edge+account rate limits and device login integration) must pass before opening any authenticated upload/download route; production D1 `0003` is also not applied. Actual D1 semantics and iPhone roundtrip remain unverified. A successful test of the in-memory D1 stub is not evidence of a remote backup.
- D1 rows hold readable JSON; Cloudflare account administrators can access backup content. If end-to-end client encryption is required, that must be a separate design decision before uploading real trades.
- Existing 0001/0002 were applied manually using Dashboard Console; do not run a blind `wrangler d1 migrations apply --remote` expecting those prior files to be in Wrangler's migration tracking.
- Never commit backup bodies, credentials or private financial data to GitHub. Do not clear or replace IndexedDB while uploading. Preserve separate **off-device local exports** until cloud restore is verified.

## Planned secure sync (subsequent Issues)

- A-2: identity provider, server-side validation and authorization, minimal origin allowlist, CSRF/session decisions.
- A-3: user-initiated first upload **after exporting a full local backup**, verify unique IDs, counts and record hashes; only confirm after server acknowledgment. Never empty or replace IndexedDB.
- A-4: idempotent incremental changes with per-user cursors, revisions, tombstones, optimistic concurrency and deliberate conflict resolution.
- A-5: restore drill, independent backups, PWA/iPhone + desktop acceptance. Then consider frontend migration to Cloudflare (B).

The D1 migration includes `account_users`, `registered_devices`, `review_trade_records`, `review_trade_changes`. All rows are user scoped. User IDs must be derived from **verified authentication**, not client-provided IDs. The first version focuses on the active `reviewTrades` ledger; other IndexedDB stores are not migrated yet.

The browser's original URL and IndexedDB remain unchanged, including any installed iPhone PWA. Database binding IDs and login must be configured in your own account; this repository alone cannot create or deploy your Cloudflare resources.

Official references: https://developers.cloudflare.com/workers/local-development/ and https://developers.cloudflare.com/workers/wrangler/commands/d1/


## 同一支 MLB Worker 代寄 OrderLead Email（Issue #76）

OrderLead **不另購網域、不另建 SMTP Worker、不複製 Gmail SMTP 帳密**。正式 Gmail 寄件服務仍是原本 Cloudflare `mlb-score-notify` Worker（其 `SMTP_USER` / `SMTP_PASSWORD` 仍只放在 MLB Worker Secrets）。

- `wrangler.jsonc` 宣告 `MLB_MAIL` Service Binding，指向 `mlb-score-notify` 內部 named `OrderLeadMailService`。
- `src/mlb-mail.ts` 的 `requestAuthEmail(env,kind,email,token,persistedMessageId)` 僅允許已由後端建立的驗證/重設 token：驗證 32 bytes base64url token、Email 格式、重用同一個持久化 Message ID 避免重試時寄多封。連結使用 `https://b110212000.github.io/stock-order-tracker/#/auth/email-verify/<token>` 或 `#/auth/reset-password/<token>`。
- MLB Worker 內部 RPC 限定的收件地址、用途與連結，使用現有 `FeedbackService` DO 分別儲存 HMAC 摘要與寄送配額。**不新增公開寄信 API**，也不修改 MLB 公開意見回饋。
- 仍尚未正式接上使用者 Email 註冊、密碼重設路由：OrderLead 的 `/v1/*`、備份和同步全部維持原本雙安全旗標預設關閉。**沒有送出真實驗證信、沒有註冊或備份成功的事實**。
- 先確認 MLB Workers Builds 有成功發布 named RPC entrypoint，再部署這個 OrderLead binding。兩個 Worker 須在同個 Cloudflare 帳號，不需要在 OrderLead 建立 SMTP Secrets。實際啟用仍需 #75 的 D1 0005、Email 驗證流程、WAF/限速和 iPhone 實測。


## Issue #75 / #81 — Email D1 0005 上線前驗證（目前尚未套用正式 D1）

最新驗收／操作清單請參考 [EMAIL_0005_ROLLOUT.md](EMAIL_0005_ROLLOUT.md)。
CI 會執行 `python3 backend/scripts/check_email_migration.py`，以本地 SQLite
自動驗證完整 0001～0005 schema、舊資料保存、0005 重跑與認證必要約束。
這**不是正式 Cloudflare D1 已套用成功的證明**。

截至此項工作，PR #78 / #80 已有預設關閉的 Email HTTP API；
但正式 D1 0005、WAF、PASSWORD_PEPPER、真實 SMTP 和手機端到端驗收仍待完成。
安全旗標不可提前開啟，所有 /v1/* 仍應回 503，MLB SMTP Service Binding
維持原本共用架構，App v1.21.1 的 IndexedDB 與舊設備私鑰皆不修改。


## Issue #87：正式 Email Secret／WAF／SMTP 上線前驗收（尚未啟用）

最新部署及驗收操作請見 [AUTH_PRODUCTION_GATE_CHECKLIST.md](AUTH_PRODUCTION_GATE_CHECKLIST.md)。
新增 Cloudflare Workers 本地（colo）Rate Limiting Binding `AUTH_REQUEST_LIMITER` 作為
尚未啟用的 Email Auth 流程的快速限速保護；它在 D1 查詢及 PBKDF2 前執行，
失效時必須拒絕請求。原本 D1 IP/Email 原子限額不變。

**重要：workers.dev 不代表已套用自己 Cloudflare Zone 的 WAF 規則**。
`PASSWORD_PEPPER` Cloudflare Secret、實際的網域/WAF 或明確核准的替代防護、
真實 Gmail 私有 RPC 收件測試與 Worker CPU/iPhone E2E 仍待完成；
所有 Auth flags 預設仍關閉（/v1/* 繼續 503），沒有財務資料上雲。
