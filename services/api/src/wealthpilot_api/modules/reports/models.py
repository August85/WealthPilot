from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class ExportJob(IdMixin, TimestampMixin, Base):
    __tablename__ = "export_jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(8))
    scope: Mapped[str] = mapped_column(String(16))
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("simulation_runs.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    artifact_ref: Mapped[str | None] = mapped_column(String(500))
    content_type: Mapped[str | None] = mapped_column(String(100))
    filename: Mapped[str | None] = mapped_column(String(200))
    watermarked: Mapped[bool] = mapped_column(default=False)
    expires_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(String(500))

    __table_args__ = (
        CheckConstraint("format in ('csv','json','pdf')", name="format"),
        CheckConstraint("scope in ('balances','assumptions','run')", name="scope"),
        CheckConstraint("status in ('queued','completed','failed')", name="status"),
    )
