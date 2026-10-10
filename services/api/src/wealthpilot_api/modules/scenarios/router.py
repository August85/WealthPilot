"""Scenarios, immutable versions, runs, results and comparisons (FR-SCN-*)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from wealthpilot_calc import MODEL_VERSION, RULEPACK_VERSION, RunResult, ScenarioAssumptions, input_hash
from wealthpilot_calc import HouseholdSnapshot as CalcSnapshot

from ...core.errors import ApiError, not_found
from ...core.schema import ApiModel, ItemList, OutModel
from ..auth.deps import Ctx, get_ctx
from ..billing.service import enforce_limit
from ..goals.models import Goal
from ..jobs.service import JobContext, enqueue, run_inline
from .models import Scenario, ScenarioVersion, SimulationRun
from .service import build_defaults, capture_snapshot

router = APIRouter(tags=["scenarios"])

Kind = Literal["home", "retirement", "general"]
Preset = Literal["baseline", "conservative", "optimistic", "custom"]


class ScenarioVersionOut(OutModel):
    id: uuid.UUID
    scenario_id: uuid.UUID
    number: int
    assumptions: dict[str, Any]
    snapshot: dict[str, Any]
    input_hash: str
    model_version: str
    rulepack_version: str
    notes: str | None
    created_at: datetime


class RunSummary(OutModel):
    id: uuid.UUID
    scenario_version_id: uuid.UUID
    status: str
    checksum: str | None
    created_at: datetime
    completed_at: datetime | None


class SimulationRunOut(OutModel):
    id: uuid.UUID
    scenario_version_id: uuid.UUID
    status: Literal["queued", "running", "completed", "failed"]
    seed: int | None
    model_version: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None
    checksum: str | None = None


class ScenarioOut(OutModel):
    id: uuid.UUID
    name: str
    kind: str
    preset: str
    goal_id: uuid.UUID | None
    parent_id: uuid.UUID | None
    archived: bool
    active_version: ScenarioVersionOut | None
    latest_run: RunSummary | None
    created_at: datetime
    updated_at: datetime
    version: int


class ScenarioCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Kind
    preset: Preset = "baseline"
    goal_id: uuid.UUID | None = None
    assumptions: ScenarioAssumptions | None = None


class ScenarioPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None
    goal_id: uuid.UUID | None = None
    preset: Preset | None = None
    version: int | None = None


class CloneIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)


class VersionCreate(ApiModel):
    assumptions: ScenarioAssumptions
    notes: str | None = Field(default=None, max_length=2000)


class RunCreate(ApiModel):
    seed: int | None = Field(default=None, ge=0, le=2**62)


class ComparisonIn(ApiModel):
    run_ids: list[uuid.UUID] = Field(min_length=1, max_length=4)

    @field_validator("run_ids")
    @classmethod
    def _unique(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(set(v)) != len(v):
            raise ValueError("run_ids must be unique")
        return v


class ComparisonRun(BaseModel):
    run_id: uuid.UUID
    scenario_id: uuid.UUID
    scenario_name: str
    version_number: int
    metrics: dict[str, Any]


class SeriesPoint(BaseModel):
    year: int
    values: dict[str, str | None]


class ComparisonOut(BaseModel):
    runs: list[ComparisonRun]
    series: dict[str, list[SeriesPoint]]


# ------------------------------------------------------------------------------------------- helpers
def _scenario(ctx: Ctx, scenario_id: uuid.UUID) -> Scenario:
    s = ctx.db.scalar(select(Scenario).where(Scenario.id == scenario_id, Scenario.household_id == ctx.hid))
    if s is None:
        raise not_found("Scenario")
    return s


def _version(ctx: Ctx, version_id: uuid.UUID) -> ScenarioVersion:
    v = ctx.db.scalar(
        select(ScenarioVersion).where(ScenarioVersion.id == version_id, ScenarioVersion.household_id == ctx.hid)
    )
    if v is None:
        raise not_found("Scenario version")
    return v


def _run(ctx: Ctx, run_id: uuid.UUID) -> SimulationRun:
    r = ctx.db.scalar(select(SimulationRun).where(SimulationRun.id == run_id, SimulationRun.household_id == ctx.hid))
    if r is None:
        raise not_found("Run")
    return r


def _active_count(db: Session, hid: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(Scenario).where(Scenario.household_id == hid, Scenario.archived.is_(False))
        )
        or 0
    )


def _check_goal(ctx: Ctx, goal_id: uuid.UUID | None) -> None:
    if goal_id is None:
        return
    if (
        ctx.db.scalar(
            select(Goal.id).where(Goal.id == goal_id, Goal.household_id == ctx.hid, Goal.deleted_at.is_(None))
        )
        is None
    ):
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "goal_id must be one of your goals.",
            errors=[{"loc": ["body", "goal_id"], "msg": "unknown goal"}],
        )


def create_version(ctx: Ctx, scenario: Scenario, assumptions: dict[str, Any], notes: str | None) -> ScenarioVersion:
    db = ctx.db
    a = ScenarioAssumptions.model_validate(assumptions)
    snapshot = capture_snapshot(db, ctx.hid)
    number = (
        db.scalar(select(func.max(ScenarioVersion.number)).where(ScenarioVersion.scenario_id == scenario.id)) or 0
    ) + 1
    v = ScenarioVersion(
        scenario_id=scenario.id,
        household_id=ctx.hid,
        number=number,
        assumptions=a.model_dump(mode="json"),
        snapshot=snapshot,
        input_hash=input_hash(a, CalcSnapshot.model_validate(snapshot)),
        model_version=MODEL_VERSION,
        rulepack_version=RULEPACK_VERSION,
        notes=notes,
        created_by=ctx.user.id,
    )
    db.add(v)
    db.flush()
    scenario.active_version_id = v.id
    return v


def scenario_out(ctx: Ctx, s: Scenario) -> ScenarioOut:
    active = ctx.db.get(ScenarioVersion, s.active_version_id) if s.active_version_id else None
    latest = ctx.db.scalar(
        select(SimulationRun)
        .join(ScenarioVersion, ScenarioVersion.id == SimulationRun.scenario_version_id)
        .where(ScenarioVersion.scenario_id == s.id)
        .order_by(SimulationRun.created_at.desc())
        .limit(1)
    )
    return ScenarioOut(
        id=s.id,
        name=s.name,
        kind=s.kind,
        preset=s.preset,
        goal_id=s.goal_id,
        parent_id=s.parent_id,
        archived=s.archived,
        active_version=ScenarioVersionOut.model_validate(active) if active else None,
        latest_run=RunSummary.model_validate(latest) if latest else None,
        created_at=s.created_at,
        updated_at=s.updated_at,
        version=s.version,
    )


# ------------------------------------------------------------------------------------------- scenarios
@router.get("/scenarios/defaults", response_model=ScenarioAssumptions)
def defaults(preset: Preset = "baseline", kind: Kind = "general", ctx: Ctx = Depends(get_ctx)) -> dict:
    return build_defaults(ctx.db, ctx.hid, ctx.user.reporting_currency, preset, kind)


@router.get("/scenarios", response_model=ItemList[ScenarioOut])
def list_scenarios(include_archived: bool = False, ctx: Ctx = Depends(get_ctx)) -> dict:
    q = select(Scenario).where(Scenario.household_id == ctx.hid)
    if not include_archived:
        q = q.where(Scenario.archived.is_(False))
    rows = ctx.db.scalars(q.order_by(Scenario.created_at)).all()
    return {"items": [scenario_out(ctx, s) for s in rows]}


@router.post("/scenarios", response_model=ScenarioOut, status_code=201)
def create_scenario(body: ScenarioCreate, ctx: Ctx = Depends(get_ctx)) -> ScenarioOut:
    enforce_limit(ctx.db, ctx.hid, "scenarios", _active_count(ctx.db, ctx.hid))
    _check_goal(ctx, body.goal_id)
    assumptions = (
        body.assumptions.model_dump(mode="json")
        if body.assumptions
        else build_defaults(ctx.db, ctx.hid, ctx.user.reporting_currency, body.preset, body.kind)
    )
    s = Scenario(household_id=ctx.hid, name=body.name, kind=body.kind, preset=body.preset, goal_id=body.goal_id)
    ctx.db.add(s)
    ctx.db.flush()
    create_version(ctx, s, assumptions, None)
    ctx.db.commit()
    return scenario_out(ctx, s)


@router.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def read_scenario(scenario_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> ScenarioOut:
    return scenario_out(ctx, _scenario(ctx, scenario_id))


@router.patch("/scenarios/{scenario_id}", response_model=ScenarioOut)
def patch_scenario(scenario_id: uuid.UUID, body: ScenarioPatch, ctx: Ctx = Depends(get_ctx)) -> ScenarioOut:
    s = _scenario(ctx, scenario_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != s.version:
        raise ApiError(409, "VERSION_CONFLICT", "The scenario was modified; reload and retry.")
    for k in ("name", "archived", "preset"):
        if k in data and data[k] is None:
            raise ApiError(422, "VALIDATION_ERROR", f"{k} cannot be null.")
    if "goal_id" in data:
        _check_goal(ctx, data["goal_id"])
    if data.get("archived") is False and s.archived:
        enforce_limit(ctx.db, ctx.hid, "scenarios", _active_count(ctx.db, ctx.hid))
    for k, v in data.items():
        setattr(s, k, v)
    ctx.db.commit()
    return scenario_out(ctx, s)


@router.post("/scenarios/{scenario_id}/clone", response_model=ScenarioOut, status_code=201)
def clone_scenario(scenario_id: uuid.UUID, body: CloneIn, ctx: Ctx = Depends(get_ctx)) -> ScenarioOut:
    src = _scenario(ctx, scenario_id)
    enforce_limit(ctx.db, ctx.hid, "scenarios", _active_count(ctx.db, ctx.hid))
    active = ctx.db.get(ScenarioVersion, src.active_version_id) if src.active_version_id else None
    s = Scenario(
        household_id=ctx.hid, name=body.name, kind=src.kind, preset=src.preset, goal_id=src.goal_id, parent_id=src.id
    )
    ctx.db.add(s)
    ctx.db.flush()
    assumptions = (
        active.assumptions
        if active
        else build_defaults(ctx.db, ctx.hid, ctx.user.reporting_currency, src.preset, src.kind)
    )
    create_version(ctx, s, assumptions, f"Cloned from scenario {src.id}")
    ctx.db.commit()
    return scenario_out(ctx, s)


@router.post("/scenarios/{scenario_id}/versions", response_model=ScenarioVersionOut, status_code=201)
def add_version(scenario_id: uuid.UUID, body: VersionCreate, ctx: Ctx = Depends(get_ctx)) -> ScenarioVersion:
    s = _scenario(ctx, scenario_id)
    v = create_version(ctx, s, body.assumptions.model_dump(mode="json"), body.notes)
    ctx.db.commit()
    return v


@router.get("/scenarios/{scenario_id}/versions", response_model=ItemList[ScenarioVersionOut])
def list_versions(scenario_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> dict:
    s = _scenario(ctx, scenario_id)
    rows = ctx.db.scalars(
        select(ScenarioVersion).where(ScenarioVersion.scenario_id == s.id).order_by(ScenarioVersion.number.desc())
    ).all()
    return {"items": rows}


# ------------------------------------------------------------------------------------------- runs
def run_out(r: SimulationRun) -> SimulationRunOut:
    return SimulationRunOut(
        id=r.id,
        scenario_version_id=r.scenario_version_id,
        status=r.status,
        seed=r.seed,
        model_version=r.model_version,
        created_at=r.created_at,
        started_at=r.started_at,
        completed_at=r.completed_at,
        error=r.error,
        checksum=r.checksum if r.status == "completed" else None,
    )


@router.post("/scenario-versions/{version_id}/runs", response_model=SimulationRunOut, status_code=202)
def create_run(
    version_id: uuid.UUID, request: Request, body: RunCreate | None = None, ctx: Ctx = Depends(get_ctx)
) -> SimulationRunOut:
    v = _version(ctx, version_id)
    run = SimulationRun(
        scenario_version_id=v.id,
        household_id=ctx.hid,
        seed=body.seed if body else None,
        status="queued",
        model_version=MODEL_VERSION,
        rulepack_version=RULEPACK_VERSION,
        created_by=ctx.user.id,
    )
    ctx.db.add(run)
    ctx.db.flush()
    job_id = enqueue(
        ctx.db,
        "scenario_run",
        {"run_id": str(run.id)},
        dedupe_key=f"scenario_run:{run.id}",
        max_attempts=ctx.settings.job_max_attempts,
    )
    ctx.db.commit()
    if ctx.settings.inline_jobs:
        jc: JobContext = request.app.state.job_context
        run_inline(jc, job_id)
        ctx.db.refresh(run)
    return run_out(run)


@router.get("/runs/{run_id}", response_model=SimulationRunOut)
def read_run(run_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> SimulationRunOut:
    return run_out(_run(ctx, run_id))


@router.get("/runs/{run_id}/results", response_model=RunResult)
def read_results(run_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> JSONResponse:
    r = _run(ctx, run_id)
    if r.status in ("queued", "running"):
        raise ApiError(409, "RUN_NOT_COMPLETE", "The run has not completed yet.")
    if r.status != "completed" or r.result is None:
        raise ApiError(404, "RESULTS_NOT_FOUND", "This run has no results (it failed).")
    # stored results are returned exactly as computed (never recomputed)
    return JSONResponse(r.result)


@router.post("/comparisons", response_model=ComparisonOut)
def compare(body: ComparisonIn, ctx: Ctx = Depends(get_ctx)) -> ComparisonOut:
    runs: list[ComparisonRun] = []
    results: dict[str, dict[str, Any]] = {}
    for rid in body.run_ids:
        r = _run(ctx, rid)
        if r.status != "completed" or r.result is None:
            raise ApiError(409, "RUN_NOT_COMPLETE", f"Run {rid} has not completed.")
        v = ctx.db.get(ScenarioVersion, r.scenario_version_id)
        s = ctx.db.get(Scenario, v.scenario_id) if v else None
        assert v is not None and s is not None
        runs.append(
            ComparisonRun(
                run_id=r.id,
                scenario_id=s.id,
                scenario_name=s.name,
                version_number=v.number,
                metrics=r.result.get("metrics", {}),
            )
        )
        results[str(r.id)] = r.result
    series: dict[str, list[SeriesPoint]] = {}
    for name, field in (
        ("net_worth", "net_worth"),
        ("liquid_net_worth", "liquid"),
        ("retirement_balance", "retirement_balance"),
    ):
        years: dict[int, dict[str, str | None]] = {}
        for rid, res in results.items():
            for row in res.get("yearly", []):
                years.setdefault(row["year"], {})[rid] = row.get(field)
        series[name] = [SeriesPoint(year=y, values={rid: years[y].get(rid) for rid in results}) for y in sorted(years)]
    return ComparisonOut(runs=runs, series=series)
