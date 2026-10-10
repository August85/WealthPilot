from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin

NOTIFICATION_TYPES = ("vest_reminder", "stale_balance", "goal_milestone")


class NotificationPreference(IdMixin, TimestampMixin, Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    channel: Mapped[str] = mapped_column(String(16), default="push")
    enabled: Mapped[bool] = mapped_column(default=False)

    __table_args__ = (
        UniqueConstraint("user_id", "type", "channel", name="uq_notification_preferences_user_type_channel"),
        CheckConstraint("type in ('vest_reminder','stale_balance','goal_milestone')", name="type"),
    )


class Device(IdMixin, Base):
    __tablename__ = "devices"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expo_push_token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    last_seen_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (CheckConstraint("platform in ('ios','android')", name="platform"),)


class Notification(IdMixin, Base):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(500))
    dedupe_key: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
    read_at: Mapped[datetime | None]
    pushed_at: Mapped[datetime | None]

    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_dedupe"),
        Index("ix_notifications_user_created", "user_id", text("created_at DESC")),
    )
