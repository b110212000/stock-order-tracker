# Issue #85 / Parent #75 — GitHub Actions 正式 D1 唯讀檢查

已在 GitHub Repository → Settings → Secrets and variables → Actions 設定：
- `CLOUDFLARE_D1_READ_TOKEN`：Cloudflare Account → D1 → Read 的 API Token。**只放 GitHub Secret，絕不提交到倉庫。**
- `CLOUDFLARE_ACCOUNT_ID`：正確 Cloudflare Account ID（作為 GitHub Secret 儲存）。
  
正式 Database ID 由 [wrangler.jsonc](wrangler.jsonc) 的 `DB / orderlead-db` binding 取得；沒有接受使用者輸入的 Database、URL 或 SQL。

## 為什麼只在 main 執行

- Pull Request 的一般 `ci.yml` 僅執行 `python3 backend/scripts/audit_production_d1.py --self-test`，**完全不注入 Secrets 或連 Cloudflare**。
- `production-d1-read-audit.yml` 只會在包含此 workflow 或驗證程式變更的 **push main**，或在 GitHub Actions 介面上手動 `Run workflow` 時執行。沒有 pull_request 觸發器。
- GitHub Actions job 僅有 `contents: read` 權限，不修改 Repo/Cloudflare 設定。需保護 main 的寫入／PR 合併權限，因為能修改 main 工作流程者也可能改變存取 Secrets 的程式。
- 後續手動執行：GitHub Actions → **Production D1 - Readonly Schema Audit** → **Run workflow** (branch = main)。

## 真實查核項目

Cloudflare 官方 REST API `POST /accounts/{account_id}/d1/database/{database_id}/query`；
JSON body 使用程式內建且固定的 `SELECT` / 唯讀 `PRAGMA`。
使用 Cloudflare D1 Read Token，不需 Edit 權限也**不能套用 0005**。

1. 基礎 `0001`～`0004` 必要 **11 張表**。
2. 固定四張舊表可執行 COUNT：不寫入、不公開筆數（沒有前後基準時不宣稱交易數量無變）。
3. `PRAGMA foreign_key_check` 無違規列。異常內容不會寫進 GitHub log。
4. 如果 Email 0005 四張表與四個索引**全部不存在**，回報 `PENDING` 並結束；這表示前置查核完成，不是上線驗收成功。
5. 若發現部分新表/索引則 **FAIL**，必須調查。
6. 若四表四索引都存在，再查預期欄位與主要外鍵，完全符合才回報 `SCHEMA_OK`，仍不代表 Email 註冊／密碼重設及 SMTP E2E 通過。

Log／Actions Summary **不包含** Email、密碼、Token、完整 API 回應、實際交易紀錄、計數或外鍵違規資料；錯誤時 fail closed。

## 異常時

- `GitHub Secrets missing or invalid`：核對兩個 Repo Secrets **名稱與 Account ID 格式**。
- `Cloudflare API denied request (HTTP 401/403)`：核對該 Token 是否還有效、D1 Read 權限、Account scope/Database ID。
- `FAIL_OLD` / `FAIL_PARTIAL`：不要直接補跑所有 migrations 或執行 DROP，先確認原本 D1 上有哪些表。
- `PENDING`：表示 0005 還未套用。應依 [EMAIL_0005_ROLLOUT.md](EMAIL_0005_ROLLOUT.md) 查核可恢復點後，再經額外授權手動執行。
- `SCHEMA_OK`：僅結構層符合預期，Issue #75 仍需 WAF、Pepper、SMTP、Worker CPU、真實 D1 並行測試及 iPhone E2E。

**不可因查核自動開啟 `AUTH_ROUTES_ENABLED`、`AUTH_EDGE_PROTECTED`、`EMAIL_AUTH_ENABLED` 或 `LEGACY_DEVICE_AUTH_ENABLED`。**
