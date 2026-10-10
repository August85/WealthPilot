"""RFC 7807 problem documents: ``{type, title, status, detail, code, request_id, errors?}``."""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .request_context import get_request_id

log = logging.getLogger("wealthpilot.errors")

PROBLEM_BASE = "https://docs.wealthpilot.app/problems/"


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        detail: str | None = None,
        *,
        title: str | None = None,
        errors: list[dict[str, Any]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail or code)
        self.status = status
        self.code = code
        self.detail = detail or ""
        self.title = title or HTTPStatus(status).phrase
        self.errors = errors
        self.headers = headers


def not_found(what: str = "Resource") -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{what} not found.")


def problem_response(
    status: int,
    code: str,
    detail: str = "",
    *,
    title: str | None = None,
    errors: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    rid = get_request_id()
    body: dict[str, Any] = {
        "type": PROBLEM_BASE + code.lower().replace("_", "-"),
        "title": title or HTTPStatus(status).phrase,
        "status": status,
        "detail": detail,
        "code": code,
        "request_id": rid,
    }
    if errors is not None:
        body["errors"] = errors
    h = dict(headers or {})
    if rid:
        h["X-Request-ID"] = rid
    return JSONResponse(body, status_code=status, headers=h, media_type="application/problem+json")


def _loc(loc: tuple[Any, ...] | list[Any]) -> list[str | int]:
    return [x if isinstance(x, int | str) else str(x) for x in loc]


def _validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    out = []
    for e in exc.errors():
        msg = str(e.get("msg", "invalid"))
        # never echo submitted values back (they may contain financial data)
        out.append({"loc": _loc(e.get("loc", ())), "msg": msg})
    return out


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return problem_response(
            exc.status, exc.code, exc.detail, title=exc.title, errors=exc.errors, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = _validation_errors(exc)
        code = "VALIDATION_ERROR"
        for e in errors:
            if "NEGATIVE_AMOUNT" in e["msg"]:
                code = "NEGATIVE_AMOUNT"
        return problem_response(422, code, "The request body or parameters are invalid.", errors=errors)

    @app.exception_handler(StaleDataError)
    async def _stale(_: Request, exc: StaleDataError) -> JSONResponse:
        return problem_response(409, "VERSION_CONFLICT", "The resource was modified by another request.")

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 401: "UNAUTHENTICATED"}.get(exc.status_code, "HTTP_ERROR")
        detail = exc.detail if isinstance(exc.detail, str) else ""
        return problem_response(exc.status_code, code, detail, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", extra={"error_type": type(exc).__name__})
        return problem_response(500, "INTERNAL_ERROR", "An unexpected error occurred.")
