# OrderLead A-2 passwordless identity protocol (security design, not live API)

Status: **A-2-1 plus the first, inert A-2-2 client cryptography module**. No authenticated API endpoints, accounts or cloud sync are enabled. GitHub Pages, current IndexedDB and all financial records remain untouched.

Issue #53 first substep is `src/cloud-identity.ts`: `createPendingCloudIdentity()` generates separate CSPRNG user/device UUID v4, a 256-bit backup key and a non-extractable P-256 device signing key. `signCloudDeviceRequest()` signs the server's nonce with the existing canonical request format; it validates timestamp but **does not replace server-side validation, atomic nonce consumption or endpoint authorization**. Neither function is imported by the live PWA. Generation happens only when a later UI explicitly starts registration; **calling this function does not register an account or upload existing data**.

Issue #53 second substep adds an **unexposed server enrollment module** at `backend/src/auth-registration.ts`. It creates a short-lived, unpredictable registration nonce, stores only its SHA-256 digest in the existing `auth_challenges` D1 table, and verifies the new device's ECDSA P-256 signature against the exact signed request bytes before attempting any writes. An atomic `D1.batch()` consumes the challenge and conditionally writes account, device, hashed recovery verifier and **public** signing key in a single transaction. Each insert is gated by a unique consumption marker, preventing a replay from creating a second account with the same challenge. Tests cover expired/consumed challenges, body, key and nonce substitution, and public route lockout.

**Not production enabled:** the existing `backend/src/index.ts` continues returning HTTP 503 for all `/v1/*`, including registration. This is *not yet a working signup endpoint*. Do not activate it without Cloudflare edge/IP throttling, registration abuse mitigation, verified exact-origin restrictions and CORS, an offline recovery-key backup confirmation UI, persistently stored non-extractable CryptoKey, device login/session rules, real D1 atomicity tests, and iPhone validation. There are no new SQL migrations or changes to the deployed database in this substep. Continue to store zero user trades in D1 until the later authenticated sync phase.

## Issue #53 — device login verification core, third substep (not publicly routed)

`backend/src/auth-device-login.ts` adds a second **inert**, nonpublic server module for existing authorized devices. It issues a 120-second unpredictable nonce for exactly one valid, non-revoked `user_id + device_id` pair, saves only its hash and verifies a P-256 signed POST to `/v1/auth/login` over the **exact JSON body**. It rejects expired challenges, nonce tampering, malformed IDs, changes to the signed device and revoked keys. A single `D1.batch` atomically marks the challenge consumed with a unique marker, and conditionally updates both device-key verification and registered-device last-seen timestamps. The SQL rechecks revocation when it consumes the challenge.

The return value identifies **only that one verified operation**. It is not a login token, bearer session, refresh token, authorization to read transactions or an account-recovery bypass. All public `/v1/*` routes remain blocked by `backend/src/index.ts`.

`backend/src/auth-origin.ts` provides a strict Origin allowlist for the exact GitHub Pages origin `https://b110212000.github.io`. Only a development-mode call may additionally allow `http://localhost:5173` and `http://127.0.0.1:5173`. The helper is not imported by live Worker code. **CORS is not authentication**; enabling login requires enforcing these checks server-side alongside abuse prevention, CSRF/session controls and cryptographic validation.

**Before enabling any authentication route**: demonstrate real D1 transaction semantics (unit-test mocks are not a substitute), implement Cloudflare-level rate limiting plus per-account attempts and challenge quotas, design secure expiring/rotating sessions with revocation, persist non-extractable browser keys safely, require offline recovery-key backup confirmation, and validate iPhone PWA storage/recovery. Do not pass verified UUIDs from any unchecked client request straight to downstream queries.

## Issue #53 step 4 — short-lived sessions and backend rate counters (not live)

`backend/migrations/0004_auth_sessions_limits.sql` adds two **schema-only** tables: `auth_device_sessions` with a SHA-256 digest of a 256-bit random bearer token, strict owner+device FK, 15-minute expiry and revocation; and `auth_request_limits` with SHA-256 hashed ingress-IP/account fixed-window buckets. **This migration is not applied to the user's real D1 yet.** All earlier 0001/0002/0003 migrations were applied via Dashboard Console, so do not blindly run Wrangler migrations.

