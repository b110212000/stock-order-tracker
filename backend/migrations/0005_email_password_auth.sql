-- OrderLead Issue #73 / parent #53: additive Email + password identity foundation.
-- SCHEMA ONLY. Never auto-expose /v1/* after applying this migration.
-- The existing 0001..0004 were created through Cloudflare D1 Console;
-- DO NOT replay/reset migrations or rewrite existing accounts/financial data.
PRAGMA foreign_keys=ON;

-- Only a VERIFIED email gets a permanent login identity. Internal UUID
-- remains its owner id. A password is salted, slowed and peppered server-side;
-- only verifier bytes and KDF metadata are persisted.
CREATE TABLE IF NOT EXISTS auth_email_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at TEXT NOT NULL,
  password_salt TEXT NOT NULL CHECK(length(password_salt)=22),
  password_hash TEXT NOT NULL CHECK(length(password_hash)=43),
  password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256-pepper-v1'
    CHECK(password_algorithm='pbkdf2-sha256-pepper-v1'),
  password_iterations INTEGER NOT NULL
    CHECK(password_iterations>=600000 AND password_iterations<=2000000),
  password_version INTEGER NOT NULL DEFAULT 1 CHECK(password_version>=1),
  created_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  disabled_at TEXT,
  FOREIGN KEY(user_id) REFERENCES account_users(id) ON DELETE CASCADE
) STRICT;

-- Pending registration DOES NOT reserve the email permanently: avoid an
-- attacker claiming someone's email and blocking its rightful owner.
-- Future signup must send a high-entropy one-time verification token and
-- atomically consume the pending row before inserting account_users and
-- auth_email_credentials in a D1 transaction.
CREATE TABLE IF NOT EXISTS auth_email_signup_pending (
  pending_id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL COLLATE NOCASE,
  password_salt TEXT NOT NULL CHECK(length(password_salt)=22),
  password_hash TEXT NOT NULL CHECK(length(password_hash)=43),
  password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256-pepper-v1'
    CHECK(password_algorithm='pbkdf2-sha256-pepper-v1'),
  password_iterations INTEGER NOT NULL
    CHECK(password_iterations>=600000 AND password_iterations<=2000000),
  verify_token_sha256 TEXT NOT NULL UNIQUE CHECK(
    length(verify_token_sha256)=64 AND
    verify_token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK(expires_at>created_at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_email_signup_expiry
  ON auth_email_signup_pending(expires_at,consumed_at);
CREATE INDEX IF NOT EXISTS idx_email_signup_address_expiry
  ON auth_email_signup_pending(email_normalized,expires_at);

-- Short-lived single-use forgot-password links. D1 only stores the hash of
-- a CSPRNG 32-byte token, never the link/token itself. All logout sessions
-- must be invalidated whenever password_version increments.
CREATE TABLE IF NOT EXISTS auth_email_reset_tokens (
  token_sha256 TEXT PRIMARY KEY NOT NULL CHECK(
    length(token_sha256)=64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK(expires_at>created_at),
  FOREIGN KEY(user_id) REFERENCES auth_email_credentials(user_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_email_reset_owner_expiry
  ON auth_email_reset_tokens(user_id,expires_at,consumed_at);

-- Do NOT reuse auth_device_sessions: its foreign key requires a P-256 device.
-- Password sign-in is possible on a NEW device without a legacy device key.
-- Session auth always JOINs credentials to check disabled_at and
-- password_version, so reset immediately invalidates ALL older sessions.
CREATE TABLE IF NOT EXISTS auth_email_sessions (
  token_sha256 TEXT PRIMARY KEY NOT NULL CHECK(
    length(token_sha256)=64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT NOT NULL,
  password_version INTEGER NOT NULL CHECK(password_version>=1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK(expires_at>created_at),
  FOREIGN KEY(user_id) REFERENCES auth_email_credentials(user_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_email_sessions_owner_expiry
  ON auth_email_sessions(user_id,expires_at,revoked_at);

-- Intentionally: NO DROP, DELETE, UPDATE, or ALTER on existing tables.
-- This migration contains NO real email addresses, secrets or credentials.
