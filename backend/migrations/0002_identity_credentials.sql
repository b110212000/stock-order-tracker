-- OrderLead A-2-1: authentication schema only.
-- No API enabling, no migration of IndexedDB data, no real Cloudflare writes.

-- Only a verifier is stored. Derived by HMAC-SHA256(recovery secret,
-- Cloudflare Worker secret pepper) with version/domain separation.
-- Plain-text recovery keys MUST NOT be stored in D1, application logs or URL.
CREATE TABLE IF NOT EXISTS recovery_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  verifier TEXT NOT NULL CHECK (length(verifier)=43),
  verifier_version INTEGER NOT NULL DEFAULT 1 CHECK (verifier_version > 0),
  rotated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
) STRICT;

-- Device UUID alone never grants access; only signed requests with a
-- registered/non-revoked P-256 public key can prove device possession.
CREATE TABLE IF NOT EXISTS device_credentials (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_key_spki TEXT NOT NULL CHECK (length(public_key_spki) BETWEEN 80 AND 256),
  algorithm TEXT NOT NULL DEFAULT 'ECDSA_P256_SHA256'
    CHECK (algorithm='ECDSA_P256_SHA256'),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (user_id,device_id),
  FOREIGN KEY (user_id,device_id)
    REFERENCES registered_devices(user_id,device_id) ON DELETE CASCADE,
  CHECK ((state='active' AND revoked_at IS NULL) OR
         (state='revoked' AND revoked_at IS NOT NULL))
) STRICT;

-- Signed HTTP requests require a unique, one-time nonce per device in D1.
-- Cryptographic signature verification without this insert is replayable!
-- Future API MUST INSERT atomically and reject primary-key collisions;
-- cleanup only after the maximum allowed signature time window has elapsed.
CREATE TABLE IF NOT EXISTS device_request_nonces (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL CHECK (length(nonce)=22),
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at>used_at),
  PRIMARY KEY (user_id,device_id,nonce),
  FOREIGN KEY (user_id,device_id)
    REFERENCES device_credentials(user_id,device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_device_nonces_expiry
  ON device_request_nonces(expires_at);

-- Short-lived pairing requests authorize a NEW device only after an existing
-- signed trusted device approves a one-time challenge.
CREATE TABLE IF NOT EXISTS device_pairing_requests (
  pairing_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  target_public_key_spki TEXT NOT NULL,
  grant_verifier TEXT NOT NULL CHECK (length(grant_verifier)=43),
  approved_by_device_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at),
  consumed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,approved_by_device_id)
    REFERENCES device_credentials(user_id,device_id),
  CHECK (consumed_at IS NULL OR consumed_at>=created_at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_pairing_owner_expiry
  ON device_pairing_requests(user_id,expires_at);

-- Avoid storing raw IP addresses; future layer must use a server-secret HMAC
-- of an approximate client network key when rate-limiting recovery operations.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  throttle_key TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  blocked_until INTEGER NOT NULL DEFAULT 0
) STRICT;