`backend/src/auth-sessions.ts` can mint a short-lived in-memory-only token *after* `verifyDeviceLogin` returns, recheck `authorized_device_keys.revoked_at` before issuing, and authenticate every later request by database digest+expiry+active-device join. The authorized device list is strictly scoped to the account derived from the authenticated token; UUID supplied in a request never grants access. Logout marks the token revoked and cannot be replayed. Never put the token in a URL, cookie, localStorage, error message, analytics or GitHub. The private key must remain non-extractable in IndexedDB.

`backend/src/auth-rate-limits.ts` reserves requests using an atomic SQL upsert keyed by a digest of the Cloudflare ingress IP, optional account UUID, purpose, and five-minute window. It does not store raw IP and fails closed if the ingress IP is missing/malformed. Rate quotas are for registration challenges/completion, login challenges/completion, and authorized device listing. This must be paired with Cloudflare edge WAF/rate-limiting and strict Origin checks; database counters alone are insufficient to resist unauthenticated request floods.

**Security gate stays closed**: `backend/src/index.ts` still returns `503 SYNC_NOT_ENABLED` for every `/v1/*`, these modules are not imported by it, there is no live login, recovery, access to device list or cloud backup, and the current local IndexedDB/version remain untouched. Next: safely wire auth routes, check CORS/Origin, integrate rate protection and real D1 tests, save signing CryptoKey and display/off-device-confirm recovery key, then run iPhone E2E acceptance before allowing financial backups.

## Goals and trust boundaries

- User UUID (random v4) identifies one person's data under the owner's Cloudflare D1. Device UUID (random v4) identifies an installation. **Neither UUID grants access, ever.**
- A recovery secret carries a separate **256-bit CSPRNG-generated** value, represented as `olr1_` + unpadded base64url. It is revealed once to the user, who must save it **outside** Safari/PWA storage (e.g. a trusted password manager). D1 stores only a domain-separated SHA-256 verifier, not plaintext. Never allow a user-chosen password or short PIN into this SHA-256 verifier (passwords require a slow password KDF).
- Each authorized device has an independent ECDSA P-256 keypair. Web Crypto creates the private key as non-extractable; the browser should persist the `CryptoKey` in IndexedDB and send only the public JWK to Workers. The D1 `authorized_device_keys` table supports revocation per device. Loss of browser storage also loses the device's key.
- The server authenticates ownership: it must ignore untrusted `user_id` fields for authorization and always derive the owner from a verified device/recovery credential. An explicit UUID in a request can help identify an account but is never authentication.
- Only authorized server logic may read/write an owner's `review_trade_records`; never return all users' data or allow device A to access user B.

## Future flows (each independently reviewed and tested)

### A-2-2: first enrollment and normal device login

1. Browser generates user UUID and device UUID using `crypto.randomUUID()`; generates 32-byte recovery secret using `crypto.getRandomValues`; generates P-256 signing key using `crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify'])` (export public key separately before storing).
2. Before registration, explain that losing *both* authorized devices and recovery secret may make all cloud data inaccessible. Require explicit confirmation of independently saved recovery secret. The UI must not send plaintext key to analytics, URLs or logs.
3. Perform a proof-of-possession enrollment challenge. The server atomically creates the account, device, public JWK and recovery verifier, treating duplicate UUIDs as conflicts. Do not accept claims to existing UUIDs.
4. Normal device login uses a server-issued unpredictable 32-byte single-use challenge. Sign canonical payload (method, path/query, issued time, nonce, SHA-256 digest of raw body) with P-256 private key. On the server: validate the device is active, user association, operation, time and challenge expiry, verify ECDSA signature and atomically consume the challenge *before* granting a short-lived, device-scoped session.
5. Return session credentials only in a secure response; use HTTPS + Authorization headers, short expiry and strict CORS origin allowlist. Do not put bearer credentials in URLs or persistent localStorage. Re-authenticate using the persisted non-extractable private key when the ephemeral session expires. Apply server-side rate limiting.

