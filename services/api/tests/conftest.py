"""API test fixtures: a fresh Postgres database per session (migrated with Alembic), tables truncated between
tests, dev auth, inline jobs, local export storage and mocked outbound HTTP (frankfurter, JWKS, Expo).

Set ``WP_TEST_ADMIN_URL`` to a Postgres URL with CREATE DATABASE rights
(default ``postgresql+psycopg://postgres@127.0.0.1:55432/postgres``, see ``scripts/dev-db.sh``).
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from wealthpilot_api.core.config import Settings
from wealthpilot_api.core.db import Database
from wealthpilot_api.main import create_app
from wealthpilot_api.modules.notifications.push import NoopPushSender

API_DIR = Path(__file__).resolve().parents[1]
ADMIN_URL = os.environ.get("WP_TEST_ADMIN_URL", "postgresql+psycopg://postgres@127.0.0.1:55432/postgres")
WEBHOOK_SECRET = "rc-test-secret-value"


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    name = f"wealthpilot_test_{uuid.uuid4().hex[:10]}"
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f"CREATE DATABASE \"{name}\" ENCODING 'UTF8' TEMPLATE template0"))
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    command.upgrade(cfg, "head")
    try:
        yield url
    finally:
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="session")
def db(database_url: str) -> Iterator[Database]:
    d = Database(database_url)
    yield d
    d.dispose()


@pytest.fixture(autouse=True)
def _clean(db: Database) -> Iterator[None]:
    yield
    with db.engine.begin() as c:
        tables = [
            r[0]
            for r in c.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'")
            )
        ]
        c.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " RESTART IDENTITY CASCADE"))


class FakeHttp:
    """Routes outbound HTTP to per-test handlers (``handlers[host] = fn(request) -> httpx.Response``)."""

    def __init__(self) -> None:
        self.handlers: dict[str, Callable[[httpx.Request], httpx.Response]] = {}
        self.calls: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        h = self.handlers.get(request.url.host)
        if h is None:
            raise httpx.ConnectError("no route in tests", request=request)
        return h(request)


@pytest.fixture
def fake_http() -> FakeHttp:
    return FakeHttp()


@pytest.fixture
def settings(database_url: str, tmp_path: Path) -> Settings:
    return Settings(
        env="test",
        database_url=database_url,
        auth_mode="dev",
        inline_jobs=True,
        export_dir=str(tmp_path / "exports"),
        secret_key="test-secret-key-0123456789",
        revenuecat_webhook_secret=WEBHOOK_SECRET,
        fx_reference_url="https://fx.test",
        oidc_issuer="https://issuer.test/",
        oidc_jwks_url="https://issuer.test/.well-known/jwks.json",
        oidc_audience="wealthpilot-api",
        log_level="WARNING",
    )


@pytest.fixture
def push() -> NoopPushSender:
    return NoopPushSender()


@pytest.fixture
def app(settings: Settings, db: Database, fake_http: FakeHttp, push: NoopPushSender) -> Any:
    http = httpx.Client(transport=httpx.MockTransport(fake_http))
    return create_app(settings, db=db, http=http, push=push)


@pytest.fixture
def client(app: Any) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def auth(sub: str = "alice", email: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{sub}:{email or sub + '@example.test'}"}


ONBOARDING = {
    "home_country": "US",
    "reporting_currency": "USD",
    "household_name": "Test household",
    "disclaimer_accepted": True,
    "tax_residency": [{"jurisdiction": "US", "residency_type": "resident", "from_date": "2020-01-01", "to_date": None}],
}


class Api:
    """Small helper around TestClient for one dev user."""

    def __init__(self, client: TestClient, sub: str) -> None:
        self.c = client
        self.h = auth(sub)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.get("/v1" + path, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def post(self, path: str, json: Any = None, **kw: Any) -> httpx.Response:
        return self.c.post("/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def patch(self, path: str, json: Any = None, **kw: Any) -> httpx.Response:
        return self.c.patch("/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def put(self, path: str, json: Any = None, **kw: Any) -> httpx.Response:
        return self.c.put("/v1" + path, json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.delete("/v1" + path, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def ok(self, resp: httpx.Response, status: int = 200) -> Any:
        assert resp.status_code == status, (resp.status_code, resp.text)
        return resp.json() if resp.content and resp.headers.get("content-type", "").find("json") >= 0 else None

    def onboard(self, **overrides: Any) -> dict[str, Any]:
        return self.ok(self.post("/me/onboarding", {**ONBOARDING, **overrides}))

    def account(
        self,
        kind: str = "asset",
        type_: str = "checking",
        currency: str = "USD",
        amount: str | None = "1000",
        country: str = "US",
        as_of: str | None = None,
        verification: str = "verified",
        **extra: Any,
    ) -> dict[str, Any]:
        from datetime import date

        body: dict[str, Any] = {
            "kind": kind,
            "type": type_,
            "name": f"{type_} {currency}",
            "country": country,
            "currency": currency,
            **extra,
        }
        if amount is not None:
            body["initial_valuation"] = {
                "amount": amount,
                "as_of": as_of or date.today().isoformat(),
                "verification_status": verification,
            }
        return self.ok(self.post("/accounts", body), 201)

    def fx(self, rate: str = "85", base: str = "USD", quote: str = "INR", as_of: str | None = None) -> dict[str, Any]:
        from datetime import date

        return self.ok(
            self.post(
                "/fx/rates", {"base": base, "quote": quote, "rate": rate, "as_of": as_of or date.today().isoformat()}
            ),
            201,
        )


@pytest.fixture
def alice(client: TestClient) -> Api:
    a = Api(client, "alice")
    a.onboard()
    return a


@pytest.fixture
def bob(client: TestClient) -> Api:
    b = Api(client, "bob")
    b.onboard(household_name="Bob household")
    return b
