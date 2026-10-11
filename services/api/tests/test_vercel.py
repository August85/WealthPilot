"""Vercel hosting: platform settings, Postgres export storage, cron endpoints, authorized-party checks, CORS."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.pool import NullPool

from wealthpilot_api.core.config import Settings, normalize_database_url
from wealthpilot_api.core.db import Database, engine_options
from wealthpilot_api.main import create_app

from .conftest import Api, auth
from .test_platform import Oidc

PLATFORM_VARS = (
    "VERCEL",
    "VERCEL_ENV",
    "CRON_SECRET",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "WP_ENV",
    "WP_DATABASE_URL",
    "WP_MIGRATION_DATABASE_URL",
    "WP_AUTH_MODE",
    "WP_SECRET_KEY",
    "WP_INLINE_JOBS",
    "WP_STORAGE_BACKEND",
    "WP_DB_POOL_SIZE",
    "WP_OIDC_ISSUER",
    "WP_OIDC_JWKS_URL",
    "WP_CRON_SECRET",
)
SECRET = "s" * 32
CRON = "cron-secret-0123456789"


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for k in PLATFORM_VARS:
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def settings_from_env(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg]


# ------------------------------------------------------------------------------------------ database URL
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgres://u:p@h/db?sslmode=require", "postgresql+psycopg://u:p@h/db?sslmode=require"),
        ("postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql+psycopg://u@h/db", "postgresql+psycopg://u@h/db"),
    ],
)
def test_database_url_translation(raw: str, expected: str) -> None:
    assert normalize_database_url(raw) == expected


def test_database_url_fallbacks(clean_env: pytest.MonkeyPatch) -> None:
    neon = "postgres://u:p@ep-cool-1-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
    direct = "postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require"
    clean_env.setenv("POSTGRES_URL", "postgres://legacy@h/db")
    assert settings_from_env().database_url == "postgresql+psycopg://legacy@h/db"
    clean_env.setenv("DATABASE_URL", neon)
    s = settings_from_env()
    assert s.database_url == "postgresql+psycopg://" + neon.removeprefix("postgres://")
    assert s.alembic_url == s.database_url  # no unpooled URL yet
    clean_env.setenv("DATABASE_URL_UNPOOLED", direct)
    assert settings_from_env().alembic_url == "postgresql+psycopg://" + direct.removeprefix("postgresql://")
    clean_env.setenv("WP_DATABASE_URL", "postgresql+psycopg://explicit@h/db")
    assert settings_from_env().database_url == "postgresql+psycopg://explicit@h/db"  # WP_ wins


def test_default_database_url_without_any_env(clean_env: pytest.MonkeyPatch) -> None:
    assert settings_from_env().database_url.startswith("postgresql+psycopg://postgres@127.0.0.1:55432/")


def test_engine_options_for_serverless_and_pooler() -> None:
    assert engine_options("postgresql+psycopg://u@h/db", 0) == {"poolclass": NullPool}
    opts = engine_options("postgresql+psycopg://u@ep-x-pooler.neon.tech/db", 0)
    assert opts["connect_args"] == {"prepare_threshold": None}
    assert engine_options("postgresql+psycopg://u@h/db", 5) == {"pool_pre_ping": True, "pool_size": 5}
    assert Database("postgresql+psycopg://u@h/db", pool_size=0).engine.pool.__class__ is NullPool


# ------------------------------------------------------------------------------------------ Vercel env
def test_vercel_production_defaults(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("VERCEL", "1")
    clean_env.setenv("VERCEL_ENV", "production")
    clean_env.setenv("CRON_SECRET", CRON)
    s = settings_from_env(secret_key=SECRET, oidc_issuer="https://clerk.example.test", oidc_jwks_url="https://j")
    assert s.env == "production" and s.on_vercel and s.is_vercel_deployment
    assert s.inline_jobs is True and s.storage_backend == "postgres" and s.db_pool_size == 0
    assert s.cron_secret == CRON and s.auth_mode == "oidc"
    with pytest.raises(ValidationError, match="WP_OIDC_ISSUER"):
        settings_from_env(secret_key=SECRET)  # production requires OIDC
    with pytest.raises(ValidationError, match="refused"):
        settings_from_env(secret_key=SECRET, auth_mode="dev", oidc_issuer="https://i", oidc_jwks_url="https://j")


def test_vercel_preview_is_staging_and_refuses_dev_auth(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("VERCEL", "1")
    clean_env.setenv("VERCEL_ENV", "preview")
    s = settings_from_env(secret_key=SECRET)
    assert s.env == "staging" and s.inline_jobs and s.storage_backend == "postgres"
    with pytest.raises(ValidationError, match="refused on Vercel"):
        settings_from_env(secret_key=SECRET, auth_mode="dev")
    clean_env.setenv("WP_ENV", "development")  # an explicit WP_ENV does not re-enable dev auth on a deployment
    with pytest.raises(ValidationError, match="refused on Vercel"):
        settings_from_env(secret_key=SECRET, auth_mode="dev")
    with pytest.raises(ValidationError, match="WP_SECRET_KEY"):
        settings_from_env()


def test_explicit_settings_override_vercel_defaults(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("VERCEL", "1")
    clean_env.setenv("VERCEL_ENV", "preview")
    clean_env.setenv("WP_STORAGE_BACKEND", "s3")
    clean_env.setenv("WP_INLINE_JOBS", "0")
    s = settings_from_env(secret_key=SECRET)
    assert s.storage_backend == "s3" and s.inline_jobs is False


def test_vercel_dev_and_other_hosts_keep_local_defaults(clean_env: pytest.MonkeyPatch) -> None:
    s = settings_from_env(auth_mode="dev")
    assert s.env == "development" and not s.on_vercel and s.storage_backend == "local" and s.db_pool_size == 5
    clean_env.setenv("VERCEL", "1")
    clean_env.setenv("VERCEL_ENV", "development")  # `vercel dev` on a laptop
    s = settings_from_env(auth_mode="dev")
    assert s.env == "development" and s.auth_mode == "dev"


# ------------------------------------------------------------------------------------------ export storage
def test_postgres_storage_round_trip_and_expiry(db: Database) -> None:
    from wealthpilot_api.modules.reports.models import ExportArtifact
    from wealthpilot_api.modules.reports.storage import PostgresStorage

    st = PostgresStorage(db, ttl_hours=1)
    ref = st.put("h1/e1.pdf", b"%PDF-1.4 bytes", "application/pdf")
    assert ref == "h1/e1.pdf" and st.get(ref) == b"%PDF-1.4 bytes"
    st.put("h1/e1.pdf", b"v2", "application/pdf")  # overwrite is idempotent
    assert st.get(ref) == b"v2"
    with pytest.raises(ValueError):
        st.put("../escape", b"x", "text/plain")
    with pytest.raises(KeyError):
        st.get("missing")

    st.put("h1/old.csv", b"a,b", "text/csv")
    with db.session() as s:
        s.execute(text("UPDATE export_artifacts SET expires_at = now() - interval '1 minute' WHERE key = 'h1/old.csv'"))
        s.commit()
    with pytest.raises(KeyError):
        st.get("h1/old.csv")  # expired rows are never served
    assert st.purge_expired() == 1
    st.delete(ref)
    with db.session() as s:
        assert s.scalars(select(ExportArtifact.key)).all() == []


@pytest.fixture
def pg_client(settings: Settings, db: Database, fake_http: Any) -> Any:
    s = settings.model_copy(update={"storage_backend": "postgres"})
    app = create_app(s, db=db, http=httpx.Client(transport=httpx.MockTransport(fake_http)))
    with TestClient(app) as c:
        yield c


def test_exports_with_postgres_backend(pg_client: TestClient, db: Database) -> None:
    from wealthpilot_api.modules.jobs.maintenance import handle_maintenance
    from wealthpilot_api.modules.reports.models import ExportArtifact, ExportJob

    alice = Api(pg_client, "alice")
    alice.onboard()
    alice.account(type_="cash", amount="1234.5")
    e = alice.ok(alice.post("/exports", {"format": "csv", "scope": "balances"}), 202)
    assert e["status"] == "completed"
    u = urlparse(e["download_url"])
    r = pg_client.get(f"{u.path}?{u.query}")
    assert r.status_code == 200 and "1234.50000000" in r.text
    with db.session() as s:
        assert s.scalar(select(ExportArtifact.key)).endswith(f"{e['id']}.csv")

    # the artifact row expired (export TTL passed) -> 410, and daily maintenance purges both
    with db.session() as s:
        s.execute(text("UPDATE export_artifacts SET expires_at = now() - interval '1 second'"))
        s.commit()
    assert pg_client.get(f"{u.path}?{u.query}").status_code == 410
    with db.session() as s:
        s.execute(text("UPDATE export_jobs SET expires_at = now() - interval '1 second'"))
        handle_maintenance(s, {}, pg_client.app.state.job_context)  # type: ignore[attr-defined]
        s.commit()
        assert s.scalars(select(ExportArtifact)).all() == []
        assert s.scalar(select(ExportJob.artifact_ref)) is None


# ------------------------------------------------------------------------------------------ cron
@pytest.fixture
def cron_client(settings: Settings, db: Database, fake_http: Any, push: Any) -> Any:
    s = settings.model_copy(update={"cron_secret": CRON})
    app = create_app(s, db=db, http=httpx.Client(transport=httpx.MockTransport(fake_http)), push=push)
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("path", ["/v1/internal/cron/daily", "/v1/internal/cron/sweep"])
def test_cron_requires_secret(cron_client: TestClient, client: TestClient, path: str) -> None:
    assert cron_client.get(path).status_code == 401
    assert cron_client.get(path, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert cron_client.get(path, headers={"Authorization": CRON}).status_code == 401  # Bearer prefix required
    assert cron_client.post(path, headers=auth("alice")).status_code == 401  # a user token is not enough
    # no CRON_SECRET configured -> always 401, even with an empty bearer
    assert client.get(path, headers={"Authorization": "Bearer "}).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer None"}).status_code == 401


def test_cron_daily_runs_notifications_and_maintenance(cron_client: TestClient, push: Any) -> None:
    from wealthpilot_api.modules.jobs.models import Job

    alice = Api(cron_client, "alice")
    alice.onboard()
    today = date.today()
    alice.account(type_="cash", amount="10", as_of=(today - timedelta(days=90)).isoformat())
    alice.ok(alice.post("/devices", {"expo_push_token": "ExponentPushToken[abc]", "platform": "ios"}), 201)
    alice.ok(
        alice.patch(
            "/notification-preferences", {"items": [{"type": "stale_balance", "channel": "push", "enabled": True}]}
        )
    )
    h = {"Authorization": f"Bearer {CRON}", "User-Agent": "vercel-cron/1.0"}
    r = cron_client.get("/v1/internal/cron/daily", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["date"] == datetime.now(UTC).date().isoformat()
    assert body["processed"] == 2 and r.headers["cache-control"] == "no-store"
    items = alice.ok(alice.get("/notifications"))["items"]
    assert [n["type"] for n in items] == ["stale_balance"]
    assert len(push.sent) == 1

    again = cron_client.post("/v1/internal/cron/daily", headers=h).json()  # duplicate delivery is a no-op
    assert again["processed"] == 0
    assert len(alice.ok(alice.get("/notifications"))["items"]) == 1
    db = cron_client.app.state.db  # type: ignore[attr-defined]
    with db.session() as s:
        jobs = s.scalars(select(Job)).all()
        assert sorted(j.type for j in jobs) == ["daily_maintenance", "daily_notifications"]
        assert all(j.status == "done" for j in jobs)


def test_cron_sweep_requeues_stuck_jobs_and_runs_due_ones(cron_client: TestClient) -> None:
    from wealthpilot_api.modules.jobs.models import Job
    from wealthpilot_api.modules.jobs.service import enqueue

    db = cron_client.app.state.db  # type: ignore[attr-defined]
    with db.session() as s:
        stuck = enqueue(s, "daily_maintenance", {}, dedupe_key="stuck")
        due = enqueue(s, "daily_maintenance", {}, dedupe_key="due")
        later = enqueue(s, "daily_maintenance", {}, dedupe_key="later", run_after=datetime.now(UTC) + timedelta(days=1))
        s.flush()
        s.execute(
            text("UPDATE jobs SET status='running', locked_at = now() - interval '1 hour', attempts=1 WHERE id=:id"),
            {"id": stuck},
        )
        s.commit()
    r = cron_client.get("/v1/internal/cron/sweep", headers={"Authorization": f"Bearer {CRON}"})
    assert r.status_code == 200, r.text
    assert r.json()["requeued"] == 1 and r.json()["processed"] == 2
    with db.session() as s:
        status = {j.id: j.status for j in s.scalars(select(Job)).all()}
    assert status == {stuck: "done", due: "done", later: "queued"}  # erasures scheduled later stay queued


def test_cron_endpoints_are_not_in_public_schema(client: TestClient) -> None:
    paths = client.get("/v1/openapi.json").json()["paths"]
    assert not any("/internal/" in p for p in paths)


# ------------------------------------------------------------------------------------------ OIDC azp
@pytest.fixture
def azp_client(settings: Settings, db: Database, fake_http: Any) -> Any:
    oidc = Oidc()
    fake_http.handlers["issuer.test"] = lambda req: httpx.Response(200, json=oidc.jwks)
    s = settings.model_copy(
        update={"auth_mode": "oidc", "oidc_authorized_parties": "https://app.example.test, https://www.example.test/"}
    )
    app = create_app(s, db=db, http=httpx.Client(transport=httpx.MockTransport(fake_http)))
    with TestClient(app) as c:
        yield c, oidc


def test_azp_checked_against_authorized_parties(azp_client: Any) -> None:
    c, oidc = azp_client

    def me(**claims: Any) -> int:
        return c.get("/v1/me", headers={"Authorization": f"Bearer {oidc.token('u1', **claims)}"}).status_code

    assert me(azp="https://app.example.test") == 200
    assert me(azp="https://www.example.test") == 200  # trailing slash in the setting is ignored
    assert me(azp="https://evil.example.test") == 401
    assert me(azp=["https://app.example.test"]) == 401  # must be a string
    assert me() == 200  # Clerk: skip the check when azp is absent (e.g. native apps)


def test_azp_not_checked_when_unset(client: TestClient, fake_http: Any) -> None:
    oidc = Oidc()
    fake_http.handlers["issuer.test"] = lambda req: httpx.Response(200, json=oidc.jwks)
    tok = oidc.token("u2", azp="https://anything.test")
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200


# ------------------------------------------------------------------------------------------ CORS
def test_cors_origin_regex_for_preview_urls(settings: Settings, db: Database, fake_http: Any) -> None:
    s = settings.model_copy(
        update={
            "cors_origins": "https://app.example.test",
            "cors_origin_regex": r"https://wealthpilot-web-[a-z0-9-]+\.vercel\.app",
        }
    )
    app = create_app(s, db=db, http=httpx.Client(transport=httpx.MockTransport(fake_http)))
    with TestClient(app) as c:

        def allowed(origin: str) -> str | None:
            r = c.options("/v1/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})  # preflight
            return r.headers.get("access-control-allow-origin")

        assert allowed("https://app.example.test") == "https://app.example.test"
        assert (
            allowed("https://wealthpilot-web-git-feat-ak.vercel.app")
            == "https://wealthpilot-web-git-feat-ak.vercel.app"
        )
        assert allowed("https://evil.vercel.app") is None
