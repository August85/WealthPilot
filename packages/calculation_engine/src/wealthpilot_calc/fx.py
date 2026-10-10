"""FX conversion with explicit direction.

A rate quoted ``BASE/QUOTE = r`` means 1 unit of BASE buys ``r`` units of QUOTE (e.g. USD/INR = 85).
Converting BASE→QUOTE multiplies by ``r``; QUOTE→BASE divides by ``r``. No rounding happens here.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .money import ONE, ZERO, calc_context, growth_factor, to_decimal


class FxRateMissing(LookupError):
    def __init__(self, from_ccy: str, to_ccy: str) -> None:
        super().__init__(f"no FX rate available for {from_ccy}->{to_ccy}")
        self.from_ccy = from_ccy
        self.to_ccy = to_ccy


@dataclass(frozen=True, slots=True)
class Rate:
    base: str
    quote: str
    rate: Decimal
    as_of: date | None = None

    def __post_init__(self) -> None:
        r = to_decimal(self.rate)
        if r <= 0:
            raise ValueError("FX rate must be positive")
        object.__setattr__(self, "rate", r)
        if self.base == self.quote:
            raise ValueError("base and quote must differ")


@calc_context
def convert(amount: Decimal, from_ccy: str, to_ccy: str, rate: Rate) -> Decimal:
    """Convert ``amount`` from ``from_ccy`` to ``to_ccy`` using a single quoted rate in either direction."""
    amount = to_decimal(amount)
    if from_ccy == to_ccy:
        return amount
    if rate.base == from_ccy and rate.quote == to_ccy:
        return amount * rate.rate
    if rate.base == to_ccy and rate.quote == from_ccy:
        return amount / rate.rate
    raise FxRateMissing(from_ccy, to_ccy)


@calc_context
def inverse(rate: Rate) -> Rate:
    """The reverse quote: QUOTE/BASE = 1 / r."""
    return Rate(base=rate.quote, quote=rate.base, rate=ONE / rate.rate, as_of=rate.as_of)


class FxTable:
    """Lookup of the latest rate per currency pair, usable in either direction. Picks the most recent
    ``as_of``; on ties the first rate supplied wins (callers pass their preferred quote first)."""

    def __init__(self, rates: Iterable[Rate]) -> None:
        self._rates: dict[frozenset[str], Rate] = {}
        for r in rates:
            key = frozenset((r.base, r.quote))
            cur = self._rates.get(key)
            if cur is None or (r.as_of or date.min) > (cur.as_of or date.min):
                self._rates[key] = r

    def find(self, from_ccy: str, to_ccy: str) -> Rate | None:
        if from_ccy == to_ccy:
            return None
        return self._rates.get(frozenset((from_ccy, to_ccy)))

    def convert(self, amount: Decimal, from_ccy: str, to_ccy: str) -> Decimal:
        if from_ccy == to_ccy:
            return to_decimal(amount)
        r = self.find(from_ccy, to_ccy)
        if r is None:
            raise FxRateMissing(from_ccy, to_ccy)
        return convert(amount, from_ccy, to_ccy, r)

    def has(self, from_ccy: str, to_ccy: str) -> bool:
        return from_ccy == to_ccy or self.find(from_ccy, to_ccy) is not None

    def rates(self) -> list[Rate]:
        return list(self._rates.values())


@calc_context
def usd_inr_at_month(start: Decimal, inr_depreciation_annual: Decimal, month: int) -> Decimal:
    """INR per USD after ``month`` months: ``start × (1+dep)^(month/12)`` (positive dep = INR weakens)."""
    start = to_decimal(start)
    if start <= ZERO:
        raise ValueError("start rate must be positive")
    return start * growth_factor(to_decimal(inr_depreciation_annual), month)


@calc_context
def usd_inr_path(start: Decimal, inr_depreciation_annual: Decimal, months: int) -> list[Decimal]:
    """Monthly INR-per-USD path for months 0..months inclusive."""
    return [usd_inr_at_month(start, inr_depreciation_annual, m) for m in range(months + 1)]


@calc_context
def convert_usd_inr(amount: Decimal, from_ccy: str, to_ccy: str, inr_per_usd: Decimal) -> Decimal:
    """Convert between USD and INR at an INR-per-USD rate."""
    return convert(amount, from_ccy, to_ccy, Rate("USD", "INR", inr_per_usd))
