"""Indian EPF accrual (spec §6.5, FR-RET-004/005).

Rates are user inputs. Two accrual conventions are supported:

* ``annual_credit`` (default): interest accrues monthly at ``rate/12`` on the credited balance (opening
  balance plus contributions so far) and is credited once every 12 months; uncredited interest does not
  compound until credited.
* ``monthly_compound``: interest at ``rate/12`` is credited every month.

Contributions are made at month end (they earn nothing in the month they are made).
Accessibility is never inferred from account age: it is gated only by the user-set ``accessible_from_age``;
``None`` means never accessible and raises ``EPF_ACCESS_UNVERIFIED``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import CalcWarning
from .money import TWELVE, ZERO, calc_context, to_decimal

EPF_ACCESS_UNVERIFIED_MESSAGE = (
    "EPF withdrawal eligibility and taxation are not verified. The projection does not treat EPF as "
    "accessible unless you set an age from which it is accessible. Verify with EPFO or a qualified "
    "professional."
)


@dataclass(slots=True)
class EpfState:
    balance: Decimal
    uncredited_interest: Decimal = ZERO
    months_since_credit: int = 0

    @property
    def value(self) -> Decimal:
        """Balance including interest accrued but not yet credited."""
        return self.balance + self.uncredited_interest


@calc_context
def epf_step(state: EpfState, annual_rate: Decimal, contribution: Decimal, convention: str) -> EpfState:
    """Advance one month."""
    r = to_decimal(annual_rate) / TWELVE
    interest = state.balance * r
    if convention == "monthly_compound":
        return EpfState(state.balance + interest + to_decimal(contribution), ZERO, 0)
    if convention != "annual_credit":
        raise ValueError(f"unknown EPF accrual convention {convention!r}")
    uncredited = state.uncredited_interest + interest
    months = state.months_since_credit + 1
    balance = state.balance + to_decimal(contribution)
    if months == 12:
        return EpfState(balance + uncredited, ZERO, 0)
    return EpfState(balance, uncredited, months)


@calc_context
def epf_project(
    opening_balance: Decimal,
    monthly_contribution: Decimal,
    annual_rate: Decimal,
    months: int,
    convention: str = "annual_credit",
) -> list[Decimal]:
    """Values (incl. accrued interest) at the end of months 0..months."""
    state = EpfState(to_decimal(opening_balance))
    out = [state.value]
    for _ in range(months):
        state = epf_step(state, annual_rate, monthly_contribution, convention)
        out.append(state.value)
    return out


def epf_accessible(age: Decimal, accessible_from_age: Decimal | None) -> bool:
    if accessible_from_age is None:
        return False
    return to_decimal(age) >= to_decimal(accessible_from_age)


def epf_access_warnings(accessible_from_age: Decimal | None, ref_id: str | None = None) -> list[CalcWarning]:
    if accessible_from_age is None:
        return [
            CalcWarning(
                code="EPF_ACCESS_UNVERIFIED",
                severity="warning",
                message=EPF_ACCESS_UNVERIFIED_MESSAGE,
                ref_type="account" if ref_id else None,
                ref_id=ref_id,
            )
        ]
    return [
        CalcWarning(
            code="EPF_ACCESS_UNVERIFIED",
            severity="info",
            message=(
                "EPF is treated as accessible from the age you entered. This is your assumption, not an "
                "eligibility determination; verify withdrawal rules and taxation with a professional."
            ),
            ref_type="account" if ref_id else None,
            ref_id=ref_id,
        )
    ]


__all__ = ["EpfState", "epf_access_warnings", "epf_accessible", "epf_project", "epf_step"]
