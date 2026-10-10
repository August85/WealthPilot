from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class Account(IdMixin, TimestampMixin, Base):
    __tablename__ = "accounts"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    type: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(8))
    currency: Mapped[str] = mapped_column(String(3))
    accessibility: Mapped[str] = mapped_column(String(16))
    accessibility_override_note: Mapped[str | None] = mapped_column(String(500))
    goal_eligible: Mapped[bool] = mapped_column(default=False)
    include_in_net_worth: Mapped[bool] = mapped_column(default=True)
    ownership_pct: Mapped[Decimal] = mapped_column(default=Decimal(100))
    details: Mapped[dict[str, Any]] = mapped_column(default=dict)
    archived: Mapped[bool] = mapped_column(default=False)
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_account_id: Mapped[str | None] = mapped_column(String(255))
    connection_id: Mapped[uuid.UUID | None]
    deleted_at: Mapped[datetime | None]
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        CheckConstraint("kind in ('asset','liability')", name="kind"),
        CheckConstraint("accessibility in ('liquid','restricted','illiquid')", name="accessibility"),
        CheckConstraint("ownership_pct >= 0 and ownership_pct <= 100", name="ownership_pct"),
        Index("ix_accounts_household_updated", "household_id", "updated_at"),
        # household-scoped de-duplication of provider-linked accounts (spec §7.2)
        Index(
            "uq_accounts_provider_account",
            "household_id",
            "provider",
            "provider_account_id",
            unique=True,
            postgresql_where=text("provider_account_id is not null and deleted_at is null"),
        ),
    )


class Valuation(IdMixin, Base):
    """Append-only balance snapshots (FR-AS-006). Corrections supersede; rows are never edited
    (a DB trigger only allows setting ``superseded_by`` once)."""

    __tablename__ = "valuations"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal]
    currency: Mapped[str] = mapped_column(String(3))
    as_of: Mapped[date]
    source: Mapped[str] = mapped_column(String(16), default="manual")
    verification_status: Mapped[str] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(String(500))
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("valuations.id", ondelete="SET NULL"))
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("valuations.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("amount >= 0", name="amount_nonneg"),
        CheckConstraint("source in ('manual','import','computed')", name="source"),
        CheckConstraint("verification_status in ('estimated','verified')", name="verification"),
        Index("ix_valuations_account_asof", "account_id", text("as_of DESC")),
    )
