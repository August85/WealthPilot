from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class Subscription(IdMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), unique=True)
    provider: Mapped[str] = mapped_column(String(32), default="revenuecat")
    entitlement: Mapped[str] = mapped_column(String(16), default="free")
    renewal_status: Mapped[str] = mapped_column(String(32), default="none")
    expires_at: Mapped[datetime | None]
    last_event_id: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (CheckConstraint("entitlement in ('free','plus','pro')", name="entitlement"),)


class BillingEvent(Base):
    """Processed webhook event ids (idempotent webhook handling)."""

    __tablename__ = "billing_events"

    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    received_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
