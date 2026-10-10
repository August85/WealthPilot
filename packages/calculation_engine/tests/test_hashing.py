from __future__ import annotations

import enum
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest

from wealthpilot_calc import CalcWarning, canonical_hash, canonical_json


class Color(enum.Enum):
    RED = "red"


def test_canonical_json_is_sorted_and_compact():
    assert canonical_json({"b": 1, "a": [Decimal("1.50"), date(2026, 1, 2)]}) == '{"a":["1.50","2026-01-02"],"b":1}'
    assert canonical_json(
        {"u": UUID(int=1), "t": datetime(2026, 1, 1, tzinfo=UTC), "e": Color.RED, "n": None, "x": (True,)}
    ) == ('{"e":"red","n":null,"t":"2026-01-01T00:00:00+00:00","u":"00000000-0000-0000-0000-000000000001","x":[true]}')
    assert (
        canonical_json(CalcWarning(code="X", severity="info", message="m"))
        == '{"code":"X","message":"m","ref_id":null,"ref_type":null,"severity":"info"}'
    )


def test_canonical_hash_format_and_stability():
    h = canonical_hash({"a": Decimal("1")})
    assert h.startswith("sha256:") and len(h) == 7 + 64
    assert h == canonical_hash({"a": Decimal("1")})
    assert h != canonical_hash({"a": Decimal("2")})


def test_canonical_rejects_floats_and_unknown_types():
    with pytest.raises(TypeError):
        canonical_json({"a": 0.1})
    with pytest.raises(TypeError):
        canonical_json({"a": object()})
