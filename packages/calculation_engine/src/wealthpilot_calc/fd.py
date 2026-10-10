"""Fixed deposits (spec §6.5, FR-RET-006). Compounding and TDS are explicit per deposit.

Convention: whole compounding periods are counted in calendar months from ``start_date``
(monthly = 1, quarterly = 3, half_yearly = 6, annually = 12 months) and compound at ``rate/k``; any
remaining days after the last whole period earn simple interest at ``rate × days/365``.
``at_maturity`` pays simple interest ``P × rate × days/365`` with no compounding.
TDS is illustrative: ``tds_rate × total interest``, deducted at maturity.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .money import ONE, ZERO, add_months, calc_context, to_decimal

PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "annually": 12}
DAYS_IN_YEAR = Decimal(365)


@calc_context
def fd_value_at(
    principal: Decimal,
    start_date: date,
    annual_rate: Decimal,
    compounding: str,
    on: date,
    maturity_date: date | None = None,
) -> Decimal:
    """Gross accrued value (before TDS) on ``on`` (capped at ``maturity_date``)."""
    p = to_decimal(principal)
    r = to_decimal(annual_rate)
    if p < 0:
        raise ValueError("principal must be non-negative")
    if r < 0:
        raise ValueError("rate must be non-negative")
    end = min(on, maturity_date) if maturity_date else on
    if end <= start_date:
        return p
    if compounding == "at_maturity":
        days = Decimal((end - start_date).days)
        return p * (ONE + r * days / DAYS_IN_YEAR)
    try:
        step = PERIOD_MONTHS[compounding]
    except KeyError as exc:
        raise ValueError(f"unknown compounding {compounding!r}") from exc
    k = Decimal(12 // step)
    n = 0
    while add_months(start_date, (n + 1) * step) <= end:
        n += 1
    value = p * (ONE + r / k) ** n
    last = add_months(start_date, n * step)
    rem_days = Decimal((end - last).days)
    if rem_days > 0:
        value = value * (ONE + r * rem_days / DAYS_IN_YEAR)
    return value


@dataclass(frozen=True, slots=True)
class FdMaturity:
    gross_maturity_value: Decimal
    interest: Decimal
    tds: Decimal
    net_maturity_value: Decimal


@calc_context
def fd_maturity(
    principal: Decimal,
    start_date: date,
    maturity_date: date,
    annual_rate: Decimal,
    compounding: str,
    tds_rate: Decimal = ZERO,
) -> FdMaturity:
    if maturity_date < start_date:
        raise ValueError("maturity_date must not precede start_date")
    gross = fd_value_at(principal, start_date, annual_rate, compounding, maturity_date, maturity_date)
    interest = gross - to_decimal(principal)
    tds = interest * to_decimal(tds_rate)
    return FdMaturity(gross, interest, tds, gross - tds)
