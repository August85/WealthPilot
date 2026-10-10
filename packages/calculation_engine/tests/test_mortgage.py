from __future__ import annotations

from decimal import Decimal

import pytest

from wealthpilot_calc import (
    all_in_monthly,
    amortization_schedule,
    cash_to_close,
    loan_principal,
    mortgage_payment,
    q_money,
)
from wealthpilot_calc.mortgage import balance_after, down_payment, monthly_pmi, pmi_applies

D = Decimal


def test_zero_rate_mortgage_golden_vector():
    assert q_money(mortgage_payment(D("300000"), D("0"), 360)) == D("833.33")


def test_one_million_home_twenty_percent_down_borrows_800k():
    assert loan_principal(D("1000000"), D("0.20")) == D("800000")
    assert down_payment(D("1000000"), D("0.20")) == D("200000")


def test_known_payment_values():
    assert q_money(mortgage_payment(D("100000"), D("0.06"), 360)) == D("599.55")
    assert q_money(mortgage_payment(D("1040000"), D("0.0625"), 360)) == D("6403.46")
    assert q_money(mortgage_payment(D("200000"), D("0.05"), 180)) == D("1581.59")
    assert mortgage_payment(D("0"), D("0.05"), 360) == 0


def test_payment_validation():
    with pytest.raises(ValueError):
        mortgage_payment(D("1"), D("0.05"), 0)
    with pytest.raises(ValueError):
        mortgage_payment(D("-1"), D("0.05"), 12)
    with pytest.raises(ValueError):
        mortgage_payment(D("1"), D("-0.05"), 12)
    with pytest.raises(ValueError):
        down_payment(D("100"), D("1.5"))


def test_hand_checked_amortization_fixture():
    rows = amortization_schedule(D("100000"), D("0.06"), 360)
    assert len(rows) == 360
    first, second = rows[0], rows[1]
    assert (first.payment, first.interest, first.principal, first.balance) == (
        D("599.55"),
        D("500.00"),
        D("99.55"),
        D("99900.45"),
    )
    assert (second.interest, second.principal, second.balance) == (D("499.50"), D("100.05"), D("99800.40"))
    assert rows[-1].balance == D("0.00")
    assert sum(r.principal for r in rows) == D("100000.00")
    assert all(r.payment == D("599.55") for r in rows[:-1])
    # the final payment absorbs accumulated rounding and stays close to the level payment
    assert abs(rows[-1].payment - D("599.55")) < D("1.00")
    for r in rows:
        assert r.payment == r.interest + r.principal


def test_zero_rate_amortization():
    rows = amortization_schedule(D("300000"), D("0"), 360)
    assert rows[0].payment == D("833.33")
    assert rows[-1].balance == 0
    assert sum(r.principal for r in rows) == D("300000.00")
    assert rows[-1].payment == D("300000.00") - D("833.33") * 359


def test_balance_after_matches_schedule():
    rows = amortization_schedule(D("100000"), D("0.06"), 360)
    assert abs(balance_after(D("100000"), D("0.06"), 360, 12) - rows[11].balance) < D("0.05")
    assert balance_after(D("100000"), D("0.06"), 360, 360) == 0
    assert q_money(balance_after(D("1200"), D("0"), 12, 6)) == D("600.00")


def test_ac003_hoa_changes_all_in_but_not_pi():
    kw = dict(
        price=D("1300000"),
        down_payment_pct=D("0.20"),
        annual_rate=D("0.0625"),
        term_years=30,
        property_tax_rate_annual=D("0.011"),
        insurance_annual=D("2400"),
        maintenance_pct_annual=D("0.01"),
        utilities_monthly=D("400"),
    )
    a = all_in_monthly(**kw, hoa_monthly=D("0")).rounded()
    b = all_in_monthly(**kw, hoa_monthly=D("350")).rounded()
    assert a.principal_interest == b.principal_interest == D("6403.46")
    assert b.total - a.total == D("350.00")
    assert a.property_tax == D("1191.67")
    assert a.insurance == D("200.00")
    assert a.maintenance == D("1083.33")
    assert a.utilities == D("400.00")
    assert a.pmi == D("0.00")  # exactly 80% LTV -> no PMI
    assert a.total == D("9278.46")
    # property tax / insurance are separate from P&I (FR-HOME-006)
    assert a.total != a.principal_interest


def test_pmi_only_while_ltv_above_80():
    bd = all_in_monthly(
        price=D("500000"), down_payment_pct=D("0.10"), annual_rate=D("0.06"), term_years=30, pmi_rate_annual=D("0.006")
    ).rounded()
    assert bd.pmi == D("225.00")  # 450000 × 0.6% / 12
    assert pmi_applies(D("400001"), D("500000"))
    assert not pmi_applies(D("400000"), D("500000"))
    assert not pmi_applies(D("1"), D("0"))
    assert monthly_pmi(D("450000"), D("399999"), D("500000"), D("0.006")) == 0


def test_cash_to_close_excludes_reserve():
    # down 260,000 + closing 39,000 + prepaid 5,000 − credits 2,000
    assert cash_to_close(D("1300000"), D("0.20"), D("0.03"), D("5000"), D("2000")) == D("302000.00")
    assert cash_to_close(D("100"), D("0"), D("0"), D("0"), D("1000")) == 0
