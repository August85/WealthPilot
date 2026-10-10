from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, IdMixin, TimestampMixin


class Scenario(IdMixin, TimestampMixin, Base):
    __tablename__ = "scenarios"

    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))
    preset: Mapped[str] = mapped_column(String(16))
    goal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scenarios.id", ondelete="SET NULL"))
    archived: Mapped[bool] = mapped_column(default=False)
    active_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("scenario_versions.id", ondelete="SET NULL", use_alter=True)
    )
    version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        CheckConstraint("kind in ('home','retirement','general')", name="kind"),
        CheckConstraint("preset in ('baseline','conservative','optimistic','custom')", name="preset"),
    )


class ScenarioVersion(IdMixin, Base):
    """Immutable (spec §7.2): a DB trigger rejects UPDATE."""

    __tablename__ = "scenario_versions"

    scenario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    number: Mapped[int]
    assumptions: Mapped[dict[str, Any]]
    snapshot: Mapped[dict[str, Any]]
    input_hash: Mapped[str] = mapped_column(String(80))
    model_version: Mapped[str] = mapped_column(String(32))
    rulepack_version: Mapped[str] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(String(2000))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("scenario_id", "number", name="uq_scenario_versions_number"),
        Index("ix_scenario_versions_scenario_created", "scenario_id", text("created_at DESC")),
    )


class SimulationRun(IdMixin, Base):
    __tablename__ = "simulation_runs"

    scenario_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scenario_versions.id", ondelete="CASCADE"), index=True
    )
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    seed: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    model_version: Mapped[str] = mapped_column(String(32))
    rulepack_version: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(String(500))
    checksum: Mapped[str | None] = mapped_column(String(80))
    result: Mapped[dict[str, Any] | None]
    result_uri: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("status in ('queued','running','completed','failed')", name="status"),
        Index("ix_simulation_runs_household_status", "household_id", "status"),
    )
