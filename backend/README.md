# OrderLead Cloudflare Workers + D1 — A-1 / A-2-1

**Current state: A-1 backend foundation + A-2-1 security schema and cryptographic primitives only. Real authentication and trade synchronization are NOT enabled.** The React PWA stays on GitHub Pages and all existing transactions remain only in its IndexedDB until the later explicit, authenticated import step.

## A-2 identity protocol (NOT activated yet)

Please read [IDENTITY_SECURITY.md](IDENTITY_SECURITY.md) for the full threat model and phased flow.

- `User UUID` and `Device UUID` are public identifiers, not passwords or standalone recovery credentials.
- Recovery uses a separately preserved **256-bit random secret**. The future server will store only an HMAC verifier keyed by a **Cloudflare Worker Secret pepper**. Never put recovery keys or the pepper into GitHub, D1 plaintext, logs, URLs, or screenshots.
- Every device gets an independent P-256 key pair; the browser private key must be non-extractable and saved to IndexedDB. Removing that browser storage may destroy the key and Device ID, so users need the separately preserved recovery secret.
- Future HTTP verification must check active device ownership, signature, timestamp, body digest, and **atomic replay-nonce insertion**, with rate limiting and device revocation before any data access.
- `0002_identity_credentials.sql` creates tables for those checks but does **not** activate routes. All `/v1/*` currently return `503 SYNC_NOT_ENABLED`. The Worker never reads/writes any user's actual trades yet.

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
