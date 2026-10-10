"""Decimal helpers: calculation context, conversion, quantisation and calendar-month arithmetic.

All money math in this package runs under :data:`CALC_CONTEXT` (40 significant digits, ROUND_HALF_EVEN,
traps for invalid operations / division by zero / overflow). Rounding to 2 dp (money) or 8 dp (rates and
share quantities) happens only at output boundaries via :func:`q_money` / :func:`q_rate` / :func:`q_shares`.
"""

from __future__ import annotations

import calendar
import functools
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import (
    ROUND_DOWN,
    ROUND_HALF_EVEN,
    Context,
    Decimal,
    DivisionByZero,
    InvalidOperation,
    Overflow,
    localcontext,
)
from typing import Any

CALC_CONTEXT = Context(
    prec=40,
    rounding=ROUND_HALF_EVEN,
    Emin=-999999,
    Emax=999999,
    traps=[InvalidOperation, DivisionByZero, Overflow],
)

ZERO = Decimal(0)
ONE = Decimal(1)
HUNDRED = Decimal(100)
TWELVE = Decimal(12)
CENT = Decimal("0.01")
RATE_QUANTUM = Decimal("0.00000001")
SHARE_QUANTUM = RATE_QUANTUM


def calc_context[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    """Run ``fn`` under :data:`CALC_CONTEXT` regardless of the caller's decimal context."""

    @functools.wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        with localcontext(CALC_CONTEXT):
            return fn(*args, **kwargs)

    return wrapper


def to_decimal(value: Any) -> Decimal:
    """Convert ``value`` to Decimal. Floats and bools are rejected: money must never pass through binary floats."""
    if isinstance(value, bool):
        raise TypeError("booleans are not numbers")
    if isinstance(value, float):
        raise TypeError("floats are not accepted for money; pass a decimal string")
    if isinstance(value, Decimal):
        d = value
    elif isinstance(value, int):
        d = Decimal(value)
    elif isinstance(value, str):
        try:
            d = Decimal(value.strip())
        except InvalidOperation as exc:
            raise ValueError(f"not a decimal number: {value!r}") from exc
    else:
        raise TypeError(f"cannot convert {type(value).__name__} to Decimal")
    if not d.is_finite():
        raise ValueError("NaN/Infinity are not allowed")
    return d


def _quantize(value: Decimal, quantum: Decimal, rounding: str = ROUND_HALF_EVEN) -> Decimal:
    with localcontext(CALC_CONTEXT):
        q = value.quantize(quantum, rounding=rounding)
        # normalise negative zero
        return q + ZERO if q == 0 else q


def q_money(value: Decimal) -> Decimal:
    """Round to cents with banker's rounding (output boundary only)."""
    return _quantize(value, CENT)


def q_rate(value: Decimal) -> Decimal:
    return _quantize(value, RATE_QUANTUM)


def q_shares(value: Decimal) -> Decimal:
    return _quantize(value, SHARE_QUANTUM)


def floor_to(value: Decimal, quantum: Decimal) -> Decimal:
    return _quantize(value, quantum, ROUND_DOWN)


def fmt(value: Decimal) -> str:
    """Plain (non-exponent) string form of a Decimal."""
    s = format(value, "f")
    return "0" if s in ("-0", "") else s


@calc_context
def monthly_rate_from_annual(annual: Decimal) -> Decimal:
    """Effective monthly rate equivalent to an effective annual rate: ``(1+a)^(1/12) − 1``."""
    if annual <= -1:
        raise ValueError("annual rate must be greater than -100%")
    if annual == 0:
        return ZERO
    return (ONE + annual) ** (ONE / TWELVE) - ONE


@calc_context
def growth_factor(annual: Decimal, months: int) -> Decimal:
    """``(1+annual)^(months/12)`` computed as an integer power of the monthly factor."""
    if months < 0:
        raise ValueError("months must be non-negative")
    return (ONE + monthly_rate_from_annual(annual)) ** months


def add_months(d: date, months: int) -> date:
    """Calendar month addition with end-of-month clamping (Jan 31 + 1 month = Feb 28/29)."""
    total = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(total, 12)
    month = month0 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def months_between(start: date, end: date) -> int:
    """Whole calendar months from ``start`` to ``end`` (floor; negative if end < start)."""
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if months > 0 and add_months(start, months) > end:
        months -= 1
    elif months < 0 and add_months(start, months) < end:
        months += 1
    return months


def months_until_ceil(start: date, end: date) -> int:
    """Smallest m >= 0 with ``add_months(start, m) >= end``."""
    if end <= start:
        return 0
    m = months_between(start, end)
    if add_months(start, m) < end:
        m += 1
    return m


@dataclass(frozen=True, slots=True)
class Money:
    """A currency-tagged decimal amount. Arithmetic across currencies is refused."""

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "amount", to_decimal(self.amount))
        if len(self.currency) != 3 or not self.currency.isupper():
            raise ValueError("currency must be an ISO 4217 code")

    def _check(self, other: Money) -> None:
        if not isinstance(other, Money):
            raise TypeError("can only combine Money with Money")
        if other.currency != self.currency:
            raise ValueError(f"currency mismatch: {self.currency} vs {other.currency}")

    def __add__(self, other: Money) -> Money:
        self._check(other)
        with localcontext(CALC_CONTEXT):
            return Money(self.amount + other.amount, self.currency)

    def __sub__(self, other: Money) -> Money:
        self._check(other)
        with localcontext(CALC_CONTEXT):
            return Money(self.amount - other.amount, self.currency)

    def scale(self, factor: Decimal) -> Money:
        with localcontext(CALC_CONTEXT):
            return Money(self.amount * to_decimal(factor), self.currency)

    def rounded(self) -> Money:
        return Money(q_money(self.amount), self.currency)

    def __str__(self) -> str:
        return f"{fmt(q_money(self.amount))} {self.currency}"
