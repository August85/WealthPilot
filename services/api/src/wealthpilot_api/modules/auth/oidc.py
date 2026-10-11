"""OIDC JWT verification via the provider's JWKS (spec §8.1: hosted OIDC; DECISIONS: provider-agnostic).

* Signature is verified with the key whose ``kid`` matches, fetched from ``WP_OIDC_JWKS_URL`` and cached
  (``WP_JWKS_CACHE_SECONDS``). An unknown ``kid`` triggers at most one refresh per minute (key rotation).
* ``iss`` must equal ``WP_OIDC_ISSUER``; ``aud`` is checked only when ``WP_OIDC_AUDIENCE`` is set;
  ``exp``, ``iat`` and ``sub`` are required.
* ``azp`` (authorized party; Clerk puts the requesting origin there) must be one of
  ``WP_OIDC_AUTHORIZED_PARTIES`` when that list is set and the claim is present (Clerk: "if the azp claim doesn't
  exist, you can skip this step", e.g. tokens minted for native apps).
* Only asymmetric algorithms are accepted (never ``none`` or HMAC with a public key).
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWK

from ...core.config import Settings
from ...core.errors import ApiError

ALLOWED_ALGS = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}


@dataclass(frozen=True)
class Principal:
    subject: str
    email: str | None
    iat: int | None
    session_ref: str | None
    claims: dict[str, Any]


def _invalid(detail: str = "The access token is invalid or expired.") -> ApiError:
    return ApiError(401, "INVALID_TOKEN", detail, headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})


class JwksCache:
    def __init__(self, url: str, ttl_seconds: int, http: httpx.Client | None = None) -> None:
        self.url = url
        self.ttl = ttl_seconds
        self.http = http or httpx.Client(timeout=5.0)
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at = 0.0
        self._last_forced = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> None:
        resp = self.http.get(self.url)
        resp.raise_for_status()
        data = json.loads(resp.text)
        keys: dict[str, PyJWK] = {}
        for jwk in data.get("keys", []):
            if jwk.get("use", "sig") != "sig":
                continue
            try:
                key = PyJWK(jwk)
            except jwt.PyJWTError:
                continue
            keys[jwk.get("kid", "")] = key
        self._keys = keys
        self._fetched_at = time.monotonic()

    def get(self, kid: str) -> PyJWK | None:
        with self._lock:
            now = time.monotonic()
            if not self._keys or now - self._fetched_at > self.ttl:
                self._fetch()
            key = self._keys.get(kid)
            if key is None and now - self._last_forced > 60:
                self._last_forced = now
                self._fetch()
                key = self._keys.get(kid)
            return key


class OidcVerifier:
    def __init__(self, settings: Settings, http: httpx.Client | None = None) -> None:
        self.settings = settings
        self.jwks = (
            JwksCache(settings.oidc_jwks_url, settings.jwks_cache_seconds, http) if settings.oidc_jwks_url else None
        )

    def verify(self, token: str) -> Principal:
        s = self.settings
        if self.jwks is None or not s.oidc_issuer:
            raise _invalid("OIDC is not configured on this server.")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise _invalid() from exc
        alg = header.get("alg")
        if alg not in ALLOWED_ALGS:
            raise _invalid()
        try:
            key = self.jwks.get(header.get("kid", ""))
        except (httpx.HTTPError, ValueError) as exc:
            raise ApiError(503, "AUTH_PROVIDER_UNAVAILABLE", "Could not fetch signing keys.") from exc
        if key is None:
            raise _invalid()
        try:
            claims = jwt.decode(
                token,
                key.key,
                algorithms=[alg],
                issuer=s.oidc_issuer,
                audience=s.oidc_audience,
                leeway=s.jwt_leeway_seconds,
                options={"require": ["exp", "iat", "sub"], "verify_aud": bool(s.oidc_audience)},
            )
        except jwt.PyJWTError as exc:
            raise _invalid() from exc
        parties = s.authorized_party_list
        azp = claims.get("azp")
        if parties and azp is not None and (not isinstance(azp, str) or azp.rstrip("/") not in parties):
            raise _invalid()
        iat = claims.get("iat")
        return Principal(
            subject=str(claims["sub"]),
            email=claims.get("email") if isinstance(claims.get("email"), str) else None,
            iat=int(iat) if isinstance(iat, int | float) else None,
            session_ref=str(claims.get("sid") or claims.get("jti") or iat)[:64],
            claims=claims,
        )


def parse_dev_token(token: str) -> Principal | None:
    """``dev:<subject>:<email>`` (only when WP_AUTH_MODE=dev; never in production)."""
    if not token.startswith("dev:"):
        return None
    parts = token.split(":", 2)
    if len(parts) < 2 or not parts[1]:
        raise _invalid("Malformed dev token; expected dev:<subject>:<email>.")
    email = parts[2] if len(parts) == 3 and parts[2] else None
    return Principal(subject=f"dev|{parts[1]}", email=email, iat=None, session_ref="dev", claims={})
