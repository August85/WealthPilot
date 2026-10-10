"""Mortgage maths (spec §6.2, FR-HOME-001..006).

``Payment = P × r × (1+r)^n / ((1+r)^n − 1)`` with ``r = APR/12``; ``Payment = P/n`` when ``r = 0``.
``AllInMonthly = Payment + property_tax/12 + insurance/12 + HOA + PMI + maintenance/12 + utilities``.
``CashToClose = down payment + closing costs + prepaid costs − credits``; the emergency reserve is a
separate required balance, not a closing expense.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import CENT, ONE, TWELVE, ZERO, calc_context, q_money, to_decimal

LTV_PMI_THRESHOLD = Decimal("0.80")


@calc_context
def mortgage_payment(principal: Decimal, annual_rate: Decimal, n_months: int) -> Decimal:
    """Unrounded monthly principal-and-interest payment."""
    p = to_decimal(principal)
    apr = to_decimal(annual_rate)
    if n_months <= 0:
        raise ValueError("n_months must be positive")
    if p < 0:
        raise ValueError("principal must be non-negative")
    if apr < 0:
        raise ValueError("annual rate must be non-negative")
    if p == 0:
        return ZERO
    r = apr / TWELVE
    if r == 0:
        return p / Decimal(n_months)
    growth = (ONE + r) ** n_months
    return p * r * growth / (growth - ONE)


@dataclass(frozen=True, slots=True)
class AmortizationRow:
    period: int
    payment: Decimal
    interest: Decimal
    principal: Decimal
    balance: Decimal


@calc_context
def amortization_schedule(principal: Decimal, annual_rate: Decimal, n_months: int) -> list[AmortizationRow]:
    """Cent-rounded amortisation schedule: payment rounded to cents, interest rounded each month,
    final payment adjusted so the balance ends at exactly 0.00."""
    p = q_money(to_decimal(principal))
    r = to_decimal(annual_rate) / TWELVE
    pay = q_money(mortgage_payment(p, to_decimal(annual_rate), n_months))
    rows: list[AmortizationRow] = []
    bal = p
    for k in range(1, n_months + 1):
        interest = q_money(bal * r)
        if k == n_months or pay >= bal + interest:
            payment = bal + interest
            principal_part = bal
            bal = ZERO
            rows.append(AmortizationRow(k, q_money(payment), interest, q_money(principal_part), q_money(bal)))
            break
        principal_part = pay - interest
        bal = bal - principal_part
        rows.append(AmortizationRow(k, pay, interest, q_money(principal_part), q_money(bal)))
    return rows


@calc_context
def balance_after(principal: Decimal, annual_rate: Decimal, n_months: int, k: int) -> Decimal:
    """Unrounded remaining balance after ``k`` level payments."""
    p = to_decimal(principal)
    r = to_decimal(annual_rate) / TWELVE
    pay = mortgage_payment(p, to_decimal(annual_rate), n_months)
    if k >= n_months:
        return ZERO
    if r == 0:
        return max(ZERO, p - pay * k)
    g = (ONE + r) ** k
    return max(ZERO, p * g - pay * (g - ONE) / r)


@dataclass(frozen=True, slots=True)
class HousingCostBreakdown:
    principal_interest: Decimal
    property_tax: Decimal
    insurance: Decimal
    hoa: Decimal
    pmi: Decimal
    maintenance: Decimal
    utilities: Decimal

    @property
    def total(self) -> Decimal:
        return (
            self.principal_interest
            + self.property_tax
            + self.insurance
            + self.hoa
            + self.pmi
            + self.maintenance
            + self.utilities
        )

    def rounded(self) -> HousingCostBreakdown:
        return HousingCostBreakdown(
            *(
                q_money(v)
                for v in (
                    self.principal_interest,
                    self.property_tax,
                    self.insurance,
                    self.hoa,
                    self.pmi,
                    self.maintenance,
                    self.utilities,
                )
            )
        )


@calc_context
def pmi_applies(loan_balance: Decimal, price: Decimal) -> bool:
    """PMI applies only while loan-to-value is above 80%."""
    price = to_decimal(price)
    if price <= 0:
        return False
    return to_decimal(loan_balance) / price > LTV_PMI_THRESHOLD


@calc_context
def monthly_pmi(original_principal: Decimal, current_balance: Decimal, price: Decimal, pmi_rate: Decimal) -> Decimal:
    """PMI on the original loan amount while LTV (current balance / price) > 80%."""
    if not pmi_applies(current_balance, price):
        return ZERO
    return to_decimal(original_principal) * to_decimal(pmi_rate) / TWELVE


@calc_context
def all_in_monthly(
    *,
    price: Decimal,
    down_payment_pct: Decimal,
    annual_rate: Decimal,
    term_years: int,
    property_tax_rate_annual: Decimal = ZERO,
    insurance_annual: Decimal = ZERO,
    hoa_monthly: Decimal = ZERO,
    pmi_rate_annual: Decimal = ZERO,
    maintenance_pct_annual: Decimal = ZERO,
    utilities_monthly: Decimal = ZERO,
) -> HousingCostBreakdown:
    """Unrounded first-month all-in housing cost. Call ``.rounded()`` at the output boundary; the
    rounded total is the sum of the rounded components so it reconciles on screen."""
    price = to_decimal(price)
    principal = loan_principal(price, to_decimal(down_payment_pct))
    pi = mortgage_payment(principal, to_decimal(annual_rate), term_years * 12)
    return HousingCostBreakdown(
        principal_interest=pi,
        property_tax=price * to_decimal(property_tax_rate_annual) / TWELVE,
        insurance=to_decimal(insurance_annual) / TWELVE,
        hoa=to_decimal(hoa_monthly),
        pmi=monthly_pmi(principal, principal, price, to_decimal(pmi_rate_annual)),
        maintenance=price * to_decimal(maintenance_pct_annual) / TWELVE,
        utilities=to_decimal(utilities_monthly),
    )


@calc_context
def down_payment(price: Decimal, down_payment_pct: Decimal) -> Decimal:
    pct = to_decimal(down_payment_pct)
    if not (ZERO <= pct <= ONE):
        raise ValueError("down_payment_pct must be within [0, 1]")
    return to_decimal(price) * pct


@calc_context
def loan_principal(price: Decimal, down_payment_pct: Decimal) -> Decimal:
    """Loan amount = price − down payment (a $1,000,000 home with 20% down borrows $800,000)."""
    return to_decimal(price) - down_payment(price, down_payment_pct)


@calc_context
def cash_to_close(
    price: Decimal,
    down_payment_pct: Decimal,
    closing_cost_pct: Decimal = ZERO,
    prepaid_costs: Decimal = ZERO,
    credits: Decimal = ZERO,
) -> Decimal:
    """down payment + closing costs + prepaid costs − verified credits (floored at 0)."""
    total = (
        down_payment(price, down_payment_pct)
        + to_decimal(price) * to_decimal(closing_cost_pct)
        + to_decimal(prepaid_costs)
        - to_decimal(credits)
    )
    return max(ZERO, total)


__all__ = [
    "CENT",
    "LTV_PMI_THRESHOLD",
    "AmortizationRow",
    "HousingCostBreakdown",
    "all_in_monthly",
    "amortization_schedule",
    "balance_after",
    "cash_to_close",
    "down_payment",
    "loan_principal",
    "monthly_pmi",
    "mortgage_payment",
    "pmi_applies",
]
