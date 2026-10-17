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
