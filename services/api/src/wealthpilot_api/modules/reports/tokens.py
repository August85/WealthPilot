"""Signed, short-lived download tokens: ``<expiry-unix>.<hmac-sha256(export_id|expiry)>`` (base64url)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta


def _sig(secret: str, export_id: uuid.UUID, exp: int) -> str:
    mac = hmac.new(secret.encode(), f"export-download|{export_id}|{exp}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def sign_download(
    secret: str, export_id: uuid.UUID, ttl_seconds: int, now: datetime | None = None
) -> tuple[str, datetime]:
    now = now or datetime.now(UTC)
    expires = now + timedelta(seconds=ttl_seconds)
    exp = int(expires.timestamp())
    return f"{exp}.{_sig(secret, export_id, exp)}", datetime.fromtimestamp(exp, UTC)


def verify_download(secret: str, export_id: uuid.UUID, token: str, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    try:
        exp_s, sig = token.split(".", 1)
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < int(now.timestamp()):
        return False
    return hmac.compare_digest(sig, _sig(secret, export_id, exp))
