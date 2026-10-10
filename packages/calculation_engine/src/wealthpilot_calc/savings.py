"""Monthly savings projection (spec §6.3).

Timing convention (END OF MONTH): each month the *opening* balance grows by the monthly-equivalent rate
``(1+annual)^(1/12) − 1``; contributions, withdrawals, fees and taxes are then applied at month end, so a
contribution earns nothing in the month it is made::

    closing = opening × (1 + r_m) + contribution − withdrawal − fees − taxes

Use either nominal returns with nominal flows, or real returns with real flows — never both. A
withdrawal larger than the available balance is capped and the unmet part reported as ``shortfall``
(the balance never silently goes negative).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from .money import ONE, ZERO, calc_context, monthly_rate_from_annual, to_decimal


@dataclass(frozen=True, slots=True)
class SavingsRow:
    month: int
    opening: Decimal
    growth: Decimal
    contribution: Decimal
    withdrawal: Decimal
    fees: Decimal
    taxes: Decimal
    closing: Decimal
    shortfall: Decimal


def _at(seq: Decimal | Sequence[Decimal], i: int) -> Decimal:
    if isinstance(seq, Decimal | int | str):
        return to_decimal(seq)
    return to_decimal(seq[i]) if i < len(seq) else ZERO


@calc_context
def project_savings(
    *,
    opening_balance: Decimal,
    annual_return: Decimal,
    months: int,
    monthly_contribution: Decimal | Sequence[Decimal] = ZERO,
    monthly_withdrawal: Decimal | Sequence[Decimal] = ZERO,
    monthly_fees: Decimal | Sequence[Decimal] = ZERO,
    monthly_taxes: Decimal | Sequence[Decimal] = ZERO,
) -> list[SavingsRow]:
    rm = monthly_rate_from_annual(to_decimal(annual_return))
    bal = to_decimal(opening_balance)
    rows: list[SavingsRow] = []
    for i in range(months):
        opening = bal
        growth = opening * rm if opening > 0 else ZERO  # no growth credited on a negative/zero balance
        contrib = _at(monthly_contribution, i)
        outflow_req = _at(monthly_withdrawal, i)
        fees = _at(monthly_fees, i)
        taxes = _at(monthly_taxes, i)
        available = opening + growth + contrib - fees - taxes
        withdrawal = min(outflow_req, max(available, ZERO))
        shortfall = outflow_req - withdrawal
        closing = available - withdrawal
        rows.append(SavingsRow(i + 1, opening, growth, contrib, withdrawal, fees, taxes, closing, shortfall))
        bal = closing
    return rows


@calc_context
def future_value_end_of_month(
    opening: Decimal, monthly_contribution: Decimal, annual_return: Decimal, months: int
) -> Decimal:
    """Closed form for the end-of-month convention: ``B·g^n + C·(g^n − 1)/(g − 1)`` with ``g = 1 + r_m``."""
    g = ONE + monthly_rate_from_annual(to_decimal(annual_return))
    b = to_decimal(opening)
    c = to_decimal(monthly_contribution)
    if g == ONE:
        return b + c * months
    gn = g**months
    return b * gn + c * (gn - ONE) / (g - ONE)
