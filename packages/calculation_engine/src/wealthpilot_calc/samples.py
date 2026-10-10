"""SYNTHETIC sample data (spec §16) for tests, demos and the dev seed script.

Everything here is a fictional test fixture — NOT market estimates, tax rules or recommendations. The FX
rate, prices, returns and tax rates are labelled synthetic and exist only so calculations can be exercised.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from .models import HouseholdSnapshot, ScenarioAssumptions

SYNTHETIC_LABEL = "SYNTHETIC TEST DATA — fictional household (spec §16), not real data or market estimates"

SEED_BASE_DATE = date(2026, 10, 1)
SEED_USD_INR = Decimal("85.00")  # synthetic planning rate
SEED_ACME_PRICE = Decimal("180.00")  # synthetic price


def seed_vests(start: date = date(2026, 12, 15), quarters: int = 16, shares: str = "139") -> list[dict[str, Any]]:
    """Quarterly future vests worth roughly $100k/year at the synthetic price."""
    from .money import add_months

    return [
        {"vest_date": add_months(start, 3 * i).isoformat(), "scheduled_shares": shares, "status": "scheduled"}
        for i in range(quarters)
    ]


def seed_snapshot_dict() -> dict[str, Any]:
    as_of = SEED_BASE_DATE.isoformat()
    return {
        "as_of": as_of,
        "accounts": [
            {
                "id": "seed-us-cash",
                "name": "US cash (synthetic)",
                "kind": "asset",
                "type": "savings",
                "country": "US",
                "currency": "USD",
                "amount": "60000",
                "accessibility": "liquid",
                "goal_eligible": True,
                "ownership_pct": "100",
                "details": {},
                "verification_status": "verified",
                "valuation_as_of": as_of,
            },
            {
                "id": "seed-401k",
                "name": "401(k) (synthetic)",
                "kind": "asset",
                "type": "retirement_401k",
                "country": "US",
                "currency": "USD",
                "amount": "75000",
                "accessibility": "restricted",
                "goal_eligible": False,
                "ownership_pct": "100",
                "details": {"pretax_balance": "75000", "roth_balance": "0", "access_age": "59.5"},
                "verification_status": "verified",
                "valuation_as_of": as_of,
            },
            {
                "id": "seed-epf",
                "name": "EPF (synthetic)",
                "kind": "asset",
                "type": "epf",
                "country": "IN",
                "currency": "INR",
                "amount": "3500000",
                "accessibility": "restricted",
                "goal_eligible": False,
                "ownership_pct": "100",
                "details": {"interest_rate_annual": "0.0825", "access_status": "unknown"},
                "verification_status": "estimated",
                "valuation_as_of": as_of,
            },
            {
                "id": "seed-fd",
                "name": "Fixed deposit (synthetic)",
                "kind": "asset",
                "type": "fixed_deposit",
                "country": "IN",
                "currency": "INR",
                "amount": "2000000",
                "accessibility": "restricted",
                "goal_eligible": False,
                "ownership_pct": "100",
                "details": {
                    "principal": "2000000",
                    "start_date": "2026-10-01",
                    "maturity_date": "2029-10-01",
                    "interest_rate_annual": "0.07",
                    "compounding": "quarterly",
                    "tds_rate": "0.10",
                },
                "verification_status": "verified",
                "valuation_as_of": as_of,
            },
        ],
        "rsu_grants": [
            {
                "id": "seed-grant",
                "symbol": "ACME",
                "employer_name": "Acme Corp (fictional)",
                "award_currency": "USD",
                "held_in_account_id": None,
                "default_withholding_rate": "0.37",
                "held_shares": "0",
                "vests": seed_vests(),
            },
        ],
        "prices": {"ACME": {"price": str(SEED_ACME_PRICE), "currency": "USD", "as_of": as_of}},
        "fx": {"USD/INR": {"rate": str(SEED_USD_INR), "as_of": as_of, "kind": "user"}},
    }


def seed_assumptions_dict() -> dict[str, Any]:
    return {
        "base_date": SEED_BASE_DATE.isoformat(),
        "reporting_currency": "USD",
        "horizon_years": 51,
        "household": {"current_age": 41, "retirement_age": 60, "life_expectancy": 92},
        "income": {
            "salary_annual": "270000",
            "bonus_annual": "40000",
            "currency": "USD",
            "salary_growth_annual": "0.03",
            "effective_tax_rate": "0.32",
            "living_expenses_monthly": "9000",
            "expense_currency": "USD",
        },
        "returns": {
            "us_portfolio_annual": "0.06",
            "india_portfolio_annual": "0.08",
            "cash_annual": "0.02",
            "real_estate_annual": "0.03",
        },
        "inflation": {"us_annual": "0.025", "india_annual": "0.05"},
        "fx": {"usd_inr_start": "85.00", "inr_depreciation_annual": "0.02", "transfer_cost_pct": "0.01"},
        "rsu": {
            "price_now": "180.00",
            "price_growth_annual": "0.05",
            "strategy": "sell_on_vest",
            "sell_fraction": "0.5",
            "withholding_rate": "0.37",
            "additional_tax_rate": "0.05",
            "annual_refresh_value": "0",
        },
        "retirement_401k": {
            "employee_contribution_annual": "24000",
            "employer_match_rate": "0.5",
            "match_up_to_pct_of_salary": "0.06",
            "contribution_limit_annual": "24000",
            "access_age": "59.5",
        },
        "epf": {"interest_rate_annual": "0.0825", "monthly_contribution": "0", "accessible_from_age": None},
        "retirement": {
            "location": "US",
            "spending_monthly_today": "8000",
            "healthcare_monthly_today": "1200",
            "healthcare_inflation_annual": "0.05",
            "social_security_monthly_today": "0",
            "social_security_start_age": 67,
            "withdrawal_order": ["taxable", "india", "tax_deferred", "roth"],
            "withdrawal_tax_rate": "0.15",
        },
        "home": {
            "enabled": True,
            "target_price": "1300000",
            "currency": "USD",
            "purchase_date": "2030-10-01",
            "down_payment_pct": "0.20",
            "closing_cost_pct": "0.03",
            "prepaid_costs": "0",
            "credits": "0",
            "mortgage_rate_annual": "0.0625",
            "term_years": 30,
            "property_tax_rate_annual": "0.011",
            "insurance_annual": "2400",
            "hoa_monthly": "0",
            "pmi_rate_annual": "0.006",
            "maintenance_pct_annual": "0.01",
            "utilities_monthly": "400",
            "emergency_reserve": "40000",
            "funding_sources": {"us_cash": True, "brokerage": True, "rsu_proceeds": True, "india_liquid": False},
        },
    }


def seed_snapshot() -> HouseholdSnapshot:
    return HouseholdSnapshot.model_validate(seed_snapshot_dict())


def seed_assumptions() -> ScenarioAssumptions:
    return ScenarioAssumptions.model_validate(seed_assumptions_dict())


# Spec §16 scenario variants (relative to the baseline above)
SEED_SCENARIO_VARIANTS: dict[str, dict[str, Any]] = {
    "Baseline": {},
    "Employer stock −35%": {"rsu.price_now": "117.00"},
    "INR depreciation +5%/year": {"fx.inr_depreciation_annual": "0.05"},
    "Delayed home purchase +2 years": {"home.purchase_date": "2032-10-01"},
}


def apply_variant(data: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    import copy

    out = copy.deepcopy(data)
    for path, value in changes.items():
        node = out
        parts = path.split(".")
        for p in parts[:-1]:
            node = node[p]
        node[parts[-1]] = value
    return out
