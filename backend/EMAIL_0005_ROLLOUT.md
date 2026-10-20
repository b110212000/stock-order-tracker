# Issue #75 / #81 — 正式 D1 0005 安全套用與驗收（不啟用 API）

> **此文件是操作與驗收清單，並非正式 D1 已通過驗收的證明。**
> 只有擁有 Cloudflare orderlead-db 管理權限者，才能執行正式 SQL。
> 此步驟不建立帳號、不寄信、不修改 iPhone IndexedDB，也不開放 /v1/*。

## 0. GitHub CI preflight

- CI 執行 python3 backend/scripts/check_email_migration.py：用暫存 SQLite 套用 0001～0005，建立合成舊帳號、裝置與交易紀錄，確認新增表／索引／外鍵並且重複執行不破壞既有資料。
- 這不是正式 Cloudflare D1 的原子競速、PBKDF2 效能或 SMTP 驗收。CI 通過**不能**自動開啟認證。

## 1. 正式資料庫 preflight（只讀）

在 Cloudflare Dashboard → Workers & Pages → D1 → orderlead-db → Console 操作（介面名稱可能調整）：

1. 確認正在使用**正確帳號與正式 D1**，Worker orderlead-api 的 DB Binding 應指向 orderlead-db；可對照 backend/wrangler.jsonc 的 database_id。
2. 確認該資料庫可用的備份或 Time Travel 還原點，按 Cloudflare 當前介面保留可復原狀態；如果沒有可靠復原方式，先停止。
3. 執行下列唯讀 SQL，必須找到共 11 張 0001～0004 舊表：

~~~sql
SELECT name FROM sqlite_master
WHERE type = 'table' AND name IN (
  'account_users','registered_devices','review_trade_records','review_trade_changes',
  'account_recovery_verifiers','authorized_device_keys','auth_challenges',
  'cloud_backup_snapshots','cloud_backup_entries',
  'auth_device_sessions','auth_request_limits'
) ORDER BY name;
~~~

**不是 11 張就停止**，不可盲目重跑歷史 migration。

~~~sql
PRAGMA foreign_key_check;
~~~

應沒有任何違反外鍵的資料列。再執行以下四個筆數查核並私下保留結果供比對，**不要把實際資料內容貼到 GitHub**：

~~~sql
SELECT COUNT(*) AS total FROM account_users;
SELECT COUNT(*) AS total FROM registered_devices;
SELECT COUNT(*) AS total FROM review_trade_records;
SELECT COUNT(*) AS total FROM cloud_backup_snapshots;
~~~

## 2. 執行 0005（只新增表／索引）

在相同正式 D1 Console，開啟 GitHub main 的完整檔案：

https://github.com/b110212000/stock-order-tracker/blob/main/backend/migrations/0005_email_password_auth.sql

將完整、已通過 CI 的原始 SQL 貼入 Console 並執行一次。請勿執行 DROP TABLE、DELETE、清空資料庫、Reset 或盲目執行 wrangler d1 migrations apply DB --remote，因為歷史 0001～0004 由 Console 手動執行，Wrangler 的 d1_migrations 追蹤紀錄可能不存在。不可把正式 migration 加入 Cloudflare Workers Builds deploy command。

## 3. Postflight（只讀）

~~~sql
SELECT type, name FROM sqlite_master
WHERE name IN (
  'auth_email_credentials','auth_email_signup_pending',
  'auth_email_reset_tokens','auth_email_sessions',
  'idx_email_signup_expiry','idx_email_signup_address_expiry',
  'idx_email_reset_owner_expiry','idx_email_sessions_owner_expiry'
) ORDER BY type, name;
~~~

預期 8 筆：4 個 table、4 個 index。再檢查新表欄位及外鍵：

~~~sql
PRAGMA table_info(auth_email_credentials);
PRAGMA table_info(auth_email_signup_pending);
PRAGMA table_info(auth_email_reset_tokens);
PRAGMA table_info(auth_email_sessions);
PRAGMA foreign_key_check;
~~~

比對欄位要以已通過 CI 的 0005 SQL 定義為準；重新查詢 preflight 四組舊表筆數，確認未變。任一項異常就停止，不要臨時更改正式 D1 結構，也不要在未評估其他新寫入前貿然整庫還原。

## 4. 安全閘門維持關閉

- AUTH_ROUTES_ENABLED、AUTH_EDGE_PROTECTED、EMAIL_AUTH_ENABLED、LEGACY_DEVICE_AUTH_ENABLED **全部保持未設定**。
- /health 預期正常（只證明 SELECT 1），/v1/auth/email/login 與其他 /v1/* 仍應回應 503 SYNC_NOT_ENABLED。測試請求不使用任何密碼或 token。
- PASSWORD_PEPPER 只可由有權限者直接放入 Cloudflare Worker Secret，不能寫入 SQL、GitHub、對話或 log；設定 Secret 本身不能當成可啟用認證的證明。
- MLB_MAIL 繼續連接現有 mlb-score-notify Worker 的私有 named RPC；不可複製 Gmail SMTP Secrets。
- Cloudflare WAF/edge 限速、Worker 600k PBKDF2 CPU、真實 D1 token 原子競速、真實 SMTP 投遞與失敗處理、密碼更改通知、iPhone Safari E2E **尚未驗收**，不得啟用 Email API 或雲端備份。

## 5. Issue #75 驗收回報

在 Issue #75 只紀錄檢查日期、preflight 舊表是否齊全、是否有外鍵錯誤、0005 套用狀態、postflight 四表／四索引／欄位結果、/v1/* 503 結果以及後續安全缺項。不要上傳 Email、Session、Token、交易明細或 Cloudflare Secrets。正式 D1 執行尚未確認前，Issue #75 維持 OPEN。
