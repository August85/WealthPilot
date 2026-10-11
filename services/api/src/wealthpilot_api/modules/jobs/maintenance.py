"""Daily housekeeping: purge expired export artifacts (and, for the postgres backend, any expired rows) and
idempotency keys older than 24 hours."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..reports.models import ExportJob
from .models import IdempotencyKey
from .service import JobContext, register

IDEMPOTENCY_TTL = timedelta(hours=24)


@register("daily_maintenance")
def handle_maintenance(db: Session, payload: dict[str, Any], ctx: JobContext) -> None:
    now = datetime.now(UTC)
    storage = ctx.services.get("storage")
    expired = db.scalars(select(ExportJob).where(ExportJob.artifact_ref.is_not(None), ExportJob.expires_at < now))
    for job in expired.all():
        if storage is not None and job.artifact_ref:
            try:
                storage.delete(job.artifact_ref)
            except Exception:
                continue
        job.artifact_ref = None
    purge = getattr(storage, "purge_expired", None)
    if purge is not None:  # postgres backend: also drop orphaned rows past their expiry
        purge(now)
    db.execute(delete(IdempotencyKey).where(IdempotencyKey.created_at < now - IDEMPOTENCY_TTL))
