"""Deterministic scenario runs (spec §6, FR-SCN-*): yearly projection, home planner with stress tests,
retirement accumulation/decumulation, one-variable sensitivity, explanations and a reproducible checksum."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from .hashing import canonical_hash
from .models import (
    AllInMonthly,
    Explanation,
    FundingPoint,
    HomeResult,
    HouseholdSnapshot,
    RunMetrics,
    RunResult,
    ScenarioAssumptions,
    StressRow,
    WarningSink,
    YearlyRow,
)
from .money import (
    TWELVE,
    ZERO,
    add_months,
    calc_context,
    fmt,
    growth_factor,
    q_money,
    q_rate,
)
from .mortgage import all_in_monthly, cash_to_close
from .sensitivity import SENSITIVITY_VARIABLES, sensitivity_table
from .simulation import SimOverrides, Simulation

MODEL_VERSION = "1.0.0"
RULEPACK_VERSION = "none-1"


def input_hash(assumptions: ScenarioAssumptions, snapshot: HouseholdSnapshot) -> str:
    return canonical_hash(
        {
            "assumptions": assumptions,
            "snapshot": snapshot,
            "model_version": MODEL_VERSION,
            "rulepack_version": RULEPACK_VERSION,
        }
    )


def result_checksum(result: RunResult) -> str:
    """Hash of the canonical result body excluding ``run_id``, ``seed`` and ``checksum``."""
    body = result.model_dump(mode="json", exclude={"run_id", "checksum", "seed"})
    return canonical_hash(body)


def simulate(
    a: ScenarioAssumptions,
    s: HouseholdSnapshot,
    warnings: WarningSink | None = None,
    overrides: SimOverrides | None = None,
) -> Simulation:
    return Simulation(a, s, warnings if warnings is not None else WarningSink(), overrides).run()


def _m(v: Decimal | None) -> Decimal | None:
    return None if v is None else q_money(v)


def _breakdown(a: ScenarioAssumptions, price: Decimal | None = None, rate: Decimal | None = None) -> Any:
    h = a.home
    assert h is not None
    return all_in_monthly(
        price=price if price is not None else h.target_price,
        down_payment_pct=h.down_payment_pct,
        annual_rate=rate if rate is not None else h.mortgage_rate_annual,
        term_years=h.term_years,
        property_tax_rate_annual=h.property_tax_rate_annual,
        insurance_annual=h.insurance_annual,
        hoa_monthly=h.hoa_monthly,
        pmi_rate_annual=h.pmi_rate_annual,
        maintenance_pct_annual=h.maintenance_pct_annual,
        utilities_monthly=h.utilities_monthly,
    ).rounded()


def _with(a: ScenarioAssumptions, path: str, value: Any) -> ScenarioAssumptions:
    data = a.model_dump(mode="python")
    node = data
    parts = path.split(".")
    for p in parts[:-1]:
        node = node[p]
    node[parts[-1]] = value
    return ScenarioAssumptions.model_validate(data)


def _gap_at_target(sim: Simulation) -> Decimal | None:
    h = sim.home
    if h is None or h.available_at_target is None:
        return None
    return max(ZERO, h.required - h.available_at_target)


def _stress(a: ScenarioAssumptions, s: HouseholdSnapshot, sim: Simulation) -> list[StressRow]:
    h = a.home
    home = sim.home
    assert h is not None and home is not None
    base = _breakdown(a)
    base_gap = _gap_at_target(sim)
    avail = home.available_at_target
    rows: list[StressRow] = []

    def row(label: str, bd: Any, gap: Decimal | None) -> None:
        rows.append(
            StressRow(
                label=label,
                pi_monthly=bd.principal_interest,
                all_in_monthly=bd.total,
                funding_gap=q_money(gap if gap is not None else ZERO),
            )
        )

    for delta, label in (
        (Decimal("0.01"), "Rate +1pp"),
        (Decimal("0.02"), "Rate +2pp"),
        (Decimal("-0.01"), "Rate −1pp"),
        (Decimal("-0.02"), "Rate −2pp"),
    ):
        row(label, _breakdown(a, rate=max(ZERO, h.mortgage_rate_annual + delta)), base_gap)
    for factor, label in ((Decimal("1.10"), "Price +10%"), (Decimal("0.90"), "Price −10%")):
        price = h.target_price * factor
        required = (
            cash_to_close(price, h.down_payment_pct, h.closing_cost_pct, h.prepaid_costs, h.credits)
            + h.emergency_reserve
        )
        gap = None if avail is None else max(ZERO, required - avail)
        row(label, _breakdown(a, price=price), gap)
    stop = home.target_month
    scenarios: list[tuple[str, ScenarioAssumptions, SimOverrides]] = [
        ("RSU price −30%", a, SimOverrides(rsu_price_factor=Decimal("0.70"), stop_month=stop)),
        ("INR −10%", _with(a, "fx.usd_inr_start", a.fx.usd_inr_start / Decimal("0.90")), SimOverrides(stop_month=stop)),
        ("Savings −20%", a, SimOverrides(savings_multiplier=Decimal("0.80"), stop_month=stop)),
    ]
    for label, aa, ov in scenarios:
        stressed = simulate(aa, s, WarningSink(), ov)
        row(label, base, _gap_at_target(stressed))
    return rows


@calc_context
def run_scenario(assumptions: ScenarioAssumptions, snapshot: HouseholdSnapshot, seed: int | None = None) -> RunResult:
    """Run the deterministic projection. ``seed`` is recorded but unused (no stochastic component in 1.0.0)."""
    a, s = assumptions, snapshot
    warnings = WarningSink()
    warnings.add(
        "ILLUSTRATIVE_TAX",
        "info",
        "All tax figures use the illustrative rates you entered (no tax rules are applied). This is not tax advice.",
    )
    sim = simulate(a, s, warnings)
    rep = a.reporting_currency
    infl_rep = a.inflation.us_annual if rep == "USD" else a.inflation.india_annual
    cur_age = a.household.current_age

    yearly: list[YearlyRow] = []
    for i in range(a.horizon_years):
        start, end = 12 * i + 1, 12 * (i + 1)
        p = sim.points[end]
        fl = sim.flows[start : end + 1]
        defl = growth_factor(infl_rep, end)
        yearly.append(
            YearlyRow(
                year=add_months(a.base_date, end).year,
                age=cur_age + i + 1,
                net_worth=q_money(p.net_worth),
                net_worth_real=q_money(p.net_worth / defl),
                liquid=q_money(p.liquid),
                us_assets=q_money(p.us_assets),
                india_assets=q_money(p.india_assets),
                retirement_balance=q_money(p.retirement),
                retirement_balance_real=q_money(p.retirement / defl),
                income=q_money(sum((x.income for x in fl), ZERO)),
                expenses=q_money(sum((x.expenses for x in fl), ZERO)),
                savings=q_money(sum((x.savings for x in fl), ZERO)),
                rsu_net_proceeds=q_money(sum((x.rsu_net for x in fl), ZERO)),
                withdrawals=q_money(sum((x.withdrawals for x in fl), ZERO)),
                deficit=q_money(sum((x.deficit for x in fl), ZERO)),
                housing_cost=q_money(sum((x.housing for x in fl), ZERO)),
                usd_inr=q_rate(p.usd_inr),
            )
        )

    deficit_rows = [r for r in yearly if r.deficit > 0]
    first_deficit_age = deficit_rows[0].age if deficit_rows else None
    if deficit_rows:
        assert first_deficit_age is not None
        if first_deficit_age > a.household.retirement_age:
            warnings.add(
                "RETIREMENT_DEFICIT",
                "critical",
                f"Projected spending exceeds accessible funds from age {first_deficit_age} in "
                f"{len(deficit_rows)} year(s). Review spending, retirement age or return assumptions.",
            )
        else:
            warnings.add(
                "CASH_FLOW_DEFICIT",
                "warning",
                f"Projected expenses exceed income and accessible savings from age {first_deficit_age}.",
            )
    negative = [r for r in yearly if r.net_worth < 0]
    if negative:
        warnings.add("NEGATIVE_BALANCE", "warning", f"Projected net worth is negative from {negative[0].year}.")

    p0 = sim.points[0]
    m_ret = max(0, sim.m_ret)
    nw_ret = ret_bal = ending = None
    if m_ret <= sim.N:
        nw_ret = sim.points[m_ret].net_worth
        ret_bal = sim.points[m_ret].retirement
    else:
        warnings.add("HORIZON_SHORT", "info", "Retirement age is beyond the projection horizon.")
    if sim.m_le <= sim.N:
        ending = sim.points[sim.m_le].investable
    else:
        warnings.add(
            "HORIZON_SHORT",
            "info",
            "Life expectancy is beyond the projection horizon; ending balance is not reported.",
            "metric",
            "ending_balance_at_life_expectancy",
        )

    metrics = RunMetrics(
        net_worth_now=q_money(p0.net_worth),
        liquid_net_worth_now=q_money(p0.liquid),
        net_worth_at_retirement=_m(nw_ret),
        retirement_balance_at_retirement=_m(ret_bal),
        ending_balance_at_life_expectancy=_m(ending),
        first_deficit_age=first_deficit_age,
        years_in_deficit=len(deficit_rows),
    )
    explanations: list[Explanation] = [
        Explanation(
            metric="net_worth_now",
            formula="Σ asset × ownership × FX(native→reporting) − Σ liability × ownership × FX",
            inputs={
                "gross_assets": fmt(q_money(p0.assets)),
                "liabilities": fmt(q_money(p0.liabilities)),
                "usd_inr": fmt(a.fx.usd_inr_start),
            },
            result=fmt(metrics.net_worth_now),
        ),
        Explanation(
            metric="liquid_net_worth_now",
            formula="Σ liquid assets − liabilities not secured by property (unvested RSUs, retirement, EPF, FDs "
            "and property excluded)",
            inputs={"liquid_assets_less_unsecured_debt": fmt(q_money(p0.liquid))},
            result=fmt(metrics.liquid_net_worth_now),
        ),
        Explanation(
            metric="retirement_balance_at_retirement",
            formula="ClosingPortfolio(t) = OpeningPortfolio(t) × (1 + r_m) + contributions(t) − withdrawals(t) "
            "(end-of-month), summed over 401(k), IRA, HSA, EPF and PPF at retirement age",
            inputs={
                "retirement_age": str(a.household.retirement_age),
                "us_portfolio_annual": fmt(a.returns.us_portfolio_annual),
                "india_portfolio_annual": fmt(a.returns.india_portfolio_annual),
            },
            result=fmt(metrics.retirement_balance_at_retirement)
            if metrics.retirement_balance_at_retirement is not None
            else None,
        ),
        Explanation(
            metric="ending_balance_at_life_expectancy",
            formula="Investable assets (all except property and illiquid assets) at life expectancy after "
            "spending, healthcare and withdrawal taxes",
            inputs={
                "life_expectancy": str(a.household.life_expectancy),
                "spending_monthly_today": fmt(a.retirement.spending_monthly_today),
                "healthcare_monthly_today": fmt(a.retirement.healthcare_monthly_today),
                "withdrawal_tax_rate": fmt(a.retirement.withdrawal_tax_rate),
            },
            result=fmt(metrics.ending_balance_at_life_expectancy)
            if metrics.ending_balance_at_life_expectancy is not None
            else None,
        ),
        Explanation(
            metric="first_deficit_age",
            formula="First projection year in which spending cannot be met from income and accessible accounts",
            inputs={"years_in_deficit": str(len(deficit_rows))},
            result=None if first_deficit_age is None else str(first_deficit_age),
        ),
    ]

    home_result: HomeResult | None = None
    if a.home is not None and a.home.enabled and sim.home is not None:
        h, ht = a.home, sim.home
        bd = _breakdown(a)
        mt = ht.target_month
        conv_m = min(mt, len(sim.points) - 1)

        def to_rep(v: Decimal) -> Decimal:
            return sim.conv(v, ht.currency, rep, conv_m)

        avail = ht.available_at_target
        gap = None if avail is None else max(ZERO, ht.required - avail)
        if avail is None:
            pass
        elif gap and gap > 0:
            if ht.purchased_month is not None:
                warnings.add(
                    "HOME_FUNDING_GAP",
                    "warning",
                    f"Goal-eligible funds fall short of cash needed at the target date; the projection "
                    f"assumes purchase in {add_months(a.base_date, ht.purchased_month).isoformat()}, the "
                    f"first month funds are sufficient.",
                )
            else:
                warnings.add(
                    "HOME_FUNDING_GAP",
                    "critical",
                    "Goal-eligible funds never reach the cash needed within the horizon; the projection "
                    "assumes no purchase.",
                )
        earliest = ht.earliest_feasible_month
        metrics.home_cash_needed = q_money(to_rep(ht.required))
        metrics.home_cash_available_at_purchase = _m(None if avail is None else to_rep(avail))
        metrics.home_funding_gap = _m(None if gap is None else to_rep(gap))
        metrics.home_earliest_feasible_date = None if earliest is None else add_months(a.base_date, earliest)
        metrics.home_pi_monthly = q_money(to_rep(bd.principal_interest))
        metrics.home_all_in_monthly = q_money(to_rep(bd.total))
        metrics.rsu_net_proceeds_to_purchase = q_money(sim.rsu_net_to_target)
        r_m = h.mortgage_rate_annual / TWELVE
        explanations += [
            Explanation(
                metric="home_pi_monthly",
                formula="P × r × (1+r)^n / ((1+r)^n − 1); P / n when r = 0",
                inputs={"P": fmt(q_money(ht.principal)), "r": fmt(q_rate(r_m)), "n": str(h.term_years * 12)},
                result=fmt(bd.principal_interest),
            ),
            Explanation(
                metric="home_all_in_monthly",
                formula="P&I + property_tax/12 + insurance/12 + HOA + PMI + maintenance/12 + utilities",
                inputs={
                    "principal_interest": fmt(bd.principal_interest),
                    "property_tax": fmt(bd.property_tax),
                    "insurance": fmt(bd.insurance),
                    "hoa": fmt(bd.hoa),
                    "pmi": fmt(bd.pmi),
                    "maintenance": fmt(bd.maintenance),
                    "utilities": fmt(bd.utilities),
                },
                result=fmt(bd.total),
            ),
            Explanation(
                metric="home_cash_needed",
                formula="down payment + closing costs + prepaid costs − credits + emergency reserve",
                inputs={
                    "down_payment": fmt(q_money(ht.down)),
                    "closing_costs": fmt(q_money(ht.closing)),
                    "prepaid_costs": fmt(q_money(h.prepaid_costs)),
                    "credits": fmt(q_money(h.credits)),
                    "emergency_reserve": fmt(q_money(h.emergency_reserve)),
                },
                result=fmt(q_money(ht.required)),
            ),
        ]
        stress = _stress(a, s, sim)
        home_result = HomeResult(
            purchase_date=h.purchase_date,
            actual_purchase_date=None if ht.purchased_month is None else add_months(a.base_date, ht.purchased_month),
            currency=ht.currency,
            price=q_money(h.target_price),
            down_payment=q_money(ht.down),
            loan_principal=q_money(ht.principal),
            closing_costs=q_money(ht.closing),
            prepaid_costs=q_money(h.prepaid_costs),
            credits=q_money(h.credits),
            cash_to_close=q_money(ht.cash_to_close),
            emergency_reserve=q_money(h.emergency_reserve),
            total_cash_needed=q_money(ht.required),
            pi_monthly=bd.principal_interest,
            all_in_monthly=AllInMonthly(
                principal_interest=bd.principal_interest,
                property_tax=bd.property_tax,
                insurance=bd.insurance,
                hoa=bd.hoa,
                pmi=bd.pmi,
                maintenance=bd.maintenance,
                utilities=bd.utilities,
                total=bd.total,
            ),
            funding_timeline=[
                FundingPoint(month=add_months(a.base_date, m), available=q_money(v), required=q_money(ht.required))
                for m, v in ht.timeline
            ],
            stress=stress,
        )

    end_metric = "ending_balance_at_life_expectancy" if ending is not None else "net_worth_at_horizon"
    metric_names = [end_metric, "net_worth_at_retirement"] if nw_ret is not None else [end_metric]

    def metrics_of(run: Simulation) -> dict[str, Decimal | None]:
        out: dict[str, Decimal | None] = {}
        out[end_metric] = (
            run.points[run.m_le].investable
            if end_metric == "ending_balance_at_life_expectancy"
            else run.points[-1].net_worth
        )
        if nw_ret is not None:
            out["net_worth_at_retirement"] = run.points[max(0, run.m_ret)].net_worth
        return out

    sens = sensitivity_table(
        a,
        metric_names,
        base_values=metrics_of(sim),
        evaluate=lambda aa: metrics_of(simulate(aa, s, WarningSink())),
        with_value=_with,
        variables=[v for v in SENSITIVITY_VARIABLES if a.rsu is not None or not v[0].startswith("rsu.")],
    )

    result = RunResult(
        model_version=MODEL_VERSION,
        rulepack_version=RULEPACK_VERSION,
        currency=rep,
        base_date=a.base_date,
        seed=seed,
        input_hash=input_hash(a, s),
        metrics=metrics,
        yearly=yearly,
        home=home_result,
        sensitivity=sens,
        explanations=explanations,
        warnings=warnings.items,
    )
    result.checksum = result_checksum(result)
    return result


__all__ = ["MODEL_VERSION", "RULEPACK_VERSION", "input_hash", "result_checksum", "run_scenario", "simulate"]
