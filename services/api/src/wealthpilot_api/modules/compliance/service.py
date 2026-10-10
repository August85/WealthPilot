"""Security audit log helper (FR-ID-005). Metadata is restricted to non-sensitive keys: never amounts,
balances, names or free text."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditEvent

SAFE_META_KEYS = {
    "fields",
    "format",
    "scope",
    "kind",
    "type",
    "reason",
    "entitlement",
    "previous_entitlement",
    "count",
    "source",
    "status",
    "erase_after",
    "provider",
}


def _redact(meta: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in meta.items():
        if k not in SAFE_META_KEYS:
            continue
        if isinstance(v, list):
            out[k] = [str(x) for x in v]
        elif isinstance(v, bool | int | str) or v is None:
            out[k] = v
        else:
            out[k] = str(v)
    return out


def audit(
    db: Session,
    action: str,
    *,
    actor_id: uuid.UUID | None,
    household_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    **meta: Any,
) -> AuditEvent:
    ev = AuditEvent(
        actor_id=actor_id,
        household_id=household_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        metadata_redacted=_redact(meta),
    )
    db.add(ev)
    return ev
