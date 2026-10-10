"""Goals with progress from goal-eligible funds or the latest run of the linked scenario."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import Field
from sqlalchemy import func, select
from wealthpilot_calc import compute_net_worth, q_money

from ...core.errors import ApiError, not_found
from ...core.schema import ApiModel, CurrencyCode, ItemList, Money, NonNegMoney, OutModel
from ..accounts.service import net_worth_input
from ..auth.deps import Ctx, get_ctx
from ..billing.service import enforce_limit
from ..compliance.service import audit
from ..scenarios.models import Scenario, ScenarioVersion, SimulationRun
from .models import Goal

router = APIRouter(tags=["goals"])

GoalType = Literal["home_purchase", "retirement", "education", "emergency_fund", "custom"]


class GoalCreate(ApiModel):
    type: GoalType
    name: str = Field(min_length=1, max_length=120)
    target_date: date | None = None
    target_amount: NonNegMoney
    currency: CurrencyCode
    priority: int = Field(3, ge=1, le=5)
    scenario_id: uuid.UUID | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class GoalPatch(ApiModel):
    type: GoalType | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_date: date | None = None
    target_amount: NonNegMoney | None = None
    currency: CurrencyCode | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    scenario_id: uuid.UUID | None = None
    details: dict[str, Any] | None = None
    version: int | None = None


class Progress(OutModel):
    funded_amount: Money
    pct: str
    as_of: date
    scenario_run_id: uuid.UUID | None


class GoalOut(OutModel):
    id: uuid.UUID
    type: str
    name: str
    target_date: date | None
    target_amount: Money
    currency: str
    priority: int
    scenario_id: uuid.UUID | None
    details: dict[str, Any]
    version: int
    created_at: datetime
    progress: Progress | None = None


def _goal(ctx: Ctx, goal_id: uuid.UUID) -> Goal:
    g = ctx.db.scalar(select(Goal).where(Goal.id == goal_id, Goal.household_id == ctx.hid, Goal.deleted_at.is_(None)))
    if g is None:
        raise not_found("Goal")
    return g


def _check_scenario(ctx: Ctx, scenario_id: uuid.UUID | None) -> None:
    if scenario_id is None:
        return
    if ctx.db.scalar(select(Scenario.id).where(Scenario.id == scenario_id, Scenario.household_id == ctx.hid)) is None:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "scenario_id must be one of your scenarios.",
            errors=[{"loc": ["body", "scenario_id"], "msg": "unknown scenario"}],
        )


def latest_completed_run(ctx: Ctx, scenario_id: uuid.UUID) -> SimulationRun | None:
    return ctx.db.scalar(
        select(SimulationRun)
        .join(ScenarioVersion, ScenarioVersion.id == SimulationRun.scenario_version_id)
        .where(
            ScenarioVersion.scenario_id == scenario_id,
            SimulationRun.status == "completed",
            SimulationRun.household_id == ctx.hid,
        )
        .order_by(SimulationRun.completed_at.desc())
        .limit(1)
    )


def progress_for(ctx: Ctx, g: Goal, eligible_cache: dict[str, Decimal]) -> Progress:
    today = datetime.now(UTC).date()
    funded: Decimal | None = None
    run_id = None
    as_of = today
    if g.scenario_id is not None:
        run = latest_completed_run(ctx, g.scenario_id)
        if run is not None and run.result and run.result.get("currency") == g.currency:
            m = run.result.get("metrics", {})
            key = {
                "home_purchase": "home_cash_available_at_purchase",
                "retirement": "retirement_balance_at_retirement",
            }.get(g.type, "liquid_net_worth_now")
            if m.get(key) is not None:
                funded = Decimal(m[key])
                run_id = run.id
                as_of = date.fromisoformat(run.result["base_date"])
    if funded is None:
        if g.currency not in eligible_cache:
            eligible_cache[g.currency] = compute_net_worth(
                net_worth_input(ctx.db, ctx.hid, g.currency, today)
            ).goal_eligible
        funded = eligible_cache[g.currency]
    pct = Decimal(100) if g.target_amount == 0 else min(Decimal(100), funded / g.target_amount * 100)
    return Progress(
        funded_amount=q_money(funded), pct=str(q_money(max(pct, Decimal(0)))), as_of=as_of, scenario_run_id=run_id
    )


def goal_out(ctx: Ctx, g: Goal, cache: dict[str, Decimal] | None = None, with_progress: bool = True) -> GoalOut:
    out = GoalOut.model_validate(g)
    if with_progress:
        out.progress = progress_for(ctx, g, cache if cache is not None else {})
    return out


@router.get("/goals", response_model=ItemList[GoalOut])
def list_goals(ctx: Ctx = Depends(get_ctx)) -> dict:
    rows = ctx.db.scalars(
        select(Goal)
        .where(Goal.household_id == ctx.hid, Goal.deleted_at.is_(None))
        .order_by(Goal.priority, Goal.created_at)
    ).all()
    cache: dict[str, Decimal] = {}
    return {"items": [goal_out(ctx, g, cache) for g in rows]}


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalCreate, ctx: Ctx = Depends(get_ctx)) -> GoalOut:
    count = (
        ctx.db.scalar(
            select(func.count()).select_from(Goal).where(Goal.household_id == ctx.hid, Goal.deleted_at.is_(None))
        )
        or 0
    )
    enforce_limit(ctx.db, ctx.hid, "goals", count)
    _check_scenario(ctx, body.scenario_id)
    g = Goal(household_id=ctx.hid, **body.model_dump())
    ctx.db.add(g)
    ctx.db.commit()
    return goal_out(ctx, g)


@router.get("/goals/{goal_id}", response_model=GoalOut)
def read_goal(goal_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> GoalOut:
    return goal_out(ctx, _goal(ctx, goal_id))


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def patch_goal(goal_id: uuid.UUID, body: GoalPatch, ctx: Ctx = Depends(get_ctx)) -> GoalOut:
    g = _goal(ctx, goal_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != g.version:
        raise ApiError(409, "VERSION_CONFLICT", "The goal was modified; reload and retry.")
    for k in ("type", "name", "target_amount", "currency", "priority", "details"):
        if k in data and data[k] is None:
            raise ApiError(422, "VALIDATION_ERROR", f"{k} cannot be null.")
    if "scenario_id" in data:
        _check_scenario(ctx, data["scenario_id"])
    for k, v in data.items():
        setattr(g, k, v)
    ctx.db.commit()
    return goal_out(ctx, g)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    g = _goal(ctx, goal_id)
    g.deleted_at = datetime.now(UTC)
    audit(ctx.db, "goal.deleted", actor_id=ctx.user.id, household_id=ctx.hid, entity_type="goal", entity_id=g.id)
    ctx.db.commit()
    return Response(status_code=204)
