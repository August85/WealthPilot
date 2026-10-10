"""Liveness and readiness probes (no auth)."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: str


@router.get("/healthz", response_model=Health)
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", response_model=Health, responses={503: {"model": Health}})
def readyz(request: Request) -> JSONResponse:
    try:
        with request.app.state.db.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok"})
