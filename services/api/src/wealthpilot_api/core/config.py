"""Settings (pydantic-settings, env prefix ``WP_``). See ``.env.example``."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WP_", env_file=".env", extra="ignore", env_ignore_empty=True)

    env: Literal["development", "test", "staging", "production"] = "development"
    database_url: str = "postgresql+psycopg://postgres@127.0.0.1:55432/wealthpilot"
    log_level: str = "INFO"

    # auth
    auth_mode: Literal["oidc", "dev"] = "oidc"
    oidc_issuer: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str | None = None
    jwks_cache_seconds: int = 3600
    jwt_leeway_seconds: int = 30

    # signing (download tokens)
    secret_key: str = Field(default="dev-insecure-secret-change-me", min_length=16)
    download_token_ttl_seconds: int = 900

    cors_origins: str = ""

    # jobs
    inline_jobs: bool = False
    worker_poll_seconds: float = 2.0
    job_max_attempts: int = 5

    # exports / storage
    storage_backend: Literal["local", "s3"] = "local"
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

    @model_validator(mode="after")
    def _check(self) -> Settings:
        if self.env == "production" and self.auth_mode == "dev":
            raise ValueError("WP_AUTH_MODE=dev is refused when WP_ENV=production")
        if self.env == "production" and self.secret_key.startswith("dev-insecure"):
            raise ValueError("WP_SECRET_KEY must be set in production")
        if self.auth_mode == "oidc" and self.env == "production" and not (self.oidc_issuer and self.oidc_jwks_url):
            raise ValueError("WP_OIDC_ISSUER and WP_OIDC_JWKS_URL are required in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
