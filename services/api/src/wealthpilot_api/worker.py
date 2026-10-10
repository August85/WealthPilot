"""Job worker: ``python -m wealthpilot_api.worker [--once]``.

Polls the Postgres ``jobs`` table (``FOR UPDATE SKIP LOCKED``; safe to run several replicas), executes scenario
runs, exports, the daily notification job and privacy erasures. Once per UTC day it enqueues
``daily_notifications`` and ``daily_maintenance`` (de-duplicated by date, so many workers enqueue once).
Stops gracefully on SIGTERM/SIGINT after the current job.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import threading
import time
from datetime import UTC, datetime

import httpx

from . import main as _main  # noqa: F401 - imports register every job handler
from .core.config import get_settings
from .core.db import Database
from .core.request_context import configure_logging
from .main import build_job_context
from .modules.jobs.service import JobContext, enqueue, reap_stale, run_pending

log = logging.getLogger("wealthpilot.worker")


def enqueue_daily(ctx: JobContext, today: str | None = None) -> None:
    day = today or datetime.now(UTC).date().isoformat()
    with ctx.db_factory.session() as db:
        enqueue(db, "daily_notifications", {"date": day}, dedupe_key=f"daily_notifications:{day}")
        enqueue(db, "daily_maintenance", {"date": day}, dedupe_key=f"daily_maintenance:{day}")
        db.commit()


def run_once(ctx: JobContext, worker_id: str) -> int:
    enqueue_daily(ctx)
    with ctx.db_factory.session() as db:
        reap_stale(db)
    return run_pending(ctx, worker_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="wealthpilot_api.worker")
    parser.add_argument("--once", action="store_true", help="process due jobs and exit")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level)
    db = Database(settings.database_url)
    http = httpx.Client(timeout=10)
    ctx = build_job_context(settings, db, http)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    stop = threading.Event()

    def _stop(*_: object) -> None:
        log.info("worker stopping")
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    log.info("worker started")
    try:
        if args.once:
            n = run_once(ctx, worker_id)
            log.info("worker processed jobs", extra={"count": n})
            return 0
        last_daily = ""
        last_reap = 0.0
        while not stop.is_set():
            today = datetime.now(UTC).date().isoformat()
            if today != last_daily:
                enqueue_daily(ctx, today)
                last_daily = today
            if time.monotonic() - last_reap > 300:  # requeue jobs from crashed workers
                with db.session() as s:
                    reap_stale(s)
                last_reap = time.monotonic()
            n = run_pending(ctx, worker_id, limit=50)
            if n == 0:
                stop.wait(settings.worker_poll_seconds)
    finally:
        http.close()
        db.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
