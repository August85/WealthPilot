"""Vercel build step (``[tool.vercel.scripts] build`` in pyproject.toml), run after dependencies are installed.

1. Validates the settings for this deployment (fails the build instead of shipping a function that 500s).
2. Checks the API and the calculation engine import from the installed environment.
3. Runs ``alembic upgrade head`` against the direct (unpooled) database URL, under a Postgres advisory lock so
   concurrent builds don't race. Skipped cleanly when no database URL is configured or
   ``WP_SKIP_MIGRATIONS=1``.

Runs the same way locally: ``uv run python scripts/vercel_build.py``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from wealthpilot_api.core.config import Settings

API_DIR = Path(__file__).resolve().parents[1]
URL_VARS = (
    "WP_MIGRATION_DATABASE_URL",
    "WP_DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
)
MIGRATION_LOCK_ID = 0x5750_4D49  # "WPMI"


def log(msg: str) -> None:
    print(f"[wealthpilot build] {msg}", flush=True)


def load_settings() -> Settings:
    from pydantic import ValidationError

    from wealthpilot_api.core.config import Settings

    try:
        return Settings()
    except ValidationError as exc:
        log("invalid configuration for this deployment:")
        for err in exc.errors():
            log(f"  - {err.get('msg')}")
        log("set the environment variables listed in services/api/README.md (Deploying to Vercel) and redeploy")
        raise SystemExit(1) from None


def migrate(url: str) -> None:
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url
    from sqlalchemy.pool import NullPool

    from alembic import command

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    host = make_url(url).host or ""
    if "-pooler" in host:  # session advisory locks are not reliable through PgBouncer transaction pooling
        log("migrating through a pooled URL; set DATABASE_URL_UNPOOLED (Neon sets it) for a direct connection")
        command.upgrade(cfg, "head")
        return
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as lock_conn:
            lock_conn.execute(text("SELECT pg_advisory_lock(:id)"), {"id": MIGRATION_LOCK_ID})
            try:
                command.upgrade(cfg, "head")
            finally:
                lock_conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": MIGRATION_LOCK_ID})
    finally:
        engine.dispose()


def main() -> int:
    os.chdir(API_DIR)
    log(f"VERCEL_ENV={os.environ.get('VERCEL_ENV', '-')} python={sys.version.split()[0]}")
    settings = load_settings()
    log(
        f"env={settings.env} auth={settings.auth_mode} storage={settings.storage_backend} "
        f"inline_jobs={settings.inline_jobs} pool_size={settings.db_pool_size}"
    )

    import wealthpilot_calc  # noqa: F401 - fail the build if the path dependency was not installed

    from wealthpilot_api.main import create_app

    create_app(settings)  # imports every module; the engine is lazy so no connection is made

    if os.environ.get("WP_SKIP_MIGRATIONS", "").lower() in ("1", "true", "yes"):
        log("WP_SKIP_MIGRATIONS is set; not running migrations")
        return 0
    if not any(os.environ.get(k) for k in URL_VARS):
        log("no database URL configured (add Neon Postgres from the Storage tab); skipping migrations")
        return 0
    url = settings.alembic_url
    log(f"running alembic upgrade head on host {_host(url)}")
    migrate(url)
    log("migrations complete")
    return 0


def _host(url: str) -> str:
    from sqlalchemy.engine import make_url

    return make_url(url).host or "?"


if __name__ == "__main__":
    raise SystemExit(main())
