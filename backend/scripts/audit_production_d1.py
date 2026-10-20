#!/usr/bin/env python3
"""Issue #85 / parent #75: audit the production OrderLead D1 using read-only API.

No user-supplied SQL, account/database target, or URL. Only fixed SELECT and
read-only PRAGMA statements. Never print raw Cloudflare payloads, identities,
financial records, response headers, or secrets. No migrations are applied.

Run locally: python3 backend/scripts/audit_production_d1.py --self-test
Production GitHub Actions: python3 backend/scripts/audit_production_d1.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_OLD = {
    "account_users", "registered_devices", "review_trade_records",
    "review_trade_changes", "account_recovery_verifiers",
    "authorized_device_keys", "auth_challenges",
    "cloud_backup_snapshots", "cloud_backup_entries",
    "auth_device_sessions", "auth_request_limits",
}
EXPECTED_EMAIL_COLUMNS = {
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
EXPECTED_EMAIL_INDEXES = {
    "idx_email_signup_expiry",
    "idx_email_signup_address_expiry",
    "idx_email_reset_owner_expiry",
    "idx_email_sessions_owner_expiry",
}
EXPECTED_FK = {
    "auth_email_credentials": "account_users",
    "auth_email_reset_tokens": "auth_email_credentials",
    "auth_email_sessions": "auth_email_credentials",
}
INVENTORY_SQL = (
    "SELECT type, name FROM sqlite_master "
    "WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'"
)
FOREIGN_KEY_SQL = "PRAGMA foreign_key_check"
LEGACY_COUNTS = (
    "account_users", "registered_devices",
    "review_trade_records", "cloud_backup_snapshots",
)


def verify_d1_reply(data: object) -> list[dict]:
    """Cloudflare D1 /query returns result: [{success, results, meta}]."""
    if not isinstance(data, dict) or data.get("success") is not True:
        raise ValueError("Cloudflare query not successful")
    result = data.get("result")
    if not isinstance(result, list) or len(result) != 1:
        raise ValueError("Invalid D1 query response envelope")
    first = result[0]
    if not isinstance(first, dict) or first.get("success") is not True:
        raise ValueError("D1 SQL execution failed")
    meta = first.get("meta", {})
    if not isinstance(meta, dict) or meta.get("changed_db") is True or meta.get("rows_written", 0) not in (None, 0):
        raise ValueError("D1 query unexpectedly reported database writes")
    rows = first.get("results")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Invalid D1 query row shape")
    return rows


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class D1Read:
    def __init__(self) -> None:
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        token = os.environ.get("CLOUDFLARE_D1_READ_TOKEN", "")
        if not re.fullmatch(r"[0-9a-fA-F]{32}", account) or not token:
            raise ValueError("GitHub Secrets missing or invalid (account ID/token)")
        wrangler = json.loads((ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))
        bindings = [entry for entry in wrangler["d1_databases"]
                    if entry.get("binding") == "DB" and entry.get("database_name") == "orderlead-db"]
        if len(bindings) != 1:
            raise ValueError("Unexpected D1 binding in Wrangler config")
        database_id = bindings[0].get("database_id", "")
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", database_id):
            raise ValueError("Invalid OrderLead D1 database ID")
        self.url = ("https://api.cloudflare.com/client/v4/accounts/" + account +
                    "/d1/database/" + database_id + "/query")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def query(self, sql: str) -> list[dict]:
        # Never accept arbitrary SQL, and never pass raw SQL from user inputs.
        allowed = {INVENTORY_SQL, FOREIGN_KEY_SQL}
        allowed.update(
            'PRAGMA table_info("' + table + '")'
            for table in EXPECTED_EMAIL_COLUMNS
        )
        allowed.update(
            'PRAGMA foreign_key_list("' + table + '")'
            for table in EXPECTED_FK
        )
        allowed.update(
            'SELECT COUNT(*) AS total FROM "' + table + '"'
            for table in LEGACY_COUNTS
        )
        if sql not in allowed:
            raise ValueError("Non-whitelisted SQL blocked")
        payload = json.dumps({"sql": sql}, separators=(",", ":")).encode()
        request = urllib.request.Request(
            self.url, data=payload, method="POST",
            headers={
                "Authorization": "Bearer " + self.token,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "OrderLead-D1-Readonly-Audit/1.0",
            },
        )
        try:
            with self.opener.open(request, timeout=25) as response:
                if response.status != 200:
                    raise ValueError("Unexpected Cloudflare HTTP response")
                body = response.read(65537)
        except urllib.error.HTTPError as exc:
            # Do not log response body / headers (may contain sensitive data).
            raise ValueError("Cloudflare API denied request (HTTP " + str(exc.code) + ")") from None
        except (TimeoutError, OSError, urllib.error.URLError):
            raise ValueError("Cloudflare API network connection failed") from None
        if len(body) > 65536:
            raise ValueError("D1 API response too large; stopping safely")
        try:
            return verify_d1_reply(json.loads(body))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Invalid D1 API JSON response") from None


def summary(message: str) -> None:
    print(message, flush=True)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fp:
            fp.write("- " + message + "\n")


def inventory_state(rows: list[dict]) -> tuple[str, set[str], set[str]]:
    tables = {r.get("name") for r in rows if r.get("type") == "table" and isinstance(r.get("name"), str)}
    indexes = {r.get("name") for r in rows if r.get("type") == "index" and isinstance(r.get("name"), str)}
    if not EXPECTED_OLD.issubset(tables):
        return "FAIL_OLD", tables, indexes
    present = tables & set(EXPECTED_EMAIL_COLUMNS)
    if not present and not (indexes & EXPECTED_EMAIL_INDEXES):
        return "PENDING", tables, indexes
    if present != set(EXPECTED_EMAIL_COLUMNS) or not EXPECTED_EMAIL_INDEXES.issubset(indexes):
        return "FAIL_PARTIAL", tables, indexes
    return "PRESENT", tables, indexes


def run() -> int:
    api = D1Read()
    state, tables, indexes = inventory_state(api.query(INVENTORY_SQL))
    summary("D1 database: orderlead-db (GitHub Wrangler binding; read-only)")
    if state == "FAIL_OLD":
        summary("FAIL: required 0001–0004 tables missing; do not run 0005 blindly.")
        summary("Old tables found: " + str(len(tables & EXPECTED_OLD)) + "/11")
        return 1
    summary("PASS: all 11 baseline tables exist.")
    for table in LEGACY_COUNTS:
        rows = api.query('SELECT COUNT(*) AS total FROM "' + table + '"')
        if len(rows) != 1 or not isinstance(rows[0].get("total"), int) or rows[0]["total"] < 0:
            raise ValueError("Legacy table COUNT query failed")
    summary("PASS: four baseline tables accept COUNT queries (row counts kept private).")

    # Query does not modify D1, and we never expose returned FK row contents.
    fk_violations = api.query(FOREIGN_KEY_SQL)
    if fk_violations:
        summary("FAIL: D1 foreign_key_check found violations (details hidden).")
        return 1
    summary("PASS: D1 PRAGMA foreign_key_check found no violations.")

    if state == "PENDING":
        summary("PENDING: 0005 Email tables/indexes not installed. This is NOT a migration acceptance.")
        summary("NEXT: first establish D1 recovery point, then authorize 0005 separately.")
        return 0
    if state == "FAIL_PARTIAL":
        summary("FAIL: Email schema is partially installed or indexes missing; stop and investigate.")
        return 1

    for table, required in EXPECTED_EMAIL_COLUMNS.items():
        rows = api.query('PRAGMA table_info("' + table + '")')
        columns = {r.get("name") for r in rows}
        if columns != required:
            summary("FAIL: Email schema column mismatch for " + table)
            return 1
    summary("PASS: 0005 Email four tables and four named indexes present with expected columns.")
    for table, parent in EXPECTED_FK.items():
        rows = api.query('PRAGMA foreign_key_list("' + table + '")')
        if parent not in {r.get("table") for r in rows}:
            summary("FAIL: missing expected FK in " + table)
            return 1
    summary("PASS: expected Email FKs are present.")
    summary("SCHEMA_OK: 0005 exists and passed read-only structure checks; functional E2E still pending.")
    return 0


def self_test() -> None:
    mock = {"success": True, "result": [
        {"success": True, "results": [{"name": "account_users", "type": "table"}],
         "meta": {"changed_db": False, "rows_written": 0}}]}
    assert verify_d1_reply(mock) == [{"name": "account_users", "type": "table"}]
    for invalid in (
        {"success": False, "result": mock["result"]},
        {"success": True, "result": [{"success": False, "results": []}]},
        {"success": True, "result": [
            {"success": True, "results": [], "meta": {"rows_written": 1}}]},
    ):
        try:
            verify_d1_reply(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid D1 result accepted")
    base = [{"name": name, "type": "table"} for name in EXPECTED_OLD]
    assert inventory_state(base)[0] == "PENDING"
    full = base + [{"name": name, "type": "table"} for name in EXPECTED_EMAIL_COLUMNS]
    full += [{"name": name, "type": "index"} for name in EXPECTED_EMAIL_INDEXES]
    assert inventory_state(full)[0] == "PRESENT"
    assert inventory_state(base[:2])[0] == "FAIL_OLD"
    assert inventory_state(full[:-1])[0] == "FAIL_PARTIAL"
    print("PASS: local D1 API response, no-writes and schema-state self-tests", flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    elif len(sys.argv) != 1:
        print("ERROR: unexpected arguments", file=sys.stderr)
        sys.exit(2)
    else:
        try:
            sys.exit(run())
        except (ValueError, KeyError, TypeError) as err:
            # Error messages are authored constants only, never Cloudflare payloads.
            print("FAIL: " + str(err), file=sys.stderr)
            sys.exit(1)
