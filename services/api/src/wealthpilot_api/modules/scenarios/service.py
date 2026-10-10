"""Scenario defaults, household snapshot capture and the run job handler."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from wealthpilot_calc import (
    MODEL_VERSION,
    HouseholdSnapshot,
    ScenarioAssumptions,
    add_months,
    q_rate,
    run_scenario,
)
from wealthpilot_calc.money import fmt

from ...core.errors import ApiError
from ..accounts.service import (
    active_accounts,
    active_grants,
    grant_position,
    latest_prices,
    latest_user_fx,
    latest_valuations,
)
from ..goals.models import Goal
from ..jobs.service import JobContext, register
from ..market_data.models import FxRate
from .models import ScenarioVersion, SimulationRun

D = Decimal

# Illustrative, editable starting points (spec §9.1/contract example). None of these are market facts.
ILLUSTRATIVE = {
    "returns": {
        "us_portfolio_annual": "0.06",
        "india_portfolio_annual": "0.08",
        "cash_annual": "0.02",
        "real_estate_annual": "0.03",
    },
    "inflation": {"us_annual": "0.025", "india_annual": "0.05"},
    "home": {
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
        "emergency_reserve": "0",
    },
}


def _s(d: Decimal) -> str:
    return fmt(d.normalize()) if d != 0 else "0"


def today() -> date:
    return datetime.now(UTC).date()


def user_usd_inr(db: Session, hid: uuid.UUID) -> Decimal | None:
    r = db.scalar(
        select(FxRate)
        .where(
            FxRate.household_id == hid,
            FxRate.kind == "user",
            or_(
                (FxRate.base_currency == "USD") & (FxRate.quote_currency == "INR"),
                (FxRate.base_currency == "INR") & (FxRate.quote_currency == "USD"),
            ),
        )
        .order_by(FxRate.as_of.desc(), FxRate.created_at.desc())
        .limit(1)
    )
    if r is None:
        return None
    return r.rate if r.base_currency == "USD" else q_rate(D(1) / r.rate)


def _shift(d: dict[str, Any], key: str, delta: str, floor: Decimal | None = None) -> None:
    v = D(str(d[key])) + D(delta)
    if floor is not None:
        v = max(v, floor)
    d[key] = _s(v)


def apply_preset(a: dict[str, Any], preset: str) -> dict[str, Any]:
    if preset == "conservative":
        _shift(a["returns"], "us_portfolio_annual", "-0.02", D("-0.99"))
        _shift(a["returns"], "india_portfolio_annual", "-0.02", D("-0.99"))
        _shift(a["inflation"], "us_annual", "0.01")
        _shift(a["inflation"], "india_annual", "0.01")
        _shift(a["fx"], "inr_depreciation_annual", "0.01")
        if a.get("rsu"):
            _shift(a["rsu"], "price_growth_annual", "-0.10", D("-0.99"))
        if a.get("home"):
            _shift(a["home"], "mortgage_rate_annual", "0.01", D(0))
    elif preset == "optimistic":
        _shift(a["returns"], "us_portfolio_annual", "0.01")
        _shift(a["returns"], "india_portfolio_annual", "0.01")
        _shift(a["fx"], "inr_depreciation_annual", "-0.01", D("-0.99"))
        if a.get("rsu"):
            _shift(a["rsu"], "price_growth_annual", "0.05")
    return a


def build_defaults(db: Session, hid: uuid.UUID, reporting_currency: str, preset: str, kind: str) -> dict[str, Any]:
    rate = user_usd_inr(db, hid)
    if rate is None:
        raise ApiError(
            422,
            "FX_RATE_MISSING",
            "Save the USD/INR rate you want to plan with (POST /v1/fx/rates) before creating scenarios.",
        )
    base = today()
    accounts = active_accounts(db, hid)
    k401 = next((a for a in accounts if a.type == "retirement_401k"), None)
    epf = next((a for a in accounts if a.type == "epf"), None)
    grants = [g for g in active_grants(db, hid) if g.status == "active"]
    prices = latest_prices(db, hid)
    rc = reporting_currency if reporting_currency in ("USD", "INR") else "USD"

    a: dict[str, Any] = {
        "base_date": base.isoformat(),
        "reporting_currency": rc,
        "horizon_years": 55,
        # placeholders: the household's ages are not stored; the client must confirm them
        "household": {"current_age": 35, "retirement_age": 65, "life_expectancy": 90},
        "income": {
            "salary_annual": "0",
            "bonus_annual": "0",
            "currency": "USD",
            "salary_growth_annual": "0.03",
            "effective_tax_rate": "0",
            "living_expenses_monthly": "0",
            "expense_currency": "USD",
        },
        "returns": dict(ILLUSTRATIVE["returns"]),
        "inflation": dict(ILLUSTRATIVE["inflation"]),
        "fx": {"usd_inr_start": _s(rate), "inr_depreciation_annual": "0.02", "transfer_cost_pct": "0.01"},
        "rsu": None,
        "retirement_401k": None,
        "epf": None,
        "retirement": {
            "location": "US",
            "spending_monthly_today": "0",
            "healthcare_monthly_today": "0",
            "healthcare_inflation_annual": "0.05",
            "social_security_monthly_today": "0",
            "social_security_start_age": None,
            "withdrawal_order": ["taxable", "india", "tax_deferred", "roth"],
            "withdrawal_tax_rate": "0",
        },
        "home": None,
    }
    if k401 is not None:
        d = k401.details or {}
        a["retirement_401k"] = {
            "employee_contribution_annual": d.get("employee_contribution_annual", "0"),
            "employer_match_rate": d.get("employer_match_rate", "0"),
            "match_up_to_pct_of_salary": d.get("employer_match_up_to_pct_of_salary", "0"),
            "contribution_limit_annual": d.get("contribution_limit_annual"),
            "access_age": d.get("access_age", "59.5"),
            "employee_roth_pct": d.get("employee_roth_pct", "0"),
        }
    if epf is not None:
        d = epf.details or {}
        monthly = D(d.get("monthly_employee_contribution", "0")) + D(d.get("monthly_employer_contribution", "0"))
        a["epf"] = {
            "interest_rate_annual": d.get("interest_rate_annual", "0"),
            "monthly_contribution": _s(monthly),
            "accessible_from_age": None,
        }
    if grants:
        g = grants[0]
        p = prices.get(g.symbol)
        a["rsu"] = {
            "price_now": _s(p.price) if p else None,
            "price_growth_annual": "0",
            "strategy": "sell_on_vest",
            "sell_fraction": "0.5",
            "withholding_rate": _s(g.default_withholding_rate) if g.default_withholding_rate is not None else "0",
            "additional_tax_rate": "0",
            "annual_refresh_value": "0",
        }
    if kind == "home":
        goal = db.scalar(
            select(Goal)
            .where(Goal.household_id == hid, Goal.type == "home_purchase", Goal.deleted_at.is_(None))
            .order_by(Goal.priority, Goal.created_at)
        )
        if goal is not None and goal.target_amount > 0:
            a["home"] = {
                "enabled": True,
                "target_price": _s(goal.target_amount),
                "currency": goal.currency if goal.currency in ("USD", "INR") else "USD",
                "purchase_date": (goal.target_date or add_months(base, 60)).isoformat(),
                **ILLUSTRATIVE["home"],
                "funding_sources": {"us_cash": True, "brokerage": True, "rsu_proceeds": True, "india_liquid": False},
            }
    apply_preset(a, preset)
    return ScenarioAssumptions.model_validate(a).model_dump(mode="json")


def capture_snapshot(db: Session, hid: uuid.UUID) -> dict[str, Any]:
    """HouseholdSnapshot of current canonical records (spec §8.4 step 3)."""
    as_of = today()
    accounts = active_accounts(db, hid)
    vals = latest_valuations(db, hid)
    acc = []
    for a in accounts:
        v = vals.get(a.id)
        acc.append(
            {
                "id": str(a.id),
                "name": a.name,
                "kind": a.kind,
                "type": a.type,
                "country": a.country,
                "currency": a.currency,
                "amount": v.amount if v else None,
                "accessibility": a.accessibility,
                "goal_eligible": a.goal_eligible,
                "include_in_net_worth": a.include_in_net_worth,
                "ownership_pct": a.ownership_pct,
                "details": a.details or {},
                "verification_status": v.verification_status if v else None,
                "valuation_as_of": v.as_of if v else None,
            }
        )
    grants = []
    for g in active_grants(db, hid):
        if g.status != "active":
            continue
        held, _ = grant_position(g)
        grants.append(
            {
                "id": str(g.id),
                "symbol": g.symbol,
                "employer_name": g.employer_name,
                "award_currency": g.award_currency,
                "held_in_account_id": str(g.held_in_account_id) if g.held_in_account_id else None,
                "default_withholding_rate": g.default_withholding_rate,
                "held_shares": held,
                "vests": [
                    {"vest_date": v.vest_date, "scheduled_shares": v.scheduled_shares, "status": v.status}
                    for v in g.vests
                ],
            }
        )
    prices = {
        s: {"price": p.price, "currency": p.currency, "as_of": p.as_of} for s, p in latest_prices(db, hid).items()
    }
    fx = {
        f"{r.base_currency}/{r.quote_currency}": {"rate": r.rate, "as_of": r.as_of, "kind": r.kind}
        for r in latest_user_fx(db, hid)
    }
    snap = HouseholdSnapshot.model_validate(
        {"as_of": as_of, "accounts": acc, "rsu_grants": grants, "prices": prices, "fx": fx}
    )
    return snap.model_dump(mode="json")


# ------------------------------------------------------------------------------------------- job handler
def _run_failed(db: Session, payload: dict[str, Any], ctx: JobContext, err: str) -> None:
    run = db.get(SimulationRun, uuid.UUID(payload["run_id"]))
    if run is not None and run.status != "completed":
        run.status = "failed"
        run.error = f"Calculation failed ({err})."
        run.completed_at = datetime.now(UTC)


def _run_retry(db: Session, payload: dict[str, Any], ctx: JobContext, err: str) -> None:
    run = db.get(SimulationRun, uuid.UUID(payload["run_id"]))
    if run is not None and run.status == "running":
        run.status = "queued"


@register("scenario_run", on_failure=_run_failed, on_retry=_run_retry)
def handle_scenario_run(db: Session, payload: dict[str, Any], ctx: JobContext) -> None:
    run = db.get(SimulationRun, uuid.UUID(payload["run_id"]), with_for_update=True)
    if run is None or run.status == "completed":
        return  # idempotent
    run.status = "running"
    run.started_at = datetime.now(UTC)
    db.flush()
    version = db.get(ScenarioVersion, run.scenario_version_id)
    assert version is not None
    a = ScenarioAssumptions.model_validate(version.assumptions)
    s = HouseholdSnapshot.model_validate(version.snapshot)
    result = run_scenario(a, s, seed=run.seed)
    result.run_id = str(run.id)
    run.result = result.model_dump(mode="json")
    run.checksum = result.checksum
    run.model_version = MODEL_VERSION
    run.status = "completed"
    run.completed_at = datetime.now(UTC)
    run.error = None
