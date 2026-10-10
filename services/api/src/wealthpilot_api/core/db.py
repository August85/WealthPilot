"""SQLAlchemy 2 (sync, psycopg 3) engine, session factory and declarative base."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, MetaData, Numeric, create_engine, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from starlette.requests import Request

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

MONEY = Numeric(24, 8)
"""Monetary and share quantities (spec §7)."""
RATE = Numeric(30, 12)
"""FX rates need more fractional digits than money (1/85 = 0.0117647…)."""


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)
    type_annotation_map = {
        dict[str, Any]: JSONB,
        list[Any]: JSONB,
        Decimal: MONEY,
        uuid.UUID: UUID(as_uuid=True),
        datetime: DateTime(timezone=True),
    }


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Database:
    def __init__(self, url: str, echo: bool = False) -> None:
        self.engine: Engine = create_engine(url, echo=echo, pool_pre_ping=True, future=True)
        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

    def session(self) -> Session:
        return self.sessionmaker()

    def dispose(self) -> None:
        self.engine.dispose()


def get_db(request: Request) -> Iterator[Session]:
    db: Database = request.app.state.db
    session = db.session()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
