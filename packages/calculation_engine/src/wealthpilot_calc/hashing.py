"""Canonical JSON and SHA-256 hashing for reproducibility (FR-SCN-002/005, AC-005).

Canonical form: pydantic models dumped in JSON mode, Decimals as plain strings, dates as ISO strings,
object keys sorted, no insignificant whitespace, UTF-8.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from .money import fmt


def _normalise(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return _normalise(obj.model_dump(mode="json"))
    if isinstance(obj, dict):
        return {str(k): _normalise(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [_normalise(v) for v in obj]
    if isinstance(obj, Decimal):
        return fmt(obj)
    if isinstance(obj, float):
        raise TypeError("floats are not allowed in canonical JSON")
    if isinstance(obj, datetime | date):
        return obj.isoformat()
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, Enum):
        return _normalise(obj.value)
    if obj is None or isinstance(obj, str | int | bool):
        return obj
    raise TypeError(f"cannot canonicalise {type(obj).__name__}")


def canonical_json(obj: Any) -> str:
    return json.dumps(_normalise(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(obj: Any) -> str:
    """``"sha256:<hex>"`` of the canonical JSON of ``obj``."""
    return "sha256:" + hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()
