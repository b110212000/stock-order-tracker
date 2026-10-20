#!/usr/bin/env python3
"""Issue #81: test additive Email D1 migration without Cloudflare credentials.

This is a local SQLite regression test, NOT proof of production D1 behavior.
Run from any directory: python3 backend/scripts/check_email_migration.py
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
BASE = [
    "0001_foundation.sql",
    "0002_auth_credentials.sql",
    "0003_first_cloud_backup.sql",
    "0004_auth_sessions_limits.sql",
]
EMAIL = MIGRATIONS / "0005_email_password_auth.sql"

NEW_TABLES = {
    "auth_email_credentials": {
        "user_id", "email_normalized", "email_verified_at", "password_salt",
        "password_hash", "password_algorithm", "password_iterations",
        "password_version", "created_at", "password_changed_at", "disabled_at",
    },
    "auth_email_signup_pending": {
        "pending_id", "email_normalized", "password_salt", "password_hash",
        "password_algorithm", "password_iterations", "verify_token_sha256",
        "created_at", "expires_at", "consumed_at",
    },
    "auth_email_reset_tokens": {
        "token_sha256", "user_id", "created_at", "expires_at", "consumed_at",
    },
    "auth_email_sessions": {
        "token_sha256", "user_id", "password_version", "created_at",
        "expires_at", "revoked_at",
    },
}
NEW_INDEXES = {
    "idx_email_signup_expiry",
    "idx_email_signup_address_expiry",
    "idx_email_reset_owner_expiry",
    "idx_email_sessions_owner_expiry",
}
STAMP = "2026-10-20T00:00:00.000Z"
LATER = "2026-10-20T00:15:00.000Z"


def require(condition: bool, description: str) -> None:
    if not condition:
        raise AssertionError(description)


def validate_additive_sql(sql: str) -> None:
    """Fail CI if migration adds destructive/unsafe statement types."""
    without_comments = re.sub(r"(?m)^\s*--[^\n]*$", "", sql)
    statements = [part.strip() for part in without_comments.split(";") if part.strip()]
    require(len(statements) == 9, "0005 must have exactly one PRAGMA and eight CREATEs")
    for statement in statements:
        if re.fullmatch(r"PRAGMA\s+foreign_keys\s*=\s*ON", statement, re.I):
            continue
        table = re.match(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(", statement, re.I)
        if table and table.group(1) in NEW_TABLES:
            continue
        index = re.match(r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(", statement, re.I)
        if index and index.group(1) in NEW_INDEXES and index.group(2) in NEW_TABLES:
            continue
        raise AssertionError("0005 contains an unexpected statement; review before migration")


def user_tables(db: sqlite3.Connection) -> set[str]:
    return {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}


def snapshot(db: sqlite3.Connection, names: set[str]) -> dict[str, list[tuple]]:
    return {
        name: list(db.execute(f'SELECT * FROM "{name}" ORDER BY rowid'))
        for name in sorted(names)
    }


def must_reject(db: sqlite3.Connection, sql: str, params: tuple, description: str) -> None:
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("Expected SQL constraint rejection: " + description)


def run() -> None:
    require(sqlite3.sqlite_version_info >= (3, 37, 0), "SQLite 3.37+ required for STRICT tables")
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for filename in BASE:
        db.executescript((MIGRATIONS / filename).read_text(encoding="utf-8"))

    # Synthetic legacy data proves 0005 does not overwrite pre-existing owners,
    # registered devices or transaction rows; no private user data is needed.
    owner = "test-existing-owner"
    db.execute(
        "INSERT INTO account_users(id,auth_provider,auth_subject,created_at) VALUES (?,?,?,?)",
        (owner, "legacy", "existing-subject", STAMP),
    )
    db.execute(
        "INSERT INTO registered_devices(user_id,device_id,label,last_seen_at) VALUES (?,?,?,?)",
        (owner, "existing-device", "test device", STAMP),
    )
    db.execute(
        "INSERT INTO review_trade_records(user_id,record_id,payload_json,updated_at) VALUES (?,?,?,?)",
        (owner, "existing-trade", '{"test":true}', STAMP),
    )
    db.commit()

    old_tables = user_tables(db)
    require(len(old_tables) == 11, "Unexpected baseline schema in 0001-0004")
    old_rows = snapshot(db, old_tables)
    old_definitions = {
        (kind, name): ddl for kind, name, ddl in db.execute(
            "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL"
        )
    }

    migration = EMAIL.read_text(encoding="utf-8")
    validate_additive_sql(migration)
    db.executescript(migration)
    require(user_tables(db) == old_tables | set(NEW_TABLES),
            "0005 added/removed unexpected tables")
    for (kind, name), ddl in old_definitions.items():
        current = db.execute(
            "SELECT sql FROM sqlite_master WHERE type=? AND name=?", (kind, name)
        ).fetchone()
        require(current is not None and current[0] == ddl,
                f"0005 changed legacy object: {kind} {name}")
    require(snapshot(db, old_tables) == old_rows, "0005 modified legacy data")
    for table, required in NEW_TABLES.items():
        columns = {r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
        require(columns == required, f"Missing/unexpected 0005 columns: {table}")
    indexes = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    )}
    require(NEW_INDEXES <= indexes, "0005 index missing")
    require(not list(db.execute("PRAGMA foreign_key_check")), "Broken foreign keys")

    # Validate several key safety constraints, then rerun 0005 to prove it
    # preserves newly added credentials and old records on repeat execution.
    db.execute(
        "INSERT INTO auth_email_credentials(user_id,email_normalized,email_verified_at,"
        "password_salt,password_hash,password_iterations,created_at,password_changed_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (owner, "test@example.com", STAMP, "A" * 22, "B" * 43, 600000, STAMP, STAMP),
    )
    db.execute(
        "INSERT INTO auth_email_sessions(token_sha256,user_id,password_version,created_at,expires_at)"
        " VALUES (?,?,?,?,?)",
        ("a" * 64, owner, 1, STAMP, LATER),
    )
    must_reject(
        db,
        "INSERT INTO auth_email_sessions(token_sha256,user_id,password_version,created_at,expires_at)"
        " VALUES (?,?,?,?,?)",
        ("b" * 64, "nonexistent-owner", 1, STAMP, LATER),
        "session foreign key",
    )
    db.execute(
        "INSERT INTO account_users(id,auth_provider,auth_subject,created_at) VALUES (?,?,?,?)",
        ("another-owner", "legacy", "another-subject", STAMP),
    )
    must_reject(
        db,
        "INSERT INTO auth_email_credentials(user_id,email_normalized,email_verified_at,"
        "password_salt,password_hash,password_iterations,created_at,password_changed_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("another-owner", "bad@example.com", STAMP, "A" * 22, "B" * 43, 10, STAMP, STAMP),
        "iterations >= 600000",
    )
    must_reject(
        db,
        "INSERT INTO auth_email_credentials(user_id,email_normalized,email_verified_at,"
        "password_salt,password_hash,password_iterations,created_at,password_changed_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("another-owner", "test@example.com", STAMP, "A" * 22, "B" * 43, 600000, STAMP, STAMP),
        "unique normalized email",
    )
    db.commit()
    before_reapply = snapshot(db, user_tables(db))
    db.executescript(migration)
    require(snapshot(db, user_tables(db)) == before_reapply,
            "Repeating 0005 changed existing credentials or records")
    require(not list(db.execute("PRAGMA foreign_key_check")), "Foreign keys broken on retry")
    print("PASS: 0005 is additive/idempotent on local SQLite, prior records preserved,")
    print("      tables/indexes/checks/FKs checked. Production D1 still requires verification.")


if __name__ == "__main__":
    run()
