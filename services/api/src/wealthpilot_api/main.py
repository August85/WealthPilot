"""FastAPI application factory. Run with ``uvicorn wealthpilot_api.main:app``."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .core.config import Settings, get_settings
from .core.db import Database
from .core.errors import install_error_handlers
from .core.idempotency import IdempotencyMiddleware
from .core.request_context import RequestIdMiddleware, configure_logging
from .modules.accounts import networth as networth_router
from .modules.accounts import router as accounts_router
from .modules.auth.oidc import OidcVerifier
from .modules.billing import router as billing_router
from .modules.equity import router as equity_router
from .modules.goals import router as goals_router
from .modules.health import router as health_router
from .modules.households import router as households_router
from .modules.jobs import maintenance as _maintenance  # noqa: F401 - registers job handler
from .modules.jobs.service import JobContext
from .modules.market_data import router as market_router
from .modules.notifications import router as notifications_router
from .modules.notifications import service as _notifications  # noqa: F401 - registers job handler
from .modules.notifications.push import PushSender, make_push_sender
from .modules.privacy import router as privacy_router
from .modules.reports import router as reports_router
from .modules.reports import service as _reports  # noqa: F401 - registers job handler
from .modules.reports.storage import ArtifactStorage, make_storage
from .modules.scenarios import router as scenarios_router
from .modules.scenarios import service as _scenarios  # noqa: F401 - registers job handler

API_PREFIX = "/v1"

DESCRIPTION = (
    "WealthPilot API v1. Money and quantities are decimal strings; errors are RFC 7807 problem documents. "
    "See docs/api-contract.md."
)


def build_job_context(
    settings: Settings,
    db: Database,
    http: httpx.Client,
    storage: ArtifactStorage | None = None,
    push: PushSender | None = None,
) -> JobContext:
    return JobContext(
        settings=settings,
        db_factory=db,
        services={
            "storage": storage or make_storage(settings),
            "push": push or make_push_sender(settings, http),
            "http": http,
        },
    )


def create_app(
    settings: Settings | None = None,
    *,
    db: Database | None = None,
    http: httpx.Client | None = None,
    storage: ArtifactStorage | None = None,
    push: PushSender | None = None,
    verifier: Any = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    owns_resources = db is None
    db = db or Database(settings.database_url)
    http = http or httpx.Client(
        timeout=settings.fx_reference_timeout_seconds, headers={"User-Agent": f"WealthPilot/{__version__}"}
    )
    job_context = build_job_context(settings, db, http, storage, push)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_resources:
            db.dispose()
            http.close()

    app = FastAPI(
        title="WealthPilot API",
        version=__version__,
        description=DESCRIPTION,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = db
    app.state.http = http
    app.state.verifier = verifier or OidcVerifier(settings, http)
    app.state.job_context = job_context
    app.state.storage = job_context.services["storage"]
    app.state.push = job_context.services["push"]

    install_error_handlers(app)

    v1 = APIRouter(prefix=API_PREFIX)
    for module in (
        households_router,
        privacy_router,
        accounts_router,
        networth_router,
        market_router,
        equity_router,
        goals_router,
        scenarios_router,
        reports_router,
        notifications_router,
        billing_router,
        health_router,
    ):
        v1.include_router(module.router)
    app.include_router(v1)
    app.include_router(health_router.router, include_in_schema=False)  # probes also at the root

    app.add_middleware(IdempotencyMiddleware, prefix=API_PREFIX)
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
            expose_headers=["X-Request-ID", "Idempotent-Replayed"],
        )
    app.add_middleware(RequestIdMiddleware)
    return app


def __getattr__(name: str) -> Any:
    # lazily build the module-level ``app`` so importing this module (tests, OpenAPI export) has no side effects
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
