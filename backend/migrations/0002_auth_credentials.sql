-- OrderLead A-2-1: credential schema ONLY.
-- Does not create users, store secrets or enable authentication routes.
-- All requests to /v1/* remain disabled until subsequent stages pass review.
PRAGMA foreign_keys=ON;

-- Recovery keys are CSPRNG-generated 256-bit tokens. This verifier is NOT
-- suitable for passwords or human-entered PINs. Never store plaintext tokens.
CREATE TABLE IF NOT EXISTS account_recovery_verifiers (
  user_id TEXT PRIMARY KEY NOT NULL,
  verifier_sha256 TEXT NOT NULL CHECK (
    length(verifier_sha256)=64 AND verifier_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  algorithm TEXT NOT NULL DEFAULT 'sha256-recovery-v1'
    CHECK (algorithm='sha256-recovery-v1'),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
) STRICT;

-- Each approved device has an individual ECDSA P-256 *public* JWK; no private
-- signing key or recovery secret is stored in D1. Revocation is durable.
-- registered_devices already scopes its IDs to the authenticated user.
CREATE TABLE IF NOT EXISTS authorized_device_keys (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_jwk TEXT NOT NULL CHECK (json_valid(public_jwk)),
  algorithm TEXT NOT NULL DEFAULT 'ECDSA-P256-SHA256'
    CHECK (algorithm='ECDSA-P256-SHA256'),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_verified_at TEXT,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id,device_id)
    REFERENCES registered_devices(user_id,device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_device_key_active_owner
  ON authorized_device_keys(user_id,revoked_at);

-- A server-issued nonce may be consumed exactly once. Later API code must
-- validate origin, target user, device and purpose, verify the signature,
-- enforce short expiry, and atomically change consumed_at from NULL to a
-- timestamp (checking affected-row count) before executing an operation.
-- New, unapproved devices use a dedicated pairing workflow in A-2-3.
CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  device_id TEXT,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('registration','device-login','pair-approval','account-recovery')
  ),
  nonce_sha256 TEXT NOT NULL CHECK (
    length(nonce_sha256)=64 AND nonce_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (expires_at > issued_at),
  FOREIGN KEY (user_id,device_id)
    REFERENCES registered_devices(user_id,device_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_auth_challenge_expiry
  ON auth_challenges(expires_at,consumed_at);
CREATE INDEX IF NOT EXISTS idx_auth_challenge_device
  ON auth_challenges(user_id,device_id,purpose,consumed_at);
