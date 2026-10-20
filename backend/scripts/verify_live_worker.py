#!/usr/bin/env python3
"""Issue #83 / #75: read-only smoke-check of the deployed production Worker.

This checks public connectivity and fail-closed auth gates ONLY. It cannot
inspect the Cloudflare D1 schema or prove that migration 0005 was applied.
No credentials, tokens, transactions, or SMTP operations are used.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

ROOT = "https://orderlead-api.b110212000.workers.dev"
CHECKS = (
    ("/health", 200, {"service": "orderlead-api", "status": "ok"}),
    ("/v1/auth/email/login", 503, {"error": "SYNC_NOT_ENABLED"}),
    ("/v1/auth/email/register", 503, {"error": "SYNC_NOT_ENABLED"}),
    ("/v1/auth/email/me", 503, {"error": "SYNC_NOT_ENABLED"}),
    ("/v1/auth/device/login", 503, {"error": "SYNC_NOT_ENABLED"}),
    ("/v1/backup", 503, {"error": "SYNC_NOT_ENABLED"}),
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(path: str, expected_status: int, expected_json: dict[str, str]) -> bool:
    req = urllib.request.Request(
        ROOT + path,
        headers={"User-Agent": "OrderLead-Readonly-Production-Smoke/1.0",
                 "Accept": "application/json",
                 "Cache-Control": "no-cache"},
        method="GET",
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as res:
            status = res.status
            body = res.read(2048)
    except urllib.error.HTTPError as err:
        status, body = err.code, err.read(2048)
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        # Do not print request bodies, HTTP headers, secrets or response bodies.
        print(f"FAIL {path}: network error ({type(err).__name__})", flush=True)
        return False
    try:
        parsed = json.loads(body)
    except (UnicodeDecodeError, ValueError):
        parsed = None
    valid = (status == expected_status and isinstance(parsed, dict) and
             all(parsed.get(key) == value for key, value in expected_json.items()))
    print(f"{'PASS' if valid else 'FAIL'} {path}: HTTP {status} "
          f"(expected {expected_status}; response matches={valid})", flush=True)
    return valid


if __name__ == "__main__":
    results = [check(*args) for args in CHECKS]
    if all(results):
        print("PASS: public /health and all probed /v1 routes have the expected status.")
        print("LIMIT: /health runs SELECT 1; D1 schema/migration 0005 NOT verified.")
    else:
        print("FAIL: public Worker state could not be validated. Keep auth disabled.")
        sys.exit(1)
