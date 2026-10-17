-- A-3.1 / Issue #64: immutable initial full-backup snapshot schema.
-- This is a SCHEMA-ONLY migration and MUST NOT auto-run on the real D1.
-- Existing 0001/0002 were installed via Dashboard Console, therefore their
-- Wrangler migration history may be absent. Do not reset/truncate data.
--
-- Future writes require VERIFIED DEVICE AUTH, a short-lived authorized
-- session, rate limits, and server-side rehash/count verification. Never
-- authorize by a UUID sent in a JSON request alone.
PRAGMA foreign_keys=ON;

-- Each snapshot belongs to one authenticated account. 'staging' is never a
-- successful backup. Future server code must verify all nine store counts
-- and the server-recomputed canonical SHA-256 before setting 'verified'.
CREATE TABLE IF NOT EXISTS cloud_backup_snapshots (
  user_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version=1),
  app_version TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging','verified','failed')),
  sha256 TEXT NOT NULL CHECK (
    length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  byte_length INTEGER NOT NULL CHECK (byte_length>0 AND byte_length<=26214400),
  record_count INTEGER NOT NULL CHECK (record_count>=0 AND record_count<=100000),
  transaction_count INTEGER NOT NULL CHECK (transaction_count>=0 AND transaction_count<=record_count),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  verified_at TEXT,
  PRIMARY KEY (user_id,backup_id),
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE,
  CHECK (
    (status='verified' AND verified_at IS NOT NULL) OR
    (status<>'verified' AND verified_at IS NULL)
  )
) STRICT;

-- Explicitly store ALL NINE kinds of app data, never just reviewTrades.
-- Keep each record's original ID or symbol for faithful restore.
CREATE TABLE IF NOT EXISTS cloud_backup_entries (
  user_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  store_name TEXT NOT NULL CHECK (
    store_name IN (
      'stocks','analyses','trades','quotes','cashflows',
      'alerts','snapshots','imports','reviewTrades'
    )
  ),
  record_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (user_id,backup_id,store_name,record_key),
  FOREIGN KEY (user_id,backup_id)
    REFERENCES cloud_backup_snapshots(user_id,backup_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cloud_snapshots_owner_state
  ON cloud_backup_snapshots(user_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_entries_owner_store
  ON cloud_backup_entries(user_id,backup_id,store_name);
