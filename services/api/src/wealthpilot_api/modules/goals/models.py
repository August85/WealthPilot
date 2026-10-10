from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class Goal(IdMixin, TimestampMixin, Base):
    __tablename__ = "goals"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    target_date: Mapped[date | None]
    target_amount: Mapped[Decimal]
    currency: Mapped[str] = mapped_column(String(3))
    priority: Mapped[int] = mapped_column(default=3)
    scenario_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scenarios.id", ondelete="SET NULL", use_alter=True)
    )
    details: Mapped[dict[str, Any]] = mapped_column(default=dict)
    deleted_at: Mapped[datetime | None]
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        CheckConstraint("priority between 1 and 5", name="priority"),
        CheckConstraint("target_amount >= 0", name="target_nonneg"),
        CheckConstraint("type in ('home_purchase','retirement','education','emergency_fund','custom')", name="type"),
    )
