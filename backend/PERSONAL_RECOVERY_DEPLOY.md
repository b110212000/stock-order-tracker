# OrderLead v1.22.0 — Personal Email recovery deployment

**Goal:** User can create a verified Email/password account, send and receive confirmation or reset emails using the existing MLB Worker, back up all nine IndexedDB stores to D1, then restore verified backup on another phone. No custom domain or WAF required.

## Already built (source code, not production proof)

- Settings → Cloud account: Email register/login/forgot/reset/verify, memory-only bearer token, 15-minute session.
- Login allows explicit full cloud backup (staging, 32-record chunks, server re-read and SHA-256 verification), listing last 10 verified snapshots, preview and merge-by-default restore. Replace requires two user confirmations. Local 9 stores and manual JSON backup are never deleted by signing in or uploading.
- Auth endpoints additionally require Workers Rate Limiting Binding and D1 per-IP/Email quotas. Backup endpoints require a fourth explicit gate: BACKUP_RECOVERY_ENABLED.
- Existing MLB_MAIL private service binding is reused. OrderLead never receives or stores Gmail SMTP username/password.
- Email verification URL uses /#/auth/email-verify/{token} and reset uses /#/auth/reset-password/{token}; the PWA removes the hash before requesting the API.

## Required Cloudflare configuration (cannot be performed with D1 Read token)

1. Worker: **orderlead-api** → Settings → Variables and Secrets → add **Secret** PASSWORD_PEPPER. Generate locally: `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`. Exactly 43 base64url characters. Do not paste the value into ChatGPT, GitHub or screenshots.
2. Verify the latest Worker build from repository main includes Wrangler binding **AUTH_REQUEST_LIMITER** and **MLB_MAIL**. The latter must point to **mlb-score-notify** named **OrderLeadMailService**. MLB Worker must retain its Gmail SMTP_USER and SMTP_PASSWORD secrets. No new public mail endpoint.
3. Email's 3 Text flags are GitHub-managed and now all set to true via Wrangler; **do not re-enter them manually**. Cloudflare's separate private **PASSWORD_PEPPER** Secret is required and has been installed. Test with only a mailbox you control; account registration and real SMTP delivery are NOT yet confirmed.
4. Confirm the real verification message arrives, link creates account, login works, forgot-password message arrives, reset revokes previous login and new password works. Confirm real CPU time is within your Workers plan. Gmail acceptance by RPC is not proof of receipt.
5. Since Issue #99, **BACKUP_RECOVERY_ENABLED=true** is GitHub-managed in Wrangler and activates only when the 3 Email flags remain true. **No login = no backup access**; uploads require a valid signed-in account and explicit button press. After real Email auth, first back up a small safe test dataset on your original phone, verify it appears as a completed snapshot, then download/merge in another test browser and compare counts before your first actual full backup.
6. Keep **AUTH_EDGE_PROTECTED** and **LEGACY_DEVICE_AUTH_ENABLED** unset; they apply to obsolete device-key routes, not personal Email login. **Do not execute migrations again**: production D1 0005 already has SCHEMA_OK.
7. If something fails, unset EMAIL_AUTH_ENABLED and BACKUP_RECOVERY_ENABLED immediately. Never drop D1 tables or clear IndexedDB. Re-export local JSON as fallback.

## Remaining external E2E acceptance

GitHub CI tests can prove build, routing and unit behavior; GitHub D1 Read token can prove tables and indexes. They cannot create Worker secrets, change production vars, perform D1 writes, or open a real mailbox. The production state is NOT accepted until steps 1–5 have actually been performed and verified. Personal use does not remove the need for server-side authentication and data isolation.

## API contract

- POST /v1/auth/email/register {email,password,confirmPassword}; POST /v1/auth/email/verify {token}; POST /v1/auth/email/login {email,password}; POST /v1/auth/email/forgot-password {email}; POST /v1/auth/email/reset-password {token,password,confirmPassword}; POST /v1/auth/email/logout [Authorization: Bearer].
- GET /v1/backups → verified snapshots, owner-scoped.
- POST /v1/backups/start {backupId,manifest}; POST /v1/backups/:id/chunks {rows}; POST /v1/backups/:id/complete {}; GET /v1/backups/:id → verified snapshot only.
- All backup endpoints enforce a real short-lived Email session; UUID supplied in URL does not grant ownership. Default is HTTP 503 SYNC_NOT_ENABLED.

**No data is backed up until user explicitly clicks '立即備份' and sees the verified result.**
