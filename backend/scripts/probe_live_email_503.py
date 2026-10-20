#!/usr/bin/env python3
"""Read-only-to-user-data production auth diagnosis, Issue #103.

Intentionally NEVER creates accounts, sends email, or uploads records.
Two probes reserve a standard D1/Worker rate-limit counter, which is the
only server-side mutation. Do not run more than once per 5 minute window.
Only status and a fixed public error classification are printed.
"""
from __future__ import annotations
import json
import urllib.request
import urllib.error
import sys

ROOT = "https://orderlead-api.b110212000.workers.dev"
ORIGIN = "https://b110212000.github.io"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None

def probe(stage: str, endpoint: str, obj: dict, expected_status: int, expected_error: str) -> bool:
    body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        ROOT + endpoint,
        headers={"Origin": ORIGIN, "Content-Type": "application/json",
                 "User-Agent": "OrderLead-NoMail-Registration-503-Probe/1.0"},
        data=body, method="POST"
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=25) as result:
            status, content = result.status, result.read(1024)
    except urllib.error.HTTPError as error:
        status, content = error.code, error.read(1024)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        print(f"FAIL {stage}: network failure type={type(error).__name__}", flush=True)
        return False
    try:
        parsed = json.loads(content)
        public_error = parsed.get("error") if isinstance(parsed, dict) else None
    except (ValueError, UnicodeError):
        public_error = None
    valid = status == expected_status and public_error == expected_error
    print(f"{'PASS' if valid else 'FAIL'} {stage}: HTTP {status}, "
          f"error={public_error if public_error in ('AUTH_FAILED', 'INVALID_INPUT', 'AUTH_UNAVAILABLE', 'TRY_LATER', 'SYNC_NOT_ENABLED') else 'OTHER'}"
          f" (expected HTTP {expected_status}/{expected_error})", flush=True)
    return valid

if __name__ == "__main__":
    # Reaches Worker and D1 request throttle, but missing fields guarantees
    # registration cannot create an account or send any Email.
    first = probe("invalid-registration-no-mail", "/v1/auth/email/register",
                  {}, 400, "INVALID_INPUT")
    # The synthetic .invalid mailbox cannot receive any Email. Login with
    # an unregistered mailbox exercises the *real* PBKDF2 dummy KDF path,
    # but never creates an account, backup, reset token or SMTP operation.
    second = probe("dummy-password-kdf-no-mail", "/v1/auth/email/login",
                   {"email":"orderlead-auth-probe@nonexistent.invalid","password":"abcde"},
                   401, "AUTH_FAILED")
    if not first or not second:
        print("FAIL: live registration readiness is not proven; no private mail/data touched.", flush=True)
        sys.exit(1)
    print("PASS: basic POST request validation and 600k PBKDF2 path work on live Worker.", flush=True)
