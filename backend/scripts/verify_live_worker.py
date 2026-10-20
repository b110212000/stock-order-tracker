#!/usr/bin/env python3
"""Issue #97/#75: safety-only live readiness check for Email Auth.

No credentials, mailboxes, session tokens or financial records are used.
The one unauthenticated /me request consumes an ordinary auth rate-limit
counter, but it does not create accounts, issue mail or touch backup data.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

ROOT = "https://orderlead-api.b110212000.workers.dev"
ORIGIN = "https://b110212000.github.io"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(
    path: str,
    expected_status: int,
    expected_json: dict[str, str] | None,
    *,
    method: str = "GET",
    origin: bool = False,
    preflight: bool = False,
) -> bool:
    headers = {
        "User-Agent": "OrderLead-Auth-Readiness-Safe-Smoke/1.0",
        "Accept": "application/json",
        "Cache-Control": "no-cache",
    }
    if origin:
        headers["Origin"] = ORIGIN
    if preflight:
        headers["Access-Control-Request-Method"] = "POST"
        headers["Access-Control-Request-Headers"] = "content-type"
    req = urllib.request.Request(ROOT + path, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as res:
            status, raw, cors = res.status, res.read(2048), res.headers.get("Access-Control-Allow-Origin")
    except urllib.error.HTTPError as err:
        status, raw, cors = err.code, err.read(2048), err.headers.get("Access-Control-Allow-Origin")
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        print(f"FAIL {method} {path}: network error ({type(err).__name__})", flush=True)
        return False
    try:
        parsed = json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        parsed = None
    body_ok = expected_json is None or (
        isinstance(parsed, dict) and
        all(parsed.get(key) == value for key, value in expected_json.items())
    )
    cors_ok = (cors == ORIGIN if origin else cors is None)
    passed = status == expected_status and body_ok and cors_ok
    print(f"{'PASS' if passed else 'FAIL'} {method} {path}: "
          f"HTTP {status} (expected {expected_status}; "
          f"body_matches={body_ok}; cors_matches={cors_ok})", flush=True)
    return passed


if __name__ == "__main__":
    checks = [
        check("/health", 200, {"service": "orderlead-api", "status": "ok"}),
        # Method check and CORS preflight reach the Email router WITHOUT D1 writes.
        check("/v1/auth/email/login", 405, {"error": "METHOD_NOT_ALLOWED"}, origin=True),
        check("/v1/auth/email/register", 204, None, method="OPTIONS",
              origin=True, preflight=True),
        # This is the only check consuming a (non-financial) auth quota counter.
        # 401 proves Pepper decoding, Rate Binding and D1 counter succeeded.
        check("/v1/auth/email/me", 401, {"error": "AUTH_FAILED"}, origin=True),
        # Restore and old device flows must stay explicitly disabled.
        check("/v1/backups", 503, {"error": "SYNC_NOT_ENABLED"}),
        check("/v1/auth/device/login", 503, {"error": "SYNC_NOT_ENABLED"}),
        check("/v1/backup", 503, {"error": "SYNC_NOT_ENABLED"}),
    ]
    if not all(checks):
        print("FAIL: production Email readiness not proven; do not upload data.", flush=True)
        sys.exit(1)
    print("PASS: Email Auth router is reachable; Pepper/limiter/D1 counter gate is active.")
    print("LIMIT: no signup, SMTP receipt, password PBKDF2, user data or backups tested.")
