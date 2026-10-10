"""401(k), EPF, FD and savings modules."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from wealthpilot_calc import contributions_401k, epf_accessible, epf_project, fd_maturity, fd_value_at, q_money
from wealthpilot_calc.epf import EpfState, epf_access_warnings, epf_step
from wealthpilot_calc.savings import future_value_end_of_month, project_savings

D = Decimal


# ---------------------------------------------------------------- 401(k)
def test_401k_match_cap_and_limit():
    c = contributions_401k(
        salary_annual=D("200000"),
        employee_contribution_annual=D("30000"),
        employer_match_rate=D("0.5"),
        match_up_to_pct_of_salary=D("0.06"),
        contribution_limit_annual=D("23000"),
        employee_roth_pct=D("0.25"),
    )
    assert c.capped
    assert c.employee_total == D("23000")
    assert c.employee_roth == D("5750")
    assert c.employee_pretax == D("17250")
    assert c.employer_match == D("6000")  # 0.5 × min(23000, 6% × 200000 = 12000)
    assert c.pretax_total == D("23250")
    assert c.roth_total == D("5750")
    assert c.total == D("29000")


def test_401k_match_limited_by_employee_contribution_and_no_limit():
    c = contributions_401k(
        salary_annual=D("100000"),
        employee_contribution_annual=D("3000"),
        employer_match_rate=D("1"),
        match_up_to_pct_of_salary=D("0.06"),
    )
    assert not c.capped
    assert c.employer_match == D("3000")
    assert c.employee_roth == 0


def test_401k_validation():
    with pytest.raises(ValueError):
        contributions_401k(salary_annual=D("-1"), employee_contribution_annual=D("1"))
    with pytest.raises(ValueError):
        contributions_401k(salary_annual=D("1"), employee_contribution_annual=D("1"), employee_roth_pct=D("2"))


# ---------------------------------------------------------------- EPF
def test_epf_annual_credit_vs_monthly_compound():
    annual = epf_project(D("1200000"), D("0"), D("0.12"), 12, "annual_credit")
    assert q_money(annual[12]) == D("1344000.00")
    assert q_money(annual[6]) == D("1272000.00")  # accrued (uncredited) interest is included in value
    monthly = epf_project(D("1200000"), D("0"), D("0.12"), 12, "monthly_compound")
    assert q_money(monthly[12]) == D("1352190.04")
    with pytest.raises(ValueError):
        epf_step(EpfState(D("1")), D("0.1"), D("0"), "daily")


def test_epf_contributions_end_of_month():
    v = epf_project(D("0"), D("1000"), D("0.12"), 2, "monthly_compound")
    assert v[1] == D("1000")  # no interest in the month a contribution is made
    assert v[2] == D("2010")


def test_epf_access_is_user_gated():
    assert not epf_accessible(D("70"), None)
    assert epf_accessible(D("58"), D("58"))
    assert not epf_accessible(D("57.9"), D("58"))
    w = epf_access_warnings(None, "acc")
    assert w[0].code == "EPF_ACCESS_UNVERIFIED" and w[0].severity == "warning"
    assert epf_access_warnings(D("58"))[0].severity == "info"


# ---------------------------------------------------------------- FD
@pytest.mark.parametrize(
    ("comp", "start", "maturity", "rate", "expected"),
    [
        ("quarterly", date(2026, 1, 1), date(2027, 1, 1), "0.07", "107185.90"),
        ("at_maturity", date(2026, 1, 1), date(2027, 1, 1), "0.07", "107000.00"),
        ("annually", date(2026, 1, 1), date(2028, 1, 1), "0.07", "114490.00"),
        ("monthly", date(2026, 1, 1), date(2027, 1, 1), "0.06", "106167.78"),
        ("half_yearly", date(2026, 1, 1), date(2027, 1, 1), "0.07", "107122.50"),
        ("quarterly", date(2026, 1, 1), date(2026, 5, 1), "0.08", "102670.68"),  # 1 quarter + 30 days simple
    ],
)
def test_fd_compounding_fixtures(comp, start, maturity, rate, expected):
    m = fd_maturity(D("100000"), start, maturity, D(rate), comp)
    assert q_money(m.gross_maturity_value) == D(expected)


def test_fd_tds_and_partial_value():
    m = fd_maturity(D("100000"), date(2026, 1, 1), date(2027, 1, 1), D("0.07"), "quarterly", D("0.10"))
    assert q_money(m.interest) == D("7185.90")
    assert q_money(m.tds) == D("718.59")
    assert q_money(m.net_maturity_value) == D("106467.31")
    assert fd_value_at(D("100000"), date(2026, 1, 1), D("0.07"), "quarterly", date(2025, 1, 1)) == D("100000")
    # value is capped at maturity
    assert (
        fd_value_at(D("100000"), date(2026, 1, 1), D("0.07"), "quarterly", date(2030, 1, 1), date(2027, 1, 1))
        == m.gross_maturity_value
    )


def test_fd_validation():
    with pytest.raises(ValueError):
        fd_value_at(D("1"), date(2026, 1, 1), D("0.1"), "weekly", date(2027, 1, 1))
    with pytest.raises(ValueError):
        fd_value_at(D("-1"), date(2026, 1, 1), D("0.1"), "monthly", date(2027, 1, 1))
    with pytest.raises(ValueError):
        fd_value_at(D("1"), date(2026, 1, 1), D("-0.1"), "monthly", date(2027, 1, 1))
    with pytest.raises(ValueError):
        fd_maturity(D("1"), date(2026, 1, 1), date(2025, 1, 1), D("0.1"), "monthly")


# ---------------------------------------------------------------- savings
def test_savings_end_of_month_timing_convention():
    rows = project_savings(opening_balance=D("1000"), annual_return=D("0"), months=3, monthly_contribution=D("100"))
    assert [r.closing for r in rows] == [D("1100"), D("1200"), D("1300")]
    # contribution made at month end earns nothing that month
    rows = project_savings(opening_balance=D("0"), annual_return=D("0.12"), months=1, monthly_contribution=D("100"))
    assert rows[0].growth == 0 and rows[0].closing == D("100")
    rows = project_savings(opening_balance=D("1000"), annual_return=D("0.12"), months=12)
    assert q_money(rows[-1].closing) == D("1120.00")


def test_savings_matches_closed_form_and_caps_withdrawals():
    rows = project_savings(opening_balance=D("5000"), annual_return=D("0.07"), months=60, monthly_contribution=D("250"))
    assert q_money(rows[-1].closing) == q_money(future_value_end_of_month(D("5000"), D("250"), D("0.07"), 60))
    assert future_value_end_of_month(D("10"), D("5"), D("0"), 4) == D("30")
    rows = project_savings(
        opening_balance=D("100"),
        annual_return=D("0"),
        months=2,
        monthly_withdrawal=[D("80"), D("80")],
        monthly_fees=D("1"),
        monthly_taxes=[D("0")],
    )
    assert rows[0].closing == D("19")
    assert rows[1].withdrawal == D("18") and rows[1].shortfall == D("62")
    assert rows[1].closing == 0
