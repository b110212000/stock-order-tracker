# OrderLead Cloudflare Workers + D1 — A-1

**Current state: backend foundation only. Real trade synchronization is NOT enabled.** The React PWA stays on GitHub Pages and all existing transactions remain only in its IndexedDB until the later explicit, authenticated import step.

## Local setup

Node.js 22+ required. Run from the repository root:

1. In Cloudflare Dashboard, open **Workers & Pages → D1 SQL Database** (UI names may differ), create a database named `orderlead-db`. Copy the returned **database ID**, *not* an API token.
2. `cd backend`
3. `npm install`
4. `cp wrangler.example.jsonc wrangler.jsonc` (Windows PowerShell: `Copy-Item wrangler.example.jsonc wrangler.jsonc`).
5. Edit `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the real D1 database ID. **Do not commit this file.**
6. `npx wrangler d1 migrations apply DB --local` (builds only a simulated local database).
7. `npx wrangler dev --local` then visit `http://127.0.0.1:8787/health`; success returns `{"service":"orderlead-api","status":"ok"}`.
8. `npx tsc --noEmit` checks backend TypeScript.

## Actual deployment (only after reviewing security and configuration)

- `npx wrangler login` in your own terminal. Never share credentials or paste access tokens into GitHub files or chat.
- `npx wrangler d1 migrations apply DB --remote` creates the empty schema in your Cloudflare account.
- `npx wrangler deploy` deploys the **locked-down** Worker. The only working route is `GET /health`.
- To avoid using a production D1 while testing, use the local mode above. Treat `--remote` as a deliberate, separate step.

**Important:** The frontend is not connected to this Worker in Issue #50. No CORS access is enabled for GitHub Pages yet. `/v1/*` routes always return HTTP 503 `SYNC_NOT_ENABLED`; POST/PUT/PATCH/DELETE cannot read or write personal trades.

## Planned secure sync (subsequent Issues)

- A-2: identity provider, server-side validation and authorization, minimal origin allowlist, CSRF/session decisions.
- A-3: user-initiated first upload **after exporting a full local backup**, verify unique IDs, counts and record hashes; only confirm after server acknowledgment. Never empty or replace IndexedDB.
- A-4: idempotent incremental changes with per-user cursors, revisions, tombstones, optimistic concurrency and deliberate conflict resolution.
- A-5: restore drill, independent backups, PWA/iPhone + desktop acceptance. Then consider frontend migration to Cloudflare (B).

The D1 migration includes `account_users`, `registered_devices`, `review_trade_records`, `review_trade_changes`. All rows are user scoped. User IDs must be derived from **verified authentication**, not client-provided IDs. The first version focuses on the active `reviewTrades` ledger; other IndexedDB stores are not migrated yet.

The browser's original URL and IndexedDB remain unchanged, including any installed iPhone PWA. Database binding IDs and login must be configured in your own account; this repository alone cannot create or deploy your Cloudflare resources.

Official references: https://developers.cloudflare.com/workers/local-development/ and https://developers.cloudflare.com/workers/wrangler/commands/d1/
