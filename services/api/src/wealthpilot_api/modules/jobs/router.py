"""Internal cron endpoints for hosts without a worker process (Vercel Cron). Not part of the public API schema.

Vercel Cron calls the production deployment with ``GET`` and ``Authorization: Bearer $CRON_SECRET``. Both
endpoints are idempotent (daily jobs are de-duplicated by date, job claims use ``SKIP LOCKED``), so duplicate or
overlapping invocations are safe; a missed invocation is caught up by the next one.

* ``/v1/internal/cron/daily``: enqueue the day's notification and maintenance jobs, then sweep.
* ``/v1/internal/cron/sweep``: requeue stuck jobs and run every due job (retries, scheduled erasures).
"""

from __future__ import annotations

import hmac
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from ...core.config import Settings
from ...core.errors import ApiError
from .scheduler import enqueue_daily, sweep
from .service import JobContext

log = logging.getLogger("wealthpilot.cron")

router = APIRouter(prefix="/internal/cron", tags=["internal"], include_in_schema=False)

# leave headroom below the function's maxDuration (vercel.json) for the response
CRON_BUDGET_SECONDS = 45.0


def require_cron_secret(request: Request) -> None:
    settings: Settings = request.app.state.settings
    secret = settings.cron_secret
    header = request.headers.get("authorization", "")
    if not secret or not hmac.compare_digest(header.encode(), f"Bearer {secret}".encode()):
        raise ApiError(
            401, "UNAUTHENTICATED", "A valid cron secret is required.", headers={"WWW-Authenticate": "Bearer"}
        )


def _run(request: Request, response: Response, daily: bool) -> dict[str, Any]:
    ctx: JobContext = request.app.state.job_context
    response.headers["Cache-Control"] = "no-store"
    day = enqueue_daily(ctx) if daily else datetime.now(UTC).date().isoformat()
    result = sweep(ctx, "cron", budget_seconds=CRON_BUDGET_SECONDS)
    log.info(
        "cron daily run" if daily else "cron sweep run",
        extra={"requeued": result.requeued, "processed": result.processed},
    )
    return {"status": "ok", "date": day, "requeued": result.requeued, "processed": result.processed}


@router.api_route("/daily", methods=["GET", "POST"], dependencies=[Depends(require_cron_secret)])
def cron_daily(request: Request, response: Response) -> dict[str, Any]:
    return _run(request, response, daily=True)


@router.api_route("/sweep", methods=["GET", "POST"], dependencies=[Depends(require_cron_secret)])
def cron_sweep(request: Request, response: Response) -> dict[str, Any]:
    return _run(request, response, daily=False)
