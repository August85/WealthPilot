"""Export job handler: builds the artifact from stored data and writes it to artifact storage."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..billing.service import entitlement_for
from ..jobs.service import JobContext, register
from ..scenarios.models import SimulationRun
from . import generate
from .models import ExportJob
from .storage import ArtifactStorage

CONTENT_TYPES = {"csv": "text/csv; charset=utf-8", "json": "application/json", "pdf": "application/pdf"}


def build_artifact(db: Session, job: ExportJob, now: datetime) -> tuple[bytes, bool]:
    """Return ``(bytes, watermarked)`` for an export job."""
    run = db.get(SimulationRun, job.run_id) if job.run_id else None
    if job.scope == "run" and (run is None or run.status != "completed" or run.result is None):
        raise ValueError("run not available")
    if job.scope == "balances":
        rows = generate.balances(db, job.household_id, now.date())
        if job.format == "csv":
            return generate.to_csv(
                generate.BALANCE_COLUMNS, [[r[c] for c in generate.BALANCE_COLUMNS] for r in rows]
            ), False
        return generate.to_json(
            {"generated_at": now.isoformat(), "accounts": rows, "disclaimers": generate.DISCLAIMERS}
        ), False
    if job.scope == "assumptions":
        versions = generate.assumption_versions(db, job.household_id, run)
        if job.format == "csv":
            out = []
            for v in versions:
                for path, value in generate.flatten(v["assumptions"]):
                    out.append([v["scenario_id"], v["scenario_name"], v["version_number"], path, value])
            return generate.to_csv(
                ["scenario_id", "scenario_name", "version_number", "assumption", "value"], out
            ), False
        return generate.to_json(
            {"generated_at": now.isoformat(), "scenarios": versions, "disclaimers": generate.DISCLAIMERS}
        ), False
    assert run is not None
    bundle = generate.run_bundle(db, run)
    if job.format == "csv":
        return generate.run_csv(bundle), False
    if job.format == "json":
        return generate.to_json({"generated_at": now.isoformat(), **bundle}), False
    watermark = entitlement_for(db, job.household_id) == "free"
    return generate.render_pdf(bundle, now, watermark), watermark


def _failed(db: Session, payload: dict[str, Any], ctx: JobContext, err: str) -> None:
    job = db.get(ExportJob, uuid.UUID(payload["export_id"]))
    if job is not None and job.status != "completed":
        job.status = "failed"
        job.error = f"Export failed ({err})."


@register("export", on_failure=_failed)
def handle_export(db: Session, payload: dict[str, Any], ctx: JobContext) -> None:
    job = db.get(ExportJob, uuid.UUID(payload["export_id"]), with_for_update=True)
    if job is None or job.status == "completed":
        return
    now = datetime.now(UTC)
    data, watermarked = build_artifact(db, job, now)
    storage: ArtifactStorage = ctx.services["storage"]
    stamp = now.strftime("%Y%m%d")
    filename = f"wealthpilot-{job.scope}-{stamp}.{job.format}"
    job.artifact_ref = storage.put(f"{job.household_id}/{job.id}.{job.format}", data, CONTENT_TYPES[job.format])
    job.content_type = CONTENT_TYPES[job.format]
    job.filename = filename
    job.watermarked = watermarked
    job.status = "completed"
    job.error = None
    job.expires_at = now + timedelta(hours=ctx.settings.export_ttl_hours)
