-- Issue #53, phase 4: short-lived revocable sessions + server-side abuse buckets.
-- SCHEMA ONLY: do not enable /v1 routes merely by applying this migration.
-- Existing 0001/0002/0003 were manually executed in D1 Console; their
-- Wrangler migration bookkeeping may be missing. DO NOT reset the database.
PRAGMA foreign_keys=ON;

-- Store SHA-256 of a 256-bit bearer token, never its plaintext. Sessions are
-- bound to an approved user+device pair. A revoked device cannot use a session.
CREATE TABLE IF NOT EXISTS auth_device_sessions (
  token_sha256 TEXT PRIMARY KEY NOT NULL CHECK (
    length(token_sha256)=64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (expires_at > issued_at),
  FOREIGN KEY (user_id,device_id)
    REFERENCES authorized_device_keys(user_id,device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_owner_device
  ON auth_device_sessions(user_id,device_id,expires_at,revoked_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_device_sessions(expires_at);

-- Per-IP and per-account fixed-window counters (hashed identifiers only).
-- Limits MUST be checked atomically on EVERY request at the API gateway.
-- Window ids are never client-controlled.
CREATE TABLE IF NOT EXISTS auth_request_limits (
  bucket_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(bucket_id)=64 AND bucket_id NOT GLOB '*[^0-9a-f]*'
  ),
  window_started_ms INTEGER NOT NULL CHECK(window_started_ms>=0),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts>0),
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_auth_limits_expiry
  ON auth_request_limits(expires_at);
