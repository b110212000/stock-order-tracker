-- OrderLead backend foundation / Phase A-1.
-- DO NOT migrate or upload existing user data at this stage.
-- Authentication, write API, first import and conflict protocol are separate Issues.
PRAGMA foreign_keys=ON;

-- User IDs come from a future server-side authenticated identity flow, NEVER
-- from an unchecked request body. Do not store personal credentials here.
CREATE TABLE IF NOT EXISTS account_users (
  id TEXT PRIMARY KEY NOT NULL,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(auth_provider, auth_subject)
) STRICT;

-- Device identity is always scoped to the authenticated owner.
CREATE TABLE IF NOT EXISTS registered_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  label TEXT,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
) STRICT;

-- Same transaction ID may occur under different owners but never duplicate
-- within one account. Transaction body is opaque until the authenticated
-- sync API validates and serializes its accepted fields.
-- Soft deletion (payload NULL + deleted_at present) prevents older offline
-- devices from resurrecting records. Never hard-delete on regular sync.
CREATE TABLE IF NOT EXISTS review_trade_records (
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, record_id),
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE,
  CHECK (
    (deleted_at IS NULL AND payload_json IS NOT NULL AND json_valid(payload_json)) OR
    (deleted_at IS NOT NULL AND payload_json IS NULL)
  )
) STRICT;

-- Monotonic cursor for eventual incremental per-owner sync. Future writes
-- must transactionally update record + append event, with revision CAS.
CREATE TABLE IF NOT EXISTS review_trade_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  changed_at TEXT NOT NULL,
  FOREIGN KEY (user_id,record_id) REFERENCES review_trade_records(user_id,record_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_review_trades_owner_updated
  ON review_trade_records(user_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_review_changes_owner_cursor
  ON review_trade_changes(user_id,sequence);
