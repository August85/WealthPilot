"""Postgres-backed job queue (DECISIONS: ``FOR UPDATE SKIP LOCKED`` instead of Redis/Celery).

* ``enqueue`` inserts a row (optionally de-duplicated by ``dedupe_key``).
* ``claim`` locks the next due job with ``SELECT … FOR UPDATE SKIP LOCKED`` so concurrent workers never take
  the same job, marks it running and commits.
* ``process`` runs the registered handler in its own session. Failures are retried with exponential backoff
  (2^attempt seconds, capped at one hour) up to ``max_attempts``; then the job is ``failed`` and the
  handler's ``on_failure`` hook records the failure on the domain object (dead-letter state).
* Handlers must be idempotent: a job may run more than once (e.g. after a worker crash).
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ...core.config import Settings
from ...core.db import Database
from .models import Job

log = logging.getLogger("wealthpilot.jobs")


@dataclass
class JobContext:
    settings: Settings
    db_factory: Database
    services: dict[str, Any] = field(default_factory=dict)


Handler = Callable[[Session, dict[str, Any], JobContext], None]
FailureHook = Callable[[Session, dict[str, Any], JobContext, str], None]


@dataclass
class JobType:
    handler: Handler
    on_failure: FailureHook | None = None
    on_retry: FailureHook | None = None


REGISTRY: dict[str, JobType] = {}


def register(
    name: str, *, on_failure: FailureHook | None = None, on_retry: FailureHook | None = None
) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        REGISTRY[name] = JobType(fn, on_failure, on_retry)
        return fn

    return deco


def enqueue(
    db: Session,
    type_: str,
    payload: dict[str, Any],
    *,
    dedupe_key: str | None = None,
    run_after: datetime | None = None,
    max_attempts: int = 5,
) -> uuid.UUID | None:
    """Insert a job; returns its id, or None when a job with the same dedupe_key already exists."""
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "type": type_,
        "payload": payload,
        "status": "queued",
        "attempts": 0,
        "max_attempts": max_attempts,
        "dedupe_key": dedupe_key,
    }
    if run_after is not None:
        values["run_after"] = run_after
    stmt = insert(Job).values(**values)
    if dedupe_key is not None:
        stmt = stmt.on_conflict_do_nothing(index_elements=["dedupe_key"])
    res = db.execute(stmt.returning(Job.id))
    return res.scalar_one_or_none()


def claim(db: Session, worker_id: str, job_id: uuid.UUID | None = None) -> Job | None:
    q = select(Job).where(Job.status == "queued")
    if job_id is not None:
        q = q.where(Job.id == job_id)
    else:
        q = q.where(Job.run_after <= datetime.now(UTC))
    job = db.scalar(q.order_by(Job.run_after, Job.created_at).with_for_update(skip_locked=True).limit(1))
    if job is None:
        db.rollback()
        return None
    job.status = "running"
    job.locked_at = datetime.now(UTC)
    job.locked_by = worker_id
    job.attempts += 1
    db.commit()
    return job


def backoff(attempt: int) -> timedelta:
    return timedelta(seconds=min(3600, 2**attempt))


def process(job_id: uuid.UUID, ctx: JobContext) -> str:
    """Run one claimed job; returns the resulting status."""
    with ctx.db_factory.session() as db:
        job = db.get(Job, job_id)
        if job is None or job.status != "running":
            return "skipped"
        jt = REGISTRY.get(job.type)
        payload = dict(job.payload or {})
        attempts, max_attempts = job.attempts, job.max_attempts
        if jt is None:
            job.status = "failed"
            job.last_error = "unknown job type"
            db.commit()
            return "failed"
        try:
            jt.handler(db, payload, ctx)
            db.commit()
        except Exception as exc:
            db.rollback()
            err = f"{type(exc).__name__}"
            log.warning(
                "job failed",
                extra={"job_id": str(job_id), "job_type": job.type, "attempt": attempts, "error_type": err},
            )
            final = attempts >= max_attempts
            db.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(
                    status="failed" if final else "queued",
                    run_after=datetime.now(UTC) + backoff(attempts),
                    last_error=err,
                    locked_at=None,
                    locked_by=None,
                )
            )
            hook = jt.on_failure if final else jt.on_retry
            if hook is not None:
                try:
                    hook(db, payload, ctx, err)
                except Exception:
                    db.rollback()
                    log.exception("job failure hook failed", extra={"job_id": str(job_id)})
            db.commit()
            return "failed" if final else "retry"
        db.execute(update(Job).where(Job.id == job_id).values(status="done", locked_at=None, last_error=None))
        db.commit()
        return "done"


def reap_stale(db: Session, minutes: int = 15) -> int:
    """Requeue jobs whose worker died mid-run (they are idempotent)."""
    cutoff = datetime.now(UTC) - timedelta(minutes=minutes)
    res = db.execute(
        update(Job)
        .where(Job.status == "running", Job.locked_at < cutoff)
        .values(status="queued", locked_at=None, locked_by=None)
    )
    db.commit()
    return res.rowcount or 0


def run_pending(ctx: JobContext, worker_id: str, limit: int = 100, deadline: float | None = None) -> int:
    """Claim and run due jobs until none are left, ``limit`` is reached or ``time.monotonic()`` passes
    ``deadline`` (serverless invocations have a maximum duration)."""
    n = 0
    while n < limit and (deadline is None or time.monotonic() < deadline):
        with ctx.db_factory.session() as db:
            job = claim(db, worker_id)
            if job is None:
                break
            job_id = job.id
        process(job_id, ctx)
        n += 1
    return n


def run_inline(ctx: JobContext, job_id: uuid.UUID | None) -> None:
    """WP_INLINE_JOBS=1: execute a just-enqueued job immediately in the request process."""
    if job_id is None:
        return
    with ctx.db_factory.session() as db:
        job = claim(db, "inline", job_id)
        if job is None:
            return
    process(job_id, ctx)
