from __future__ import annotations

import copy
from typing import Any

import pytest

from wealthpilot_calc import HouseholdSnapshot, ScenarioAssumptions
from wealthpilot_calc.samples import apply_variant, seed_assumptions_dict, seed_snapshot_dict


def build(
    assumptions: dict[str, Any] | None = None, snapshot: dict[str, Any] | None = None, **changes: Any
) -> tuple[ScenarioAssumptions, HouseholdSnapshot]:
    a = copy.deepcopy(assumptions or seed_assumptions_dict())
    a = apply_variant(a, {k.replace("__", "."): v for k, v in changes.items()})
    return ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(snapshot or seed_snapshot_dict())


def minimal_assumptions(**over: Any) -> dict[str, Any]:
    """A small household with everything optional switched off."""
    a = {
        "base_date": "2026-01-01",
        "reporting_currency": "USD",
        "horizon_years": 10,
        "household": {"current_age": 40, "retirement_age": 45, "life_expectancy": 50},
        "income": {
            "salary_annual": "0",
            "bonus_annual": "0",
            "currency": "USD",
            "salary_growth_annual": "0",
            "effective_tax_rate": "0",
            "living_expenses_monthly": "0",
            "expense_currency": "USD",
        },
        "returns": {
            "us_portfolio_annual": "0",
            "india_portfolio_annual": "0",
            "cash_annual": "0",
            "real_estate_annual": "0",
        },
        "inflation": {"us_annual": "0", "india_annual": "0"},
        "fx": {"usd_inr_start": "85", "inr_depreciation_annual": "0", "transfer_cost_pct": "0"},
        "rsu": None,
        "retirement_401k": None,
        "epf": None,
        "retirement": {"location": "US", "spending_monthly_today": "0", "withdrawal_tax_rate": "0"},
        "home": None,
    }
    return apply_variant(a, over)


def account(
    id_: str,
    type_: str,
    amount: str,
    *,
    kind: str = "asset",
    currency: str = "USD",
    country: str = "US",
    accessibility: str | None = None,
    goal_eligible: bool | None = None,
    **extra: Any,
) -> dict[str, Any]:
    from wealthpilot_calc.fields import DEFAULT_ACCESSIBILITY

    acc = accessibility or (DEFAULT_ACCESSIBILITY.get(type_, "liquid") if kind == "asset" else "liquid")
    d = {
        "id": id_,
        "name": id_,
        "kind": kind,
        "type": type_,
        "country": country,
        "currency": currency,
        "amount": amount,
        "accessibility": acc,
        "goal_eligible": acc == "liquid" if goal_eligible is None else goal_eligible,
        "ownership_pct": "100",
        "details": {},
        "verification_status": "verified",
        "valuation_as_of": "2026-01-01",
    }
    d.update(extra)
    return d


def snapshot(accounts: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    s: dict[str, Any] = {
        "as_of": "2026-01-01",
        "accounts": accounts,
        "rsu_grants": [],
        "prices": {},
        "fx": {"USD/INR": {"rate": "85", "as_of": "2026-01-01", "kind": "user"}},
    }
    s.update(extra)
    return s


@pytest.fixture
def seed() -> tuple[ScenarioAssumptions, HouseholdSnapshot]:
    return build()
