"""Request ID propagation + structured, PII-free access logging."""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_VALID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

access_log = logging.getLogger("wealthpilot.access")


def get_request_id() -> str | None:
    return _request_id.get()


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Only whitelisted, non-sensitive attributes are emitted."""

    SAFE_EXTRAS = (
        "request_id",
        "method",
        "route",
        "status",
        "duration_ms",
        "job_id",
        "job_type",
        "error_type",
        "attempt",
        "count",
        "requeued",
        "processed",
    )

    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None) or get_request_id(),
        }
        for k in self.SAFE_EXTRAS:
            if k != "request_id" and hasattr(record, k):
                data[k] = getattr(record, k)
        if record.exc_info and record.exc_info[0] is not None:
            data["exc_type"] = record.exc_info[0].__name__
        return json.dumps(data)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        root.setLevel(level)
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(level)
    # outbound request URLs are not useful in logs and should never accumulate user identifiers
    logging.getLogger("httpx").setLevel(logging.WARNING)


class RequestIdMiddleware:
    """Pure ASGI middleware: accept a sane incoming X-Request-ID or mint one, expose it on every response,
    and log method, route template, status and duration (never bodies, query strings or headers)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = None
        for k, v in scope.get("headers", []):
            if k == b"x-request-id":
                incoming = v.decode("latin-1")
                break
        rid = incoming if incoming and _VALID.match(incoming) else str(uuid.uuid4())
        token = _request_id.set(rid)
        start = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                headers.append((b"x-request-id", rid.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = scope.get("route")
            access_log.info(
                "request",
                extra={
                    "request_id": rid,
                    "method": scope.get("method"),
                    "route": getattr(route, "path", None) or "unmatched",
                    "status": status_holder["status"],
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
            _request_id.reset(token)
