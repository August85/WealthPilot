"""run_scenario: seed household invariants, AC-003/AC-005, edge cases (zero rates, missing inputs, deficits)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from wealthpilot_calc import (
    MODEL_VERSION,
    RULEPACK_VERSION,
    HouseholdSnapshot,
    NetWorthInput,
    ScenarioAssumptions,
    canonical_hash,
    compute_net_worth,
    run_scenario,
)
from wealthpilot_calc.samples import (
    SEED_SCENARIO_VARIANTS,
    SYNTHETIC_LABEL,
    apply_variant,
    seed_assumptions_dict,
    seed_snapshot_dict,
)
from wealthpilot_calc.scenario import result_checksum, simulate

from .conftest import account, build, minimal_assumptions, snapshot

D = Decimal


def codes(result) -> set[str]:
    return {w.code for w in result.warnings}


# ------------------------------------------------------------------------------------------- seed household
def test_seed_household_full_run_invariants(seed):
    a, s = seed
    r = run_scenario(a, s)
    assert "SYNTHETIC" in SYNTHETIC_LABEL
    assert r.model_version == MODEL_VERSION == "1.0.0"
    assert r.rulepack_version == RULEPACK_VERSION == "none-1"
    assert r.status == "completed" and r.currency == "USD" and r.base_date == date(2026, 10, 1)
    assert r.input_hash.startswith("sha256:") and r.checksum.startswith("sha256:")
    assert len(r.yearly) == a.horizon_years
    assert [y.age for y in r.yearly[:2]] == [42, 43]
    assert r.yearly[0].year == 2027

    # net worth now = 60,000 + 75,000 + 3,500,000/85 + 2,000,000/85 (unvested RSUs excluded)
    assert r.metrics.net_worth_now == D("199705.88")
    assert r.metrics.liquid_net_worth_now == D("60000.00")
    nw = compute_net_worth(
        NetWorthInput.model_validate(
            {
                "as_of": "2026-10-01",
                "currency": "USD",
                "accounts": seed_snapshot_dict()["accounts"],
                "fx": [{"base": "USD", "quote": "INR", "rate": "85", "as_of": "2026-10-01"}],
            }
        )
    )
    assert nw.net_worth == r.metrics.net_worth_now
    assert nw.liquid_net_worth == r.metrics.liquid_net_worth_now

    # home: $1.3M, 20% down → principal 1,040,000; cash to close 260,000 + 39,000; + 40,000 reserve
    h = r.home
    assert h is not None
    assert (h.price, h.down_payment, h.loan_principal) == (D("1300000.00"), D("260000.00"), D("1040000.00"))
    assert (h.closing_costs, h.cash_to_close, h.emergency_reserve, h.total_cash_needed) == (
        D("39000.00"),
        D("299000.00"),
        D("40000.00"),
        D("339000.00"),
    )
    assert h.pi_monthly == D("6403.46") == r.metrics.home_pi_monthly
    assert h.all_in_monthly.total == D("9278.46") == r.metrics.home_all_in_monthly
    parts = h.all_in_monthly
    assert parts.total == (
        parts.principal_interest
        + parts.property_tax
        + parts.insurance
        + parts.hoa
        + parts.pmi
        + parts.maintenance
        + parts.utilities
    )
    assert r.metrics.home_cash_needed == D("339000.00")
    assert r.metrics.home_funding_gap == max(D(0), D("339000.00") - r.metrics.home_cash_available_at_purchase)
    # funding timeline starts from goal-eligible cash only (no 401(k), EPF, FD or unvested RSUs)
    assert h.funding_timeline[0].month == date(2026, 10, 1)
    assert h.funding_timeline[0].available == D("60000.00")
    assert all(p.required == D("339000.00") for p in h.funding_timeline)
    assert r.metrics.home_earliest_feasible_date is not None
    first_ok = next(p.month for p in h.funding_timeline if p.available >= p.required)
    assert r.metrics.home_earliest_feasible_date == first_ok
    assert r.metrics.rsu_net_proceeds_to_purchase > 0
    assert {s.label for s in h.stress} == {
        "Rate +1pp",
        "Rate +2pp",
        "Rate −1pp",
        "Rate −2pp",
        "Price +10%",
        "Price −10%",
        "RSU price −30%",
        "INR −10%",
        "Savings −20%",
    }
    stress = {s.label: s for s in h.stress}
    assert stress["Rate +1pp"].pi_monthly > h.pi_monthly > stress["Rate −1pp"].pi_monthly
    assert stress["Price +10%"].all_in_monthly > h.all_in_monthly.total

    # yearly rows are internally consistent
    for y in r.yearly:
        assert y.deficit >= 0 and y.withdrawals >= 0
        assert y.housing_cost >= 0
        assert y.usd_inr > 0
    assert r.yearly[0].housing_cost == 0  # before purchase
    assert r.yearly[4].housing_cost > 0  # after purchase in 2030
    # retirement income stops; withdrawals begin
    retired = [y for y in r.yearly if y.age > 60]
    assert all(y.income == 0 for y in retired)
    # EPF without an access age is never withdrawn → warning
    assert "EPF_ACCESS_UNVERIFIED" in codes(r)
    assert "ILLUSTRATIVE_TAX" in codes(r)
    assert "UNVESTED_EQUITY_EXCLUDED" in codes(r)
    # real values are deflated
    assert r.yearly[10].net_worth_real < r.yearly[10].net_worth
    # explanations cover headline metrics
    expl = {e.metric for e in r.explanations}
    assert {
        "home_pi_monthly",
        "home_all_in_monthly",
        "home_cash_needed",
        "net_worth_now",
        "ending_balance_at_life_expectancy",
    } <= expl
    pi_expl = next(e for e in r.explanations if e.metric == "home_pi_monthly")
    assert pi_expl.inputs == {"P": "1040000.00", "r": "0.00520833", "n": "360"}
    # sensitivity table: one variable at a time
    assert r.sensitivity
    fx_row = next(
        s for s in r.sensitivity if s.variable == "fx.inr_depreciation_annual" and s.metric == "net_worth_at_retirement"
    )
    assert fx_row.low_input == D("0.00") and fx_row.high_input == D("0.04")
    assert fx_row.low_result > fx_row.base_result > fx_row.high_result
    ret_row = next(
        s
        for s in r.sensitivity
        if s.variable == "returns.us_portfolio_annual" and s.metric == "net_worth_at_retirement"
    )
    assert ret_row.low_result < ret_row.base_result < ret_row.high_result


def test_seed_epf_never_used_and_retirement_balance_includes_it(seed):
    a, s = seed
    sim = simulate(a, s)
    epf = next(b for b in sim.buckets if b.id == "seed-epf")
    assert epf.never_accessible
    assert epf.value(sim, sim.N) > D("3500000")


def test_ac005_identical_inputs_identical_checksum(seed):
    a, s = seed
    r1 = run_scenario(a, s)
    r2 = run_scenario(a.model_copy(deep=True), HouseholdSnapshot.model_validate(s.model_dump(mode="json")))
    assert r1.checksum == r2.checksum
    assert r1.input_hash == r2.input_hash
    # run_id and seed are excluded from the checksum
    r2.run_id = "something-else"
    r2.seed = 42
    assert result_checksum(r2) == r1.checksum
    assert canonical_hash(r1.model_dump(mode="json", exclude={"run_id", "checksum", "seed"})) == r1.checksum
    # any input change changes the checksum
    a3, s3 = build(**{"income.salary_annual": "270001"})
    r3 = run_scenario(a3, s3)
    assert r3.checksum != r1.checksum and r3.input_hash != r1.input_hash


@pytest.mark.parametrize("variant", list(SEED_SCENARIO_VARIANTS))
def test_seed_scenario_variants_run(variant):
    a = ScenarioAssumptions.model_validate(apply_variant(seed_assumptions_dict(), SEED_SCENARIO_VARIANTS[variant]))
    r = run_scenario(a, HouseholdSnapshot.model_validate(seed_snapshot_dict()))
    assert r.metrics.net_worth_now == D("199705.88")


def test_variants_move_in_expected_direction(seed):
    base = run_scenario(*seed)
    stock = run_scenario(*build(**{"rsu.price_now": "117.00"}))
    assert stock.metrics.rsu_net_proceeds_to_purchase < base.metrics.rsu_net_proceeds_to_purchase
    inr = run_scenario(*build(**{"fx.inr_depreciation_annual": "0.05"}))
    assert inr.yearly[5].india_assets < base.yearly[5].india_assets
    delayed = run_scenario(*build(**{"home.purchase_date": "2032-10-01"}))
    assert delayed.home.purchase_date == date(2032, 10, 1)
    assert delayed.yearly[4].housing_cost == 0


# ------------------------------------------------------------------------------------------- AC-003
def test_ac003_hoa_changes_all_in_not_pi(seed):
    base = run_scenario(*seed)
    hoa = run_scenario(*build(**{"home.hoa_monthly": "500"}))
    assert hoa.metrics.home_pi_monthly == base.metrics.home_pi_monthly
    assert hoa.metrics.home_all_in_monthly - base.metrics.home_all_in_monthly == D("500.00")
    assert hoa.home.all_in_monthly.hoa == D("500.00")


# ------------------------------------------------------------------------------------------- edge cases
def test_zero_returns_zero_rates_and_zero_mortgage_rate():
    a = minimal_assumptions(
        **{
            "income.salary_annual": "120000",
            "income.living_expenses_monthly": "5000",
            "retirement.spending_monthly_today": "1000",
        }
    )
    a["home"] = {
        "enabled": True,
        "target_price": "300000",
        "purchase_date": "2027-01-01",
        "down_payment_pct": "0",
        "mortgage_rate_annual": "0",
        "term_years": 30,
    }
    s = snapshot([account("cash", "savings", "10000")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.metrics.home_pi_monthly == D("833.33")
    # zero returns: savings accumulate linearly: 10,000 + 12 × (10,000 − 5,000)
    assert r.yearly[0].liquid == D("70000.00")
    assert r.home.actual_purchase_date == date(2027, 1, 1)
    assert r.yearly[1].housing_cost > 0


def test_missing_optional_inputs_run_with_warnings():
    a = minimal_assumptions()
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(snapshot([])))
    assert "NO_ACCOUNTS" in codes(r)
    assert r.home is None
    assert r.metrics.home_cash_needed is None
    assert r.metrics.net_worth_now == 0
    assert all(y.net_worth == 0 for y in r.yearly)


def test_float_inputs_are_rejected():
    a = minimal_assumptions()
    a["income"]["salary_annual"] = 1000.5
    with pytest.raises(ValidationError):
        ScenarioAssumptions.model_validate(a)
    a = minimal_assumptions()
    a["household"]["life_expectancy"] = 30
    with pytest.raises(ValidationError):
        ScenarioAssumptions.model_validate(a)
    a = minimal_assumptions()
    a["household"]["retirement_age"] = 60
    with pytest.raises(ValidationError):
        ScenarioAssumptions.model_validate(a)  # retirement after life expectancy
    a = minimal_assumptions()
    a["retirement"]["withdrawal_order"] = ["taxable", "taxable"]
    with pytest.raises(ValidationError):
        ScenarioAssumptions.model_validate(a)


def test_negative_snapshot_balance_rejected():
    s = snapshot([account("cc", "credit_card", "-10", kind="liability")])
    with pytest.raises(ValidationError, match="NEGATIVE_AMOUNT"):
        HouseholdSnapshot.model_validate(s)


def test_deficit_flagged_and_balances_never_negative():
    a = minimal_assumptions(**{"retirement.spending_monthly_today": "2000"})
    s = snapshot([account("cash", "savings", "60000")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    # retired at 45 (month 60); 60,000 lasts 30 months of retirement → deficit from age 48
    assert r.metrics.first_deficit_age == 48
    assert r.metrics.years_in_deficit == 3
    assert "RETIREMENT_DEFICIT" in codes(r)
    assert all(y.liquid >= 0 for y in r.yearly)
    assert r.yearly[-1].deficit == D("24000.00")
    assert r.metrics.ending_balance_at_life_expectancy == D("0.00")


def test_pre_retirement_cash_flow_deficit_and_negative_net_worth():
    a = minimal_assumptions(**{"income.living_expenses_monthly": "1000"})
    s = snapshot([account("loan", "personal_loan", "50000", kind="liability")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert "CASH_FLOW_DEFICIT" in codes(r)
    assert "NEGATIVE_BALANCE" in codes(r)
    assert "LIABILITY_TERMS_MISSING" in codes(r)
    assert r.yearly[0].net_worth == D("-50000.00")


def test_liability_amortises_from_cash_flow():
    a = minimal_assumptions(**{"income.salary_annual": "60000", "horizon_years": 5})
    s = snapshot(
        [
            account(
                "car",
                "auto_loan",
                "12000",
                kind="liability",
                details={"interest_rate_annual": "0", "term_months_remaining": 12},
            )
        ]
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].expenses == D("12000.00")
    assert r.metrics.net_worth_now == D("-12000.00")
    assert r.yearly[0].net_worth == D("48000.00")  # −12k debt + 60k salary (payments convert cash into less debt)
    assert r.yearly[1].expenses == 0


def test_401k_access_age_gates_withdrawals_and_penalty_option():
    a = minimal_assumptions(
        **{
            "household.retirement_age": 45,
            "household.life_expectancy": 70,
            "horizon_years": 30,
            "retirement.spending_monthly_today": "1000",
        }
    )
    a["retirement_401k"] = {"employee_contribution_annual": "0", "access_age": "59.5"}
    s = snapshot([account("k", "retirement_401k", "500000", details={"pretax_balance": "500000"})])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    # retired at 45 with only a 401(k) accessible at 59.5 → deficits until then
    assert r.metrics.first_deficit_age == 46
    assert all(y.deficit == 0 for y in r.yearly if y.age >= 61)
    a["retirement_401k"].update({"allow_early_withdrawal": True, "early_withdrawal_penalty_pct": "0.10"})
    r2 = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r2.metrics.years_in_deficit == 0
    first_retired_year = r2.yearly[5]
    assert first_retired_year.age == 46
    assert first_retired_year.withdrawals == D("13333.33")  # 12,000 net ÷ (1 − 10% penalty)


def test_withdrawal_tax_gross_up_and_order():
    a = minimal_assumptions(
        **{
            "retirement.spending_monthly_today": "900",
            "retirement.withdrawal_tax_rate": "0.10",
            "household.retirement_age": 40,
        }
    )
    a["retirement"]["withdrawal_order"] = ["tax_deferred", "taxable"]
    s = snapshot(
        [account("k", "ira_traditional", "100000", details={"access_age": "0"}), account("cash", "savings", "100000")]
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].withdrawals == D("12000.00")
    assert r.yearly[0].retirement_balance == D("88000.00")
    assert r.yearly[0].liquid == D("100000.00")


def test_retirement_account_without_access_age_warns():
    a = minimal_assumptions()
    s = snapshot([account("ira", "ira_roth", "1000")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert "RETIREMENT_ACCESS_ASSUMED" in codes(r)


def test_epf_accessible_from_user_age_is_withdrawn():
    a = minimal_assumptions(**{"retirement.spending_monthly_today": "1000", "household.retirement_age": 40})
    a["epf"] = {"interest_rate_annual": "0", "accessible_from_age": "42"}
    s = snapshot([account("epf", "epf", "8500000", currency="INR", country="IN")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    # accessible from the month-end at which age reaches 42 (month 24)
    assert r.yearly[0].deficit == D("12000.00") and r.yearly[1].deficit == D("11000.00")
    assert r.yearly[2].deficit == 0 and r.yearly[2].withdrawals == D("12000.00")
    epf_w = [w for w in r.warnings if w.code == "EPF_ACCESS_UNVERIFIED"]
    assert epf_w and epf_w[0].severity == "info"


def test_epf_without_assumptions_never_accessible():
    a = minimal_assumptions(**{"retirement.spending_monthly_today": "100", "household.retirement_age": 40})
    s = snapshot([account("epf", "epf", "85000", currency="INR", country="IN")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.metrics.years_in_deficit == 10
    assert any(w.code == "EPF_ACCESS_UNVERIFIED" and w.severity == "warning" for w in r.warnings)


def test_home_never_funded_from_retirement_or_unvested():
    a = seed_assumptions_dict()
    s = snapshot(
        [
            account("k", "retirement_401k", "5000000", goal_eligible=True, accessibility="liquid"),
            account("cash", "savings", "1000"),
        ],
        as_of="2026-10-01",
    )
    s["rsu_grants"] = [
        {
            "id": "g",
            "symbol": "ACME",
            "held_shares": "0",
            "vests": [{"vest_date": "2040-01-01", "scheduled_shares": "100000"}],
        }
    ]
    a["income"]["salary_annual"] = "0"
    a["income"]["bonus_annual"] = "0"
    a["income"]["living_expenses_monthly"] = "0"
    a["retirement_401k"] = None
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.home.funding_timeline[0].available == D("1000.00")
    # only the 1,000 of cash (plus interest) counts at the target date
    assert r.metrics.home_cash_available_at_purchase < D("1100")
    assert r.metrics.home_funding_gap > D("337900")
    w = next(w for w in r.warnings if w.code == "HOME_FUNDING_GAP")
    assert w.severity == "warning"
    # the grant only helps once it has actually vested (2040), never before
    assert r.metrics.home_earliest_feasible_date >= date(2040, 1, 1)
    assert all(p.available < D("2000") for p in r.home.funding_timeline if p.month < date(2040, 1, 1))


def test_home_deferred_to_first_feasible_month():
    a = minimal_assumptions(**{"income.salary_annual": "120000", "horizon_years": 10})
    a["home"] = {
        "target_price": "100000",
        "purchase_date": "2026-06-01",
        "down_payment_pct": "0.20",
        "mortgage_rate_annual": "0.05",
        "emergency_reserve": "10000",
    }
    s = snapshot([account("cash", "savings", "0")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    # needs 30,000; saves 10,000/month → feasible after month 3
    assert r.metrics.home_earliest_feasible_date == date(2026, 4, 1)
    assert r.home.actual_purchase_date == date(2026, 6, 1)
    assert r.metrics.home_funding_gap == 0
    a["home"]["purchase_date"] = "2026-02-01"
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.metrics.home_funding_gap == D("20000.00")
    assert r.home.actual_purchase_date == date(2026, 4, 1)
    assert "HOME_FUNDING_GAP" in codes(r)


def test_india_liquid_funding_applies_transfer_cost():
    a = minimal_assumptions(**{"fx.transfer_cost_pct": "0.01"})
    a["home"] = {
        "target_price": "100000",
        "purchase_date": "2026-01-01",
        "down_payment_pct": "1",
        "mortgage_rate_annual": "0.05",
        "funding_sources": {"india_liquid": True},
    }
    s = snapshot([account("inr", "savings", "8500000", currency="INR", country="IN")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.home.funding_timeline[0].available == D("99000.00")
    assert r.home.actual_purchase_date is None


def test_rsu_strategies_and_held_shares():
    base = minimal_assumptions(**{"household.retirement_age": 50, "horizon_years": 2})
    base["rsu"] = {
        "price_now": "100",
        "price_growth_annual": "0",
        "strategy": "sell_on_vest",
        "withholding_rate": "0.37",
        "additional_tax_rate": "0.05",
    }
    s = snapshot(
        [],
        rsu_grants=[
            {
                "id": "g",
                "symbol": "ACME",
                "held_shares": "10",
                "vests": [{"vest_date": "2026-02-15", "scheduled_shares": "100"}],
            }
        ],
    )
    r = run_scenario(ScenarioAssumptions.model_validate(base), HouseholdSnapshot.model_validate(s))
    assert r.metrics.net_worth_now == D("1000.00")  # 10 held shares × 100; unvested excluded
    assert r.yearly[0].rsu_net_proceeds == D("5800.00")
    assert r.yearly[0].liquid == D("6800.00")
    base["rsu"]["strategy"] = "hold"
    r = run_scenario(ScenarioAssumptions.model_validate(base), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].rsu_net_proceeds == D("-500.00")
    # 73 shares held (10 + 63) → 7,300; additional tax 500 is an unmet cash need (no other funds)
    assert r.yearly[0].liquid == D("6800.00")
    s["rsu_grants"][0]["held_in_account_id"] = "brk"
    r = run_scenario(ScenarioAssumptions.model_validate(base), HouseholdSnapshot.model_validate(s))
    assert r.metrics.net_worth_now == 0
    assert "RSU_HELD_IN_BROKERAGE" in codes(r)


def test_rsu_missing_price_and_past_vest():
    a = minimal_assumptions()
    a["rsu"] = {"price_growth_annual": "0", "withholding_rate": "0.3"}
    s = snapshot(
        [],
        rsu_grants=[
            {
                "id": "g",
                "symbol": "NOPE",
                "held_shares": "5",
                "vests": [
                    {"vest_date": "2025-06-01", "scheduled_shares": "1"},
                    {"vest_date": "2032-06-01", "scheduled_shares": "1"},
                ],
            }
        ],
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert {"MISSING_PRICE", "VEST_NOT_RECORDED", "RSU_VESTS_AFTER_RETIREMENT"} <= codes(r)


def test_annual_refresh_adds_proceeds():
    a = minimal_assumptions(**{"household.retirement_age": 50, "horizon_years": 3})
    a["rsu"] = {"price_now": "50", "withholding_rate": "0", "annual_refresh_value": "40000"}
    s = snapshot([], rsu_grants=[{"id": "g", "symbol": "ACME"}])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].rsu_net_proceeds == D("10000.00")  # first refresh vest at month 12
    assert r.yearly[1].rsu_net_proceeds == D("40000.00")


def test_fd_matures_into_cash_with_tds():
    a = minimal_assumptions(**{"horizon_years": 3})
    s = snapshot(
        [
            account(
                "fd",
                "fixed_deposit",
                "100000",
                currency="INR",
                country="IN",
                details={
                    "principal": "100000",
                    "start_date": "2026-01-01",
                    "maturity_date": "2027-01-01",
                    "interest_rate_annual": "0.07",
                    "compounding": "quarterly",
                    "tds_rate": "0.10",
                },
            )
        ]
    )
    sim = simulate(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    fd = next(b for b in sim.buckets if b.id == "fd")
    assert fd.fd["matured"] and fd.liquid
    # 106,467.31 INR at 85 = 1,252.56 USD
    assert sim.points[12].liquid.quantize(D("0.01")) == D("1252.56")


def test_fd_incomplete_and_matured_terms():
    a = minimal_assumptions()
    s = snapshot(
        [
            account("fd1", "fixed_deposit", "1000", currency="INR", country="IN"),
            account(
                "fd2",
                "fixed_deposit",
                "1000",
                currency="INR",
                country="IN",
                details={
                    "principal": "1000",
                    "start_date": "2020-01-01",
                    "maturity_date": "2021-01-01",
                    "interest_rate_annual": "0.07",
                    "compounding": "annually",
                },
            ),
        ]
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert {"FD_TERMS_MISSING", "FD_MATURED"} <= codes(r)


def test_inr_reporting_and_other_currency_accounts():
    a = minimal_assumptions(**{"reporting_currency": "INR"})
    s = snapshot(
        [
            account("usd", "savings", "100"),
            account("eur", "savings", "100", currency="EUR"),
            account("gbp", "savings", "100", currency="GBP"),
        ],
        fx={"USD/INR": {"rate": "85"}, "EUR/USD": {"rate": "1.10"}},
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.currency == "INR"
    assert r.metrics.net_worth_now == D("17850.00")  # (100 + 110) × 85; GBP excluded
    assert {"FX_RATE_MISSING", "FX_HELD_CONSTANT"} <= codes(r)


def test_already_retired_and_social_security():
    a = minimal_assumptions(
        **{
            "household.current_age": 70,
            "household.retirement_age": 65,
            "household.life_expectancy": 80,
            "retirement.spending_monthly_today": "2000",
            "retirement.social_security_monthly_today": "2000",
            "retirement.social_security_start_age": 70,
        }
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(snapshot([])))
    assert r.yearly[0].income == D("24000.00")
    assert r.metrics.years_in_deficit == 0
    assert r.metrics.net_worth_at_retirement == 0


def test_horizon_shorter_than_life_expectancy():
    a = minimal_assumptions(**{"horizon_years": 2})
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(snapshot([])))
    assert r.metrics.ending_balance_at_life_expectancy is None
    assert r.metrics.net_worth_at_retirement is None
    assert "HORIZON_SHORT" in codes(r)
    assert {s.metric for s in r.sensitivity} == {"net_worth_at_horizon"}


def test_retirement_in_india_spends_inr_and_india_inflation():
    a = minimal_assumptions(
        **{
            "household.retirement_age": 40,
            "retirement.location": "IN",
            "retirement.spending_monthly_today": "85000",
            "inflation.india_annual": "0.10",
        }
    )
    s = snapshot([account("inr", "savings", "100000000", currency="INR", country="IN")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].expenses == D("12000.00")
    assert r.yearly[1].expenses == D("13200.00")


def test_epf_contributions_without_account_and_401k_synthetic_buckets():
    a = minimal_assumptions(**{"income.salary_annual": "100000", "horizon_years": 1})
    a["epf"] = {"interest_rate_annual": "0", "monthly_contribution": "8500", "accessible_from_age": None}
    a["retirement_401k"] = {
        "employee_contribution_annual": "12000",
        "employer_match_rate": "1",
        "match_up_to_pct_of_salary": "0.03",
        "employee_roth_pct": "0.5",
    }
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(snapshot([])))
    # 401k: 12,000 employee + 3,000 match; EPF 8,500 × 12 INR = 1,200 USD
    assert r.yearly[0].retirement_balance == D("16200.00")
    assert r.yearly[0].savings == D("88000.00")  # 100,000 − 12,000 (no tax, no expenses)


def test_savings_stress_reduces_availability(seed):
    r = run_scenario(*seed)
    a, s = seed
    from wealthpilot_calc.simulation import SimOverrides

    base = simulate(a, s, overrides=SimOverrides(stop_month=48))
    low = simulate(a, s, overrides=SimOverrides(stop_month=48, savings_multiplier=D("0.8")))
    assert low.home.available_at_target < base.home.available_at_target
    assert r.home is not None


def test_home_date_in_past_and_beyond_horizon():
    a = minimal_assumptions()
    a["home"] = {
        "target_price": "100",
        "purchase_date": "2020-01-01",
        "down_payment_pct": "1",
        "mortgage_rate_annual": "0.05",
    }
    s = snapshot([account("cash", "savings", "1000")])
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert "HOME_DATE_IN_PAST" in codes(r)
    assert r.home.actual_purchase_date == date(2026, 1, 1)
    a["home"]["purchase_date"] = "2050-01-01"
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert "HOME_BEYOND_HORIZON" in codes(r)


def test_ppf_access_by_maturity_and_unknown():
    a = minimal_assumptions(**{"household.retirement_age": 40, "retirement.spending_monthly_today": "100"})
    s = snapshot(
        [
            account(
                "ppf",
                "ppf",
                "1000000",
                currency="INR",
                country="IN",
                details={"maturity_date": "2028-01-01", "interest_rate_annual": "0"},
            ),
            account("ppf2", "ppf", "1", currency="INR", country="IN"),
        ]
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.yearly[0].deficit > 0 and r.yearly[2].deficit == 0
    assert "ACCESS_UNKNOWN" in codes(r)


def test_no_balance_and_excluded_accounts_skipped():
    a = minimal_assumptions()
    s = snapshot(
        [
            account("none", "savings", None),
            account("x", "savings", "5", include_in_net_worth=False),
            account("re", "real_estate", "100", details={"appreciation_annual": "0.10"}),
        ]
    )
    r = run_scenario(ScenarioAssumptions.model_validate(a), HouseholdSnapshot.model_validate(s))
    assert r.metrics.net_worth_now == D("100.00")
    assert r.yearly[0].net_worth == D("110.00")
    assert "STALE_BALANCE" in codes(r)
