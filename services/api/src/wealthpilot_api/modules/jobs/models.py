from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class Job(IdMixin, TimestampMixin, Base):
    """Postgres-backed job queue row. Workers claim with ``SELECT … FOR UPDATE SKIP LOCKED``."""

    __tablename__ = "jobs"

    type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    attempts: Mapped[int] = mapped_column(default=0)
    max_attempts: Mapped[int] = mapped_column(default=5)
    run_after: Mapped[datetime] = mapped_column(server_default=text("now()"))
    locked_at: Mapped[datetime | None]
    locked_by: Mapped[str | None] = mapped_column(String(128))
    last_error: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), unique=True)

    __table_args__ = (
        CheckConstraint("status in ('queued','running','done','failed')", name="status"),
        Index("ix_jobs_status_run_after", "status", "run_after"),
    )


class IdempotencyKey(IdMixin, Base):
    __tablename__ = "idempotency_keys"

    subject: Mapped[str] = mapped_column(String(255))
    key: Mapped[str] = mapped_column(String(255))
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(500))
    request_hash: Mapped[str] = mapped_column(String(80))
    status_code: Mapped[int | None]
    response_body: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (Index("uq_idempotency_subject_key", "subject", "key", unique=True),)
