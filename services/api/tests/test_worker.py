from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select


def test_job_retry_backoff_and_dead_letter(app: Any) -> None:
    from wealthpilot_api.modules.jobs.models import Job
    from wealthpilot_api.modules.jobs.service import REGISTRY, claim, enqueue, process, register

    calls: list[int] = []
    failures: list[str] = []

    @register("test_flaky", on_failure=lambda db, p, ctx, err: failures.append(err))
    def flaky(db: Any, payload: dict[str, Any], ctx: Any) -> None:
        calls.append(1)
        raise RuntimeError("boom")

    try:
        ctx = app.state.job_context
        with ctx.db_factory.session() as db:
            jid = enqueue(db, "test_flaky", {}, max_attempts=2)
            db.commit()
        with ctx.db_factory.session() as db:
            assert claim(db, "w", jid) is not None
        assert process(jid, ctx) == "retry"
        with ctx.db_factory.session() as db:
            job = db.get(Job, jid)
            assert job is not None
            assert job.status == "queued" and job.attempts == 1 and job.last_error == "RuntimeError"
            assert claim(db, "w") is None  # backoff: not due yet
        with ctx.db_factory.session() as db:
            assert claim(db, "w", jid) is not None  # an explicit claim ignores run_after
        assert process(jid, ctx) == "failed"
        with ctx.db_factory.session() as db:
            job = db.get(Job, jid)
            assert job is not None and job.status == "failed"
        assert failures == ["RuntimeError"] and len(calls) == 2
    finally:
        REGISTRY.pop("test_flaky", None)


def test_skip_locked_claims_are_exclusive(app: Any) -> None:
    from wealthpilot_api.modules.jobs.service import enqueue

    ctx = app.state.job_context
    with ctx.db_factory.session() as db:
        enqueue(db, "daily_maintenance", {})
        db.commit()
    from sqlalchemy import text

    with ctx.db_factory.session() as a, ctx.db_factory.session() as b:
        row = a.execute(text("SELECT id FROM jobs WHERE status='queued' FOR UPDATE SKIP LOCKED LIMIT 1")).first()
        assert row is not None
        other = b.execute(text("SELECT id FROM jobs WHERE status='queued' FOR UPDATE SKIP LOCKED LIMIT 1")).first()
        assert other is None
        a.rollback()
        b.rollback()


def test_worker_once_runs_daily_jobs(settings: Any, monkeypatch: pytest.MonkeyPatch, app: Any) -> None:
    from wealthpilot_api import worker
    from wealthpilot_api.core import config
    from wealthpilot_api.modules.jobs.models import Job

    monkeypatch.setenv("WP_DATABASE_URL", settings.database_url)
    monkeypatch.setenv("WP_EXPORT_DIR", settings.export_dir)
    config.get_settings.cache_clear()
    try:
        assert worker.main(["--once"]) == 0
        assert worker.main(["--once"]) == 0  # daily jobs are de-duplicated by date
    finally:
        config.get_settings.cache_clear()
    with app.state.db.session() as db:
        jobs = db.scalars(select(Job)).all()
        assert sorted(j.type for j in jobs) == ["daily_maintenance", "daily_notifications"]
        assert all(j.status == "done" for j in jobs)
