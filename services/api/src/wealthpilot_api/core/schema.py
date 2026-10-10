"""Shared API schema types: decimals as strings (never floats), pagination."""

from __future__ import annotations

import base64
import json
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer
from wealthpilot_calc.fields import coerce_decimal as _coerce_decimal
from wealthpilot_calc.money import CENT, fmt

from .errors import ApiError


def money_str(d: Decimal) -> str:
    """Money: at least 2 dp, more only when the stored value carries them (e.g. 12.3456 for a price)."""
    n = d.normalize()
    if n == 0:
        return "0.00"
    if -n.as_tuple().exponent <= 2:  # type: ignore[operator]
        return fmt(d.quantize(CENT))
    return fmt(n)


def qty_str(d: Decimal) -> str:
    """Quantities, rates and percentages: no forced decimals (400, 0.37, 12.5)."""
    n = d.normalize()
    if n == 0:
        return "0"
    return fmt(n)


_money = PlainSerializer(money_str, return_type=str, when_used="json")
_qty = PlainSerializer(qty_str, return_type=str, when_used="json")
_dec = BeforeValidator(_coerce_decimal)

# JSON output is always a decimal string; Python-side (model_dump) values stay Decimal.
Money = Annotated[Decimal, _dec, _money]
NonNegMoney = Annotated[Decimal, _dec, Field(ge=0), _money]
Qty = Annotated[Decimal, _dec, _qty]
NonNegQty = Annotated[Decimal, _dec, Field(ge=0), _qty]
Rate = Annotated[Decimal, _dec, Field(ge=0, le=1), _qty]
Pct = Annotated[Decimal, _dec, Field(ge=0, le=100), _qty]
CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$", examples=["USD"])]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


class OutModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None


class ItemList[T](BaseModel):
    items: list[T]


def encode_cursor(created_at: datetime, id_: Any) -> str:
    raw = json.dumps([created_at.isoformat(), str(id_)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        pad = "=" * (-len(cursor) % 4)
        ts, id_ = json.loads(base64.urlsafe_b64decode(cursor + pad))
        return datetime.fromisoformat(ts), str(id_)
    except Exception as exc:
        raise ApiError(422, "INVALID_CURSOR", "The pagination cursor is invalid.") from exc
