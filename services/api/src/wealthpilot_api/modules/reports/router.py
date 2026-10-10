"""Exports (FR-EXP-*): request, status with a short-lived signed URL, token-authenticated download."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.errors import ApiError, not_found
from ...core.schema import ApiModel, OutModel
from ..auth.deps import Ctx, get_ctx
from ..compliance.service import audit
from ..households.models import Household
from ..jobs.service import JobContext, enqueue, run_inline
from ..scenarios.models import SimulationRun
from .models import ExportJob
from .storage import ArtifactStorage
from .tokens import sign_download, verify_download

router = APIRouter(tags=["exports"])


class ExportIn(ApiModel):
    format: Literal["csv", "json", "pdf"]
    scope: Literal["balances", "assumptions", "run"]
    run_id: uuid.UUID | None = None


class ExportOut(OutModel):
    id: uuid.UUID
    format: str
    scope: str
    run_id: uuid.UUID | None
    status: Literal["queued", "completed", "failed"]
    download_url: str | None = None
    expires_at: datetime | None = None
    watermarked: bool = False
    error: str | None = None
    created_at: datetime


def export_out(request: Request, job: ExportJob) -> ExportOut:
    out = ExportOut.model_validate(job)
    out.expires_at = None
    now = datetime.now(UTC)
    if job.status == "completed" and job.expires_at is not None and job.expires_at > now:
        settings = request.app.state.settings
        ttl = min(settings.download_token_ttl_seconds, int((job.expires_at - now).total_seconds()))
        token, exp = sign_download(settings.secret_key, job.id, ttl, now)
        out.download_url = str(
            request.url_for("download_export", export_id=str(job.id)).include_query_params(token=token)
        )
        out.expires_at = exp
    return out


@router.post("/exports", response_model=ExportOut, status_code=202)
def create_export(body: ExportIn, request: Request, ctx: Ctx = Depends(get_ctx)) -> ExportOut:
    if body.format == "pdf" and body.scope != "run":
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "PDF exports are only available for scope=run.",
            errors=[{"loc": ["body", "format"], "msg": "pdf requires scope=run"}],
        )
    if body.scope == "run" and body.run_id is None:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "scope=run requires run_id.",
            errors=[{"loc": ["body", "run_id"], "msg": "required for scope=run"}],
        )
    if body.run_id is not None:
        run = ctx.db.scalar(
            select(SimulationRun).where(SimulationRun.id == body.run_id, SimulationRun.household_id == ctx.hid)
        )
        if run is None:
            raise not_found("Run")
        if run.status != "completed":
            raise ApiError(409, "RUN_NOT_COMPLETE", "The run has not completed yet.")
    job = ExportJob(
        user_id=ctx.user.id,
        household_id=ctx.hid,
        format=body.format,
        scope=body.scope,
        run_id=body.run_id,
        status="queued",
    )
    ctx.db.add(job)
    ctx.db.flush()
    job_id = enqueue(
        ctx.db,
        "export",
        {"export_id": str(job.id)},
        dedupe_key=f"export:{job.id}",
        max_attempts=ctx.settings.job_max_attempts,
    )
    audit(
        ctx.db,
        "export.requested",
        actor_id=ctx.user.id,
        household_id=ctx.hid,
        entity_type="export",
        entity_id=job.id,
        format=body.format,
        scope=body.scope,
    )
    ctx.db.commit()
    if ctx.settings.inline_jobs:
        jc: JobContext = request.app.state.job_context
        run_inline(jc, job_id)
        ctx.db.refresh(job)
    return export_out(request, job)


def _export(ctx: Ctx, export_id: uuid.UUID) -> ExportJob:
    job = ctx.db.scalar(select(ExportJob).where(ExportJob.id == export_id, ExportJob.household_id == ctx.hid))
    if job is None:
        raise not_found("Export")
    return job


@router.get("/exports/{export_id}", response_model=ExportOut)
def read_export(export_id: uuid.UUID, request: Request, ctx: Ctx = Depends(get_ctx)) -> ExportOut:
    return export_out(request, _export(ctx, export_id))


@router.get(
    "/exports/{export_id}/download",
    name="download_export",
    responses={200: {"content": {"application/pdf": {}, "text/csv": {}, "application/json": {}}}},
)
def download_export(
    export_id: uuid.UUID, request: Request, token: str = Query(..., max_length=200), db: Session = Depends(get_db)
) -> Response:
    """Token-authenticated (no bearer): the signed token in ``download_url`` is valid for 15 minutes."""
    settings = request.app.state.settings
    if not verify_download(settings.secret_key, export_id, token):
        raise ApiError(403, "INVALID_DOWNLOAD_TOKEN", "The download link is invalid or has expired.")
    job = db.get(ExportJob, export_id)
    now = datetime.now(UTC)
    if job is None or job.status != "completed" or job.artifact_ref is None:
        raise not_found("Export")
    household = db.get(Household, job.household_id)
    if household is None or household.deleted_at is not None:
        raise not_found("Export")
    if job.expires_at is None or job.expires_at <= now:
        raise ApiError(410, "EXPORT_EXPIRED", "This export has expired. Request a new one.")
    storage: ArtifactStorage = request.app.state.storage
    try:
        data = storage.get(job.artifact_ref)
    except (FileNotFoundError, KeyError) as exc:
        raise ApiError(410, "EXPORT_EXPIRED", "This export is no longer available.") from exc
    audit(
        db,
        "export.downloaded",
        actor_id=job.user_id,
        household_id=job.household_id,
        entity_type="export",
        entity_id=job.id,
        format=job.format,
        scope=job.scope,
    )
    db.commit()
    return Response(
        content=data,
        media_type=job.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{job.filename or "export"}"',
            "Cache-Control": "no-store",
        },
    )
