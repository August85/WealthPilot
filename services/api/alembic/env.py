"""Alembic environment.

URL: the ``sqlalchemy.url`` set by tests, else ``WP_MIGRATION_DATABASE_URL``, else the direct (unpooled) URL the
Neon integration injects (``DATABASE_URL_UNPOOLED`` / ``POSTGRES_URL_NON_POOLING``), else the API's database URL
(``WP_DATABASE_URL`` / ``DATABASE_URL`` / ``POSTGRES_URL``). See ``wealthpilot_api.core.config``.
"""

from __future__ import annotations

from sqlalchemy import engine_from_config, pool

from alembic import context
from wealthpilot_api.core.config import Settings
from wealthpilot_api.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or Settings().alembic_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
