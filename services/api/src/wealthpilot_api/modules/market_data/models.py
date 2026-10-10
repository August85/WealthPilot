from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import RATE, Base, IdMixin


class FxRate(IdMixin, Base):
    """FX rates with provenance. ``kind='user'`` rows belong to a household and are the only rates used in
    calculations; ``kind='reference'`` rows (household NULL) cache the free ECB feed for display only."""

    __tablename__ = "fx_rates"

    household_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    base_currency: Mapped[str] = mapped_column(String(3))
    quote_currency: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(RATE)
    as_of: Mapped[date]
    kind: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(64))
    license_reference: Mapped[str | None] = mapped_column(String(255))
    fetched_at: Mapped[datetime | None]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("rate > 0", name="rate_positive"),
        CheckConstraint("kind in ('user','reference')", name="kind"),
        CheckConstraint("base_currency <> quote_currency", name="distinct_pair"),
        Index("ix_fx_rates_lookup", "household_id", "base_currency", "quote_currency", text("as_of DESC")),
    )


class PriceQuote(IdMixin, Base):
    __tablename__ = "price_quotes"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    symbol: Mapped[str] = mapped_column(String(32))
    price: Mapped[Decimal]
    currency: Mapped[str] = mapped_column(String(3))
    as_of: Mapped[date]
    provider: Mapped[str] = mapped_column(String(64), default="manual")
    quality: Mapped[str] = mapped_column(String(16), default="user_entered")
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("price > 0", name="price_positive"),
        Index("ix_price_quotes_lookup", "household_id", "symbol", text("as_of DESC")),
    )
