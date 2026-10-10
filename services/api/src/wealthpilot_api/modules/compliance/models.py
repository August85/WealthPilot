from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin


class AuditEvent(IdMixin, Base):
    """Security audit log (FR-ID-005). ``metadata_redacted`` never holds amounts or PII."""

    __tablename__ = "audit_events"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str | None] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    metadata_redacted: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (Index("ix_audit_events_actor_created", "actor_id", text("created_at DESC")),)
