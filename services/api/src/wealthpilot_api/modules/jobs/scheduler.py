"""Scheduling shared by the long-running worker and the Vercel Cron endpoints.

* :func:`enqueue_daily` enqueues ``daily_notifications`` and ``daily_maintenance`` for a UTC day, de-duplicated by
  date, so any number of workers or cron invocations enqueue them once.
* :func:`sweep` requeues jobs whose runner died mid-run (worker crash, or a serverless invocation that hit its
  maximum duration) and then runs every due job: retries after backoff, runs/exports whose inline execution
  failed, scheduled privacy erasures and the daily jobs.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime

from .service import JobContext, enqueue, reap_stale, run_pending


def enqueue_daily(ctx: JobContext, today: str | None = None) -> str:
    day = today or datetime.now(UTC).date().isoformat()
    with ctx.db_factory.session() as db:
        enqueue(db, "daily_notifications", {"date": day}, dedupe_key=f"daily_notifications:{day}")
        enqueue(db, "daily_maintenance", {"date": day}, dedupe_key=f"daily_maintenance:{day}")
        db.commit()
    return day


@dataclass
class SweepResult:
    requeued: int
    processed: int


def sweep(
    ctx: JobContext,
    worker_id: str,
    *,
    limit: int = 500,
    budget_seconds: float | None = None,
    stale_minutes: int = 15,
) -> SweepResult:
    deadline = time.monotonic() + budget_seconds if budget_seconds else None
    with ctx.db_factory.session() as db:
        requeued = reap_stale(db, minutes=stale_minutes)
    processed = run_pending(ctx, worker_id, limit=limit, deadline=deadline)
    return SweepResult(requeued=requeued, processed=processed)
