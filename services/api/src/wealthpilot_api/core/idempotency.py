"""``Idempotency-Key`` support for mutating POSTs (contract conventions).

Pure ASGI middleware. For a POST under ``/v1`` carrying ``Idempotency-Key``:

1. The caller is identified from the bearer token (keys are scoped per ``sub``; unauthenticated requests pass
   straight through and fail auth as usual).
2. A pending row ``(subject, key)`` is inserted atomically. If it already exists:
   * same request (method + path + body hash) and a stored response → the original response is replayed with
     ``Idempotent-Replayed: true``;
   * same request still in flight → 409 ``IDEMPOTENCY_IN_PROGRESS``;
   * different request → 422 ``IDEMPOTENCY_KEY_REUSED``.
3. Responses with status < 500 are stored; server errors release the key so the client can retry.

Keys are purged after 24 hours by the daily maintenance job.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..modules.auth.oidc import parse_dev_token
from ..modules.jobs.models import IdempotencyKey
from .errors import ApiError, problem_response

log = logging.getLogger("wealthpilot.idempotency")

EXCLUDED_SUFFIXES = ("/billing/revenuecat/webhook",)
MAX_KEY_LEN = 255


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers", []):
        if k.lower() == name:
            return v.decode("latin-1")
    return None


class IdempotencyMiddleware:
    def __init__(self, app: ASGIApp, prefix: str = "/v1") -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return
        key = _header(scope, b"idempotency-key")
        path: str = scope.get("path", "")
        if key is None or not path.startswith(self.prefix) or path.endswith(EXCLUDED_SUFFIXES):
            await self.app(scope, receive, send)
            return
        if not key or len(key) > MAX_KEY_LEN:
            await problem_response(422, "VALIDATION_ERROR", "Idempotency-Key must be 1-255 characters.")(
                scope, receive, send
            )
            return

        body = b""
        more = True
        while more:
            msg = await receive()
            body += msg.get("body", b"")
            more = msg.get("more_body", False)

        replayed = False

        async def replay_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        app_state = scope["app"].state
        subject = await run_in_threadpool(_subject, app_state, scope)
        if subject is None:
            await self.app(scope, replay_receive, send)
            return

        query = scope.get("query_string", b"")
        req_hash = hashlib.sha256(b"POST\n" + path.encode() + b"?" + query + b"\n" + body).hexdigest()
        outcome = await run_in_threadpool(_reserve, app_state.db, subject, key, path, req_hash)
        if outcome is not None:
            await outcome(scope, replay_receive, send)
            return

        captured: dict[str, Any] = {"status": 500, "headers": [], "body": b""}

        async def capture_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
                captured["headers"] = message.get("headers", [])
            elif message["type"] == "http.response.body":
                captured["body"] += message.get("body", b"")
            await send(message)

        try:
            await self.app(scope, replay_receive, capture_send)
        except Exception:
            await run_in_threadpool(_release, app_state.db, subject, key)
            raise
        if captured["status"] >= 500:
            await run_in_threadpool(_release, app_state.db, subject, key)
            return
        ctype = next(
            (v.decode("latin-1") for k, v in captured["headers"] if k.lower() == b"content-type"), "application/json"
        )
        await run_in_threadpool(_store, app_state.db, subject, key, captured["status"], captured["body"], ctype)


def _subject(state: Any, scope: Scope) -> str | None:
    header = _header(scope, b"authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    try:
        if state.settings.auth_mode == "dev":
            p = parse_dev_token(token)
            if p is not None:
                return p.subject
        return state.verifier.verify(token).subject
    except ApiError:
        return None


def _reserve(db: Any, subject: str, key: str, path: str, req_hash: str) -> Any:
    with db.session() as s:
        inserted = s.execute(
            insert(IdempotencyKey)
            .values(id=uuid.uuid4(), subject=subject, key=key, method="POST", path=path, request_hash=req_hash)
            .on_conflict_do_nothing(index_elements=["subject", "key"])
            .returning(IdempotencyKey.id)
        ).scalar_one_or_none()
        s.commit()
        if inserted is not None:
            return None
        row = s.scalar(select(IdempotencyKey).where(IdempotencyKey.subject == subject, IdempotencyKey.key == key))
        if row is None:  # released concurrently; let the client retry
            return problem_response(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this key is in progress.")
        if row.request_hash != req_hash or row.path != path:
            return problem_response(
                422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request."
            )
        if row.status_code is None:
            return problem_response(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this key is still in progress.")
        return Response(
            content=(row.response_body or "").encode("utf-8"),
            status_code=row.status_code,
            media_type=row.content_type,
            headers={"Idempotent-Replayed": "true"},
        )


def _store(db: Any, subject: str, key: str, status: int, body: bytes, ctype: str) -> None:
    with db.session() as s:
        s.execute(
            update(IdempotencyKey)
            .where(IdempotencyKey.subject == subject, IdempotencyKey.key == key)
            .values(status_code=status, response_body=body.decode("utf-8", errors="replace"), content_type=ctype)
        )
        s.commit()


def _release(db: Any, subject: str, key: str) -> None:
    with db.session() as s:
        s.execute(
            delete(IdempotencyKey).where(
                IdempotencyKey.subject == subject, IdempotencyKey.key == key, IdempotencyKey.status_code.is_(None)
            )
        )
        s.commit()
