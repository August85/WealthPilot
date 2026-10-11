"""Settings (pydantic-settings, env prefix ``WP_``). See ``.env.example``.

Platform fallbacks (applied only when the matching ``WP_*`` variable is unset):

* Database: ``DATABASE_URL`` then ``POSTGRES_URL`` (injected by the Neon integration on Vercel; pooled), and
  ``DATABASE_URL_UNPOOLED`` / ``POSTGRES_URL_NON_POOLING`` for migrations. ``postgres://`` and ``postgresql://``
  URLs are rewritten to ``postgresql+psycopg://``.
* Vercel (``VERCEL=1``): ``WP_ENV`` defaults to ``production`` when ``VERCEL_ENV=production`` and ``staging`` for
  preview deployments; jobs run inline, exports are stored in Postgres and connections are not pooled in-process
  (Neon's PgBouncer pools them). Dev auth is refused on every Vercel production or preview deployment.
* ``CRON_SECRET`` (sent by Vercel Cron as ``Authorization: Bearer …``) guards ``/v1/internal/cron/*``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DATABASE_URL_FALLBACKS = ("DATABASE_URL", "POSTGRES_URL")
MIGRATION_URL_FALLBACKS = ("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING")
DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres@127.0.0.1:55432/wealthpilot"


def normalize_database_url(url: str) -> str:
    """Use the psycopg 3 driver for plain ``postgres://`` / ``postgresql://`` URLs (as Neon and Heroku issue them)."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WP_", env_file=".env", extra="ignore", env_ignore_empty=True)

    env: Literal["development", "test", "staging", "production"] = "development"
    database_url: str = DEFAULT_DATABASE_URL
    # direct (non-PgBouncer) URL for Alembic; falls back to database_url
    migration_database_url: str | None = None
    # in-process connection pool size; 0 = no pool (NullPool), the default on Vercel
    db_pool_size: int = Field(default=5, ge=0)
    log_level: str = "INFO"

    # platform (set from VERCEL / VERCEL_ENV, see module docstring)
    on_vercel: bool = False
    vercel_env: str | None = None

    # auth
    auth_mode: Literal["oidc", "dev"] = "oidc"
    oidc_issuer: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str | None = None
    # comma-separated allowed ``azp`` values (Clerk: the web app origin(s)); checked only when set and present
    oidc_authorized_parties: str = ""
    jwks_cache_seconds: int = 3600
    jwt_leeway_seconds: int = 30

    # signing (download tokens)
    secret_key: str = Field(default="dev-insecure-secret-change-me", min_length=16)
    download_token_ttl_seconds: int = 900

    cors_origins: str = ""
    # optional regex for extra allowed origins, e.g. Vercel preview URLs of the web app
    cors_origin_regex: str | None = None

    # Vercel Cron bearer secret (CRON_SECRET); the cron endpoints answer 401 without it
    cron_secret: str | None = None

    # jobs
    inline_jobs: bool = False
    worker_poll_seconds: float = 2.0
    job_max_attempts: int = 5

    # exports / storage
    storage_backend: Literal["local", "s3", "postgres"] = "local"
    export_dir: str = "var/exports"
    export_ttl_hours: int = 24
    s3_bucket: str | None = None
    s3_prefix: str = "exports/"
    s3_region: str | None = None
    s3_endpoint_url: str | None = None

    # market data
    fx_reference_url: str = "https://api.frankfurter.app"
    fx_reference_cache_hours: int = 24
    fx_reference_timeout_seconds: float = 5.0

    # billing
    revenuecat_webhook_secret: str | None = None

    # notifications
    expo_push_enabled: bool = False
    expo_access_token: str | None = None
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"

    # privacy
    erasure_delay_days: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def authorized_party_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.oidc_authorized_parties.split(",") if o.strip()]

    @property
    def is_vercel_deployment(self) -> bool:
        """A Vercel production or preview deployment (``vercel dev`` reports ``development``)."""
        return self.vercel_env in ("production", "preview")

    @property
    def alembic_url(self) -> str:
        return self.migration_database_url or self.database_url

    @model_validator(mode="before")
    @classmethod
    def _platform_defaults(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        env = os.environ
        if not data.get("database_url"):
            url = next((env[k] for k in DATABASE_URL_FALLBACKS if env.get(k)), None)
            if url:
                data["database_url"] = url
        if not data.get("migration_database_url"):
            url = next((env[k] for k in MIGRATION_URL_FALLBACKS if env.get(k)), None)
            if url:
                data["migration_database_url"] = url
        if not data.get("cron_secret") and env.get("CRON_SECRET"):
            data["cron_secret"] = env["CRON_SECRET"]
        if env.get("VERCEL_ENV"):  # the platform's value always wins: it gates the dev-auth refusal
            data["vercel_env"] = env["VERCEL_ENV"]
        if "on_vercel" not in data and env.get("VERCEL"):
            data["on_vercel"] = env["VERCEL"] not in ("", "0")
        if str(data.get("on_vercel", "")).lower() in ("1", "true", "yes"):
            vercel_env = data.get("vercel_env")
            if "env" not in data:
                if vercel_env == "production":
                    data["env"] = "production"
                elif vercel_env == "preview":
                    data["env"] = "staging"
            data.setdefault("inline_jobs", True)
            data.setdefault("storage_backend", "postgres")
            data.setdefault("db_pool_size", 0)
        return data

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def _normalize_url(cls, v: str | None) -> str | None:
        return normalize_database_url(v) if v else v

    @model_validator(mode="after")
    def _check(self) -> Settings:
        if self.env == "production" and self.auth_mode == "dev":
            raise ValueError("WP_AUTH_MODE=dev is refused when WP_ENV=production")
        if self.is_vercel_deployment and self.auth_mode == "dev":
            raise ValueError("WP_AUTH_MODE=dev is refused on Vercel production and preview deployments")
        if (self.env == "production" or self.is_vercel_deployment) and self.secret_key.startswith("dev-insecure"):
            raise ValueError("WP_SECRET_KEY must be set in production and on Vercel deployments")
        if self.auth_mode == "oidc" and self.env == "production" and not (self.oidc_issuer and self.oidc_jwks_url):
            raise ValueError("WP_OIDC_ISSUER and WP_OIDC_JWKS_URL are required in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