### A-2-3: move or add a device with an already authorized device

1. New device creates its own device UUID / P-256 keypair and ephemeral pairing request. QR displays only an expiring, single-use pairing reference, not a long-lived user/recovery secret.
2. Existing authorized device signs an explicit approval tied to the *new device's public key*, account, pairing nonce and expiration. Bind the new public key to the account, without sharing the old private key.
3. Mark pairing used atomically to prevent replay, race, confused-deputy and cross-account grant. Offer list/revoke authorized devices; offline devices must not regain access after revocation.

### A-2-4: recover after Safari/PWA data removal or old phone loss

1. On the new installation, the user supplies their User UUID and **independently saved recovery secret**. Device UUID alone **must never** recover cloud data. A previously authorized device with a safely persisted signing key could approve a new device instead.
2. HTTPS POST only, recovery secret solely in request body; server verifies against hashed verifier. Limit attempts by account and hashed network identifier, cap challenges, apply escalating delays/cooldowns; never expose whether a User UUID exists or log secrets.
3. After successful verification authorize a *new* device public key, optionally revoke lost devices and rotate the recovery secret (store new verifier atomically). A recovered session must be short-lived; never download records before proof of possession completes.
4. If all device signing keys **and** the external recovery secret are lost, device IDs will not help. Do not promise automatic recovery or create an undisclosed admin bypass.

## Request proof format (A-2-1 primitives)

Exactly six newline-delimited fields, UTF-8 encoded:

```text
orderlead-device-proof-v1
POST
/v1/devices/authorize
1760653800000
<43-character, 32-byte nonce, base64url>
<64-character SHA-256 hex digest of the exact request body bytes>
```

Signature is a 64-byte Web Crypto ECDSA P-256 / SHA-256 raw signature encoded as unpadded base64url. Worker must validate key JWK shape and verify the signature, **then** consume the matching D1 challenge using an atomic conditional `UPDATE` checked for exactly one updated row before acting. Cryptographic verification **alone** does not prevent replay. Use a server-fixed allowed operation mapping, avoid redirect/rewrite ambiguity, and bind token/nonce to the authorized account and device.

Recovery verifier: `SHA-256("orderlead-recovery-v1\\n" + lowercase-user-uuid + "\\n" + full-prefixed-recovery-secret)`. This is only appropriate for a genuine CSPRNG 256-bit secret. Database entries must never contain plaintext. Use strict comparisons of fixed-sized digests.

## Database migrations

- `0001_foundation.sql`: existing `account_users`, `registered_devices`, scoped trade records, revision numbers, soft deletion, change cursor.
- `0002_auth_credentials.sql`: per-owner recovery verifier, per-device P-256 public key/revocation, time-limited single-use challenges. No data seeded.
- For later stages: A-2-2 needs server-enforced enrollment and login abuse limits; A-2-3 needs a pending new-device pairing table and binding; A-2-4 needs recovery attempt throttles, rotation and device revocation policies. Schema alone is not functional authentication.

## Security and deployment checklist

- [ ] Review public-key validation, auth operation binding, challenge TTL and atomic reuse prevention before enabling routes.
- [ ] Implement and test account isolation against UUID tampering and stale device access.
- [ ] Add server-side rate limiting, logging redaction, input/body size caps, TLS-only production, explicit origin allowlist, safe session revocation and brute-force protection.
- [ ] Store non-extractable keys in iPhone Safari/PWA IndexedDB; test storage clearing and reauthorization on a real device. CSP and XSS protections still matter because a malicious script can ask a non-extractable key to sign.
- [ ] Before migrating any actual trades, export an external full backup, confirm identity recovery, verify transaction counts and checksums, and preserve original local records after cloud upload.
- [ ] Validate SQL migrations against local D1 and a disposable staging instance. Cloudflare remote migrations need manual credentialed setup and are not run by this Issue.

Sources: Cloudflare [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

**Issue #52 adds only reusable cryptography, schema and documentation. The Worker still denies every `/v1/*` request with HTTP 503; authentication, data uploads and sync remain disabled.**
