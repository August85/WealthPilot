"""401(k) contributions (FR-RET-001/002). Limits are user-entered inputs; no IRS limits are hard-coded.

* employee contribution = min(requested, contribution_limit_annual) when a limit is given;
* employer match = match_rate × min(employee contribution, match_up_to_pct_of_salary × salary);
* the employee contribution is split pre-tax / Roth by ``employee_roth_pct``; the employer match is
  always pre-tax. Pre-tax and Roth amounts are never merged.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import ONE, ZERO, calc_context, to_decimal


@dataclass(frozen=True, slots=True)
class Contributions401k:
    employee_requested: Decimal
    employee_total: Decimal
    employee_pretax: Decimal
    employee_roth: Decimal
    employer_match: Decimal
    capped: bool

    @property
    def pretax_total(self) -> Decimal:
        return self.employee_pretax + self.employer_match

    @property
    def roth_total(self) -> Decimal:
        return self.employee_roth

    @property
    def total(self) -> Decimal:
        return self.employee_total + self.employer_match


@calc_context
def contributions_401k(
    *,
    salary_annual: Decimal,
    employee_contribution_annual: Decimal,
    employer_match_rate: Decimal = ZERO,
    match_up_to_pct_of_salary: Decimal = ZERO,
    contribution_limit_annual: Decimal | None = None,
    employee_roth_pct: Decimal = ZERO,
) -> Contributions401k:
    salary = to_decimal(salary_annual)
    requested = to_decimal(employee_contribution_annual)
    if salary < 0 or requested < 0:
        raise ValueError("salary and contribution must be non-negative")
    employee = requested
    capped = False
    if contribution_limit_annual is not None:
        limit = to_decimal(contribution_limit_annual)
        if employee > limit:
            employee = limit
            capped = True
    roth_pct = to_decimal(employee_roth_pct)
    if not ZERO <= roth_pct <= ONE:
        raise ValueError("employee_roth_pct must be within [0, 1]")
    roth = employee * roth_pct
    pretax = employee - roth
    match_base = min(employee, salary * to_decimal(match_up_to_pct_of_salary))
    match = to_decimal(employer_match_rate) * match_base
    return Contributions401k(requested, employee, pretax, roth, match, capped)
