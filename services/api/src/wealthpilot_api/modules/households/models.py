from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    auth_subject: Mapped[str] = mapped_column(String(255), unique=True)
    email: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str | None] = mapped_column(String(120))
    locale: Mapped[str] = mapped_column(String(35), default="en-US")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    reporting_currency: Mapped[str] = mapped_column(String(3), default="USD")
    home_country: Mapped[str] = mapped_column(String(8), default="US")
    status: Mapped[str] = mapped_column(String(16), default="active")
    onboarding_completed: Mapped[bool] = mapped_column(default=False)
    disclaimer_accepted_at: Mapped[datetime | None]
    last_session_ref: Mapped[str | None] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None]
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (CheckConstraint("status in ('active','deleted')", name="status"),)


class Household(IdMixin, TimestampMixin, Base):
    __tablename__ = "households"

    display_name: Mapped[str] = mapped_column(String(120))
    default_currency: Mapped[str] = mapped_column(String(3), default="USD")
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deleted_at: Mapped[datetime | None]
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}


class Membership(IdMixin, TimestampMixin, Base):
    __tablename__ = "memberships"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="owner")
    status: Mapped[str] = mapped_column(String(16), default="active")
    invited_at: Mapped[datetime | None]

    __table_args__ = (
        UniqueConstraint("household_id", "user_id", name="uq_memberships_household_user"),
        CheckConstraint("role in ('owner','editor','viewer')", name="role"),
    )


class TaxResidencyPeriod(IdMixin, TimestampMixin, Base):
    __tablename__ = "tax_residency_periods"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    jurisdiction: Mapped[str] = mapped_column(String(8))
    residency_type: Mapped[str] = mapped_column(String(16))
    from_date: Mapped[date]
    to_date: Mapped[date | None]
    verified_by_user: Mapped[bool] = mapped_column(default=False)

    __table_args__ = (CheckConstraint("to_date is null or to_date >= from_date", name="date_range"),)


class SessionRevocation(Base):
    """Server-side token denylist: tokens for ``subject`` issued before ``revoked_before`` are rejected."""

    __tablename__ = "session_revocations"

    subject: Mapped[str] = mapped_column(String(255), primary_key=True)
    revoked_before: Mapped[datetime]
