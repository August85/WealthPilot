from __future__ import annotations

from datetime import date
from decimal import Decimal, getcontext, localcontext

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wealthpilot_calc import FxRateMissing, FxTable, Money, Rate, convert, inverse, q_money, to_decimal
from wealthpilot_calc.fx import convert_usd_inr, usd_inr_at_month, usd_inr_path
from wealthpilot_calc.money import (
    add_months,
    floor_to,
    fmt,
    growth_factor,
    monthly_rate_from_annual,
    months_between,
    months_until_ceil,
    q_rate,
    q_shares,
)

D = Decimal


def test_usd_100_at_85_is_inr_8500_and_back():
    r = Rate("USD", "INR", D("85"))
    inr = convert(D("100"), "USD", "INR", r)
    assert inr == D("8500")
    assert convert(inr, "INR", "USD", r) == D("100")
    # explicit direction via the inverse quote gives the same answer
    assert q_money(convert(D("100"), "USD", "INR", inverse(r))) == D("8500.00")


def test_convert_same_currency_and_missing_pair():
    r = Rate("USD", "INR", D("85"))
    assert convert(D("12.34"), "USD", "USD", r) == D("12.34")
    with pytest.raises(FxRateMissing):
        convert(D("1"), "USD", "EUR", r)


def test_rate_validation():
    with pytest.raises(ValueError):
        Rate("USD", "INR", D("0"))
    with pytest.raises(ValueError):
        Rate("USD", "USD", D("1"))


def test_fx_table_latest_wins_and_inverse_lookup():
    t = FxTable([Rate("USD", "INR", D("80"), date(2026, 1, 1)), Rate("INR", "USD", D("1") / D("85"), date(2026, 2, 1))])
    assert q_money(t.convert(D("100"), "USD", "INR")) == D("8500.00")
    assert t.has("USD", "USD")
    assert not t.has("USD", "EUR")
    with pytest.raises(FxRateMissing):
        t.convert(D("1"), "USD", "EUR")
    assert len(t.rates()) == 1


def test_fx_path_depreciation():
    assert usd_inr_at_month(D("85"), D("0.02"), 0) == D("85")
    assert q_money(usd_inr_at_month(D("85"), D("0.02"), 12)) == D("86.70")
    path = usd_inr_path(D("85"), D("0"), 3)
    assert path == [D("85")] * 4
    assert q_money(convert_usd_inr(D("8670"), "INR", "USD", usd_inr_at_month(D("85"), D("0.02"), 12))) == D("100.00")
    with pytest.raises(ValueError):
        usd_inr_at_month(D("0"), D("0"), 1)


@given(
    amount=st.decimals(min_value=0, max_value=10**12, places=2, allow_nan=False, allow_infinity=False),
    rate=st.decimals(min_value=D("0.0001"), max_value=10000, places=8, allow_nan=False, allow_infinity=False),
)
def test_property_round_trip_within_rounding(amount: Decimal, rate: Decimal):
    r = Rate("USD", "INR", rate)
    there = convert(amount, "USD", "INR", r)
    back = convert(there, "INR", "USD", r)
    assert q_money(back) == q_money(amount)
    # converting a *rounded* foreign amount back is within half a cent of the foreign rounding error
    back_rounded = convert(q_money(there), "INR", "USD", r)
    assert abs(back_rounded - amount) <= D("0.005") / rate + D("1e-20")


def test_to_decimal_rejects_float_and_bool():
    with pytest.raises(TypeError):
        to_decimal(0.1)
    with pytest.raises(TypeError):
        to_decimal(True)
    with pytest.raises(ValueError):
        to_decimal("abc")
    with pytest.raises(ValueError):
        to_decimal("NaN")
    with pytest.raises(TypeError):
        to_decimal([1])
    assert to_decimal(" 1.50 ") == D("1.50")
    assert to_decimal(7) == D(7)


def test_rounding_is_bankers_at_boundaries():
    assert q_money(D("0.125")) == D("0.12")
    assert q_money(D("0.135")) == D("0.14")
    assert q_money(D("-0.001")) == D("0.00")
    assert str(q_money(D("-0.001"))) == "0.00"
    assert q_rate(D("0.123456785")) == D("0.12345678")
    assert q_shares(D("1.000000005")) == D("1.00000000")
    assert floor_to(D("1.999"), D("0.01")) == D("1.99")
    assert fmt(D("1E+3")) == "1000"
    assert fmt(D("0E-8")) == "0.00000000"


def test_engine_ignores_callers_decimal_context():
    with localcontext() as ctx:
        ctx.prec = 3
        r = Rate("USD", "INR", D("85.12345"))
        assert convert(D("100"), "USD", "INR", r) == D("8512.345")
    assert getcontext().prec >= 28


def test_monthly_rate_and_growth():
    assert monthly_rate_from_annual(D("0")) == 0
    assert q_money(growth_factor(D("0.12"), 12) * 1000) == D("1120.00")
    with pytest.raises(ValueError):
        monthly_rate_from_annual(D("-1"))
    with pytest.raises(ValueError):
        growth_factor(D("0.1"), -1)


def test_calendar_months():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert add_months(date(2026, 11, 15), 3) == date(2027, 2, 15)
    assert add_months(date(2026, 3, 15), -3) == date(2025, 12, 15)
    assert months_between(date(2026, 1, 31), date(2026, 2, 28)) == 1  # clamped month end
    assert months_between(date(2026, 1, 31), date(2026, 2, 27)) == 0
    assert months_between(date(2026, 1, 15), date(2026, 3, 15)) == 2
    assert months_between(date(2026, 3, 15), date(2026, 1, 16)) == -1
    assert months_until_ceil(date(2026, 10, 1), date(2026, 12, 15)) == 3
    assert months_until_ceil(date(2026, 10, 1), date(2026, 12, 1)) == 2
    assert months_until_ceil(date(2026, 10, 1), date(2026, 9, 1)) == 0


def test_money_type():
    a = Money(D("10.005"), "USD")
    b = Money("5", "USD")
    assert (a + b).amount == D("15.005")
    assert (a - b).amount == D("5.005")
    assert a.scale(D("2")).amount == D("20.010")
    assert str(a.rounded()) == "10.00 USD"
    with pytest.raises(ValueError):
        a + Money(D("1"), "INR")
    with pytest.raises(TypeError):
        a + 1  # type: ignore[operator]
    with pytest.raises(ValueError):
        Money(D("1"), "usd")
    with pytest.raises(TypeError):
        Money(1.5, "USD")  # type: ignore[arg-type]
