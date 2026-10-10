from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...core.db import Base, IdMixin, TimestampMixin


class RsuGrant(IdMixin, TimestampMixin, Base):
    __tablename__ = "rsu_grants"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    employer_name: Mapped[str] = mapped_column(String(120))
    symbol: Mapped[str] = mapped_column(String(32))
    grant_date: Mapped[dt.date]
    granted_shares: Mapped[Decimal]
    award_currency: Mapped[str] = mapped_column(String(3), default="USD")
    grant_price: Mapped[Decimal | None]
    held_in_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    default_withholding_rate: Mapped[Decimal | None]
    status: Mapped[str] = mapped_column(String(16), default="active")
    deleted_at: Mapped[dt.datetime | None]
    version: Mapped[int] = mapped_column(default=1)

    vests: Mapped[list[RsuVest]] = relationship(
        back_populates="grant", order_by="RsuVest.vest_date", cascade="all, delete-orphan"
    )

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        CheckConstraint("granted_shares >= 0", name="granted_nonneg"),
        CheckConstraint(
            "default_withholding_rate is null or (default_withholding_rate >= 0 and default_withholding_rate <= 1)",
            name="withholding_range",
        ),
        CheckConstraint("status in ('active','cancelled')", name="status"),
    )


class RsuVest(IdMixin, TimestampMixin, Base):
    __tablename__ = "rsu_vests"

    grant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rsu_grants.id", ondelete="CASCADE"))
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    vest_date: Mapped[dt.date]
    scheduled_shares: Mapped[Decimal]
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    vested_shares: Mapped[Decimal | None]
    vest_fmv: Mapped[Decimal | None]
    withheld_shares: Mapped[Decimal | None]
    source_event_id: Mapped[str | None] = mapped_column(String(255))
    version: Mapped[int] = mapped_column(default=1)

    grant: Mapped[RsuGrant] = relationship(back_populates="vests")
    dispositions: Mapped[list[RsuDisposition]] = relationship(
        back_populates="vest", order_by="RsuDisposition.created_at", cascade="all, delete-orphan"
    )

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        CheckConstraint("scheduled_shares >= 0", name="scheduled_nonneg"),
        CheckConstraint("vested_shares is null or vested_shares >= 0", name="vested_nonneg"),
        CheckConstraint("withheld_shares is null or withheld_shares >= 0", name="withheld_nonneg"),
        CheckConstraint(
            "withheld_shares is null or withheld_shares <= coalesce(vested_shares, 0)", name="withheld_le_vested"
        ),
        CheckConstraint("vest_fmv is null or vest_fmv >= 0", name="fmv_nonneg"),
        CheckConstraint("status in ('scheduled','vested','cancelled')", name="status"),
        Index("ix_rsu_vests_grant_date", "grant_id", "vest_date"),
        Index(
            "uq_rsu_vests_event",
            "grant_id",
            "vest_date",
            "source_event_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
    )


class RsuDisposition(IdMixin, Base):
    __tablename__ = "rsu_dispositions"

    vest_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rsu_vests.id", ondelete="CASCADE"), index=True)
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    date: Mapped[dt.date]
    kind: Mapped[str] = mapped_column(String(16))
    shares: Mapped[Decimal]
    price: Mapped[Decimal]
    fees: Mapped[Decimal] = mapped_column(default=Decimal(0))
    tax_assumption_id: Mapped[uuid.UUID | None]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=text("now()"))

    vest: Mapped[RsuVest] = relationship(back_populates="dispositions")

    __table_args__ = (
        CheckConstraint("shares >= 0", name="shares_nonneg"),
        CheckConstraint("price >= 0", name="price_nonneg"),
        CheckConstraint("fees >= 0", name="fees_nonneg"),
        CheckConstraint("kind in ('sell_to_cover','sale')", name="kind"),
    )
