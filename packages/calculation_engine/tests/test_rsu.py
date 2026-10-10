from __future__ import annotations

import itertools
from datetime import date
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from wealthpilot_calc import (
    Disposition,
    ShareConservationError,
    VestRecord,
    check_disposition_allowed,
    forecast_vest_cash,
    generate_vest_schedule,
    grant_totals,
    reconcile_vest,
    vest_totals,
)
from wealthpilot_calc.rsu import find_duplicate_vests, net_sale_proceeds

D = Decimal


def test_schedule_quarterly_with_one_year_cliff():
    v = generate_vest_schedule(
        start_date=date(2025, 3, 15), total_shares=D("400"), total_months=48, frequency_months=3, cliff_months=12
    )
    assert len(v) == 13
    assert v[0].vest_date == date(2026, 3, 15) and v[0].shares == D("100")
    assert all(x.shares == D("25") for x in v[1:])
    assert v[-1].vest_date == date(2029, 3, 15)
    assert sum(x.shares for x in v) == D("400")


def test_schedule_remainder_on_last_vest():
    v = generate_vest_schedule(
        start_date=date(2026, 1, 31), total_shares=D("1000"), total_months=48, frequency_months=1, cliff_months=12
    )
    assert v[0].shares == D("240")
    assert v[0].vest_date == date(2027, 1, 31)
    assert v[1].vest_date == date(2027, 2, 28)  # month-end clamping
    assert v[-1].shares == D("60")
    assert sum(x.shares for x in v) == D("1000")


def test_schedule_fractional_and_validation():
    v = generate_vest_schedule(start_date=date(2026, 1, 1), total_shares=D("10.5"), total_months=12, frequency_months=4)
    assert [x.shares for x in v] == [D("3.5"), D("3.5"), D("3.5")]
    v = generate_vest_schedule(start_date=date(2026, 1, 1), total_shares=D("10"), total_months=12, frequency_months=4)
    assert [x.shares for x in v] == [D("3"), D("3"), D("4")]
    for kwargs in (
        dict(total_months=10, frequency_months=3),
        dict(total_months=12, frequency_months=0),
        dict(total_months=12, frequency_months=3, cliff_months=13),
        dict(total_months=12, frequency_months=3, cliff_months=5),
    ):
        with pytest.raises(ValueError):
            generate_vest_schedule(start_date=date(2026, 1, 1), total_shares=D("10"), **kwargs)
    with pytest.raises(ValueError):
        generate_vest_schedule(start_date=date(2026, 1, 1), total_shares=D("-1"), total_months=12, frequency_months=3)


@given(
    total=st.integers(min_value=0, max_value=100000),
    freq=st.sampled_from([1, 3, 6, 12]),
    years=st.integers(min_value=1, max_value=5),
    cliff_periods=st.integers(min_value=0, max_value=4),
)
def test_property_schedule_conserves_shares(total: int, freq: int, years: int, cliff_periods: int):
    total_months = years * 12
    cliff = min(cliff_periods * freq, total_months)
    v = generate_vest_schedule(
        start_date=date(2026, 1, 1),
        total_shares=D(total),
        total_months=total_months,
        frequency_months=freq,
        cliff_months=cliff,
    )
    assert sum(x.shares for x in v) == D(total)
    assert all(x.shares >= 0 for x in v)
    assert all(a.vest_date < b.vest_date for a, b in itertools.pairwise(v))


def test_golden_100_vest_30_sold_to_cover_70_held():
    vest = VestRecord(
        scheduled_shares=D("100"),
        status="vested",
        vested_shares=D("100"),
        vest_fmv=D("150"),
        dispositions=(Disposition("sell_to_cover", D("30"), D("150")),),
    )
    t = vest_totals(vest)
    assert (t.vested, t.withheld, t.sold, t.held, t.unvested) == (D("100"), D("30"), D("0"), D("70"), D("0"))


def test_totals_for_scheduled_cancelled_and_withheld():
    assert vest_totals(VestRecord(D("25"))).unvested == D("25")
    assert vest_totals(VestRecord(D("25"), status="cancelled")).scheduled == D("25")
    t = vest_totals(
        VestRecord(
            D("100"),
            "vested",
            D("100"),
            D("10"),
            withheld_shares=D("37"),
            dispositions=(Disposition("sale", D("20"), D("12")),),
        )
    )
    assert (t.withheld, t.sold, t.held) == (D("37"), D("20"), D("43"))
    g = grant_totals([VestRecord(D("100"), "vested", D("100"), D("10"), withheld_shares=D("30")), VestRecord(D("300"))])
    assert (g.scheduled, g.vested, g.withheld, g.held, g.unvested) == (D("400"), D("100"), D("30"), D("70"), D("300"))


def test_share_conservation_errors():
    vest = VestRecord(D("100"), "vested", D("100"), D("10"), withheld_shares=D("30"))
    with pytest.raises(ShareConservationError) as e:
        check_disposition_allowed(vest, Disposition("sale", D("71"), D("10")))
    assert e.value.code == "SHARE_CONSERVATION"
    check_disposition_allowed(vest, Disposition("sale", D("70"), D("10")))
    with pytest.raises(ShareConservationError):
        vest_totals(VestRecord(D("10"), dispositions=(Disposition("sale", D("1"), D("1")),)))
    with pytest.raises(ShareConservationError):
        vest_totals(VestRecord(D("10"), "vested", D("10"), withheld_shares=D("-1")))
    with pytest.raises(ShareConservationError):
        vest_totals(VestRecord(D("-1")))
    with pytest.raises(ShareConservationError):
        vest_totals(VestRecord(D("10"), "vested", D("10"), dispositions=(Disposition("sale", D("-1"), D("1")),)))
    with pytest.raises(ValueError):
        vest_totals(VestRecord(D("10"), "vested", D("10"), dispositions=(Disposition("gift", D("1"), D("1")),)))


@given(
    vested=st.integers(min_value=0, max_value=10000),
    withheld=st.integers(min_value=0, max_value=10000),
    sales=st.lists(
        st.tuples(st.sampled_from(["sell_to_cover", "sale"]), st.integers(min_value=0, max_value=5000)), max_size=6
    ),
)
def test_property_share_conservation(vested: int, withheld: int, sales: list[tuple[str, int]]):
    vest = VestRecord(
        D(vested),
        "vested",
        D(vested),
        D("10"),
        withheld_shares=D(withheld),
        dispositions=tuple(Disposition(k, D(s), D("10")) for k, s in sales),
    )
    used = withheld + sum(s for _, s in sales)
    if used > vested:
        with pytest.raises(ShareConservationError):
            vest_totals(vest)
    else:
        t = vest_totals(vest)
        assert t.held >= 0
        assert t.withheld + t.sold + t.held == t.vested


def test_forecast_never_double_subtracts_withholding():
    f = forecast_vest_cash(
        shares=D("100"),
        price=D("100"),
        strategy="sell_on_vest",
        withholding_rate=D("0.37"),
        additional_tax_rate=D("0.05"),
    )
    assert f.gross_value == D("10000")
    assert f.withheld_shares == D("37")
    assert f.sold_shares == D("63")
    assert f.sale_proceeds == D("6300")
    assert f.net_cash == D("5800")  # not 10000 − 3700 − 3700
    h = forecast_vest_cash(
        shares=D("100"), price=D("100"), strategy="hold", withholding_rate=D("0.37"), additional_tax_rate=D("0.05")
    )
    assert (h.held_shares, h.sold_shares, h.net_cash) == (D("63"), D("0"), D("-500"))
    s = forecast_vest_cash(
        shares=D("100"),
        price=D("100"),
        strategy="sell_fraction",
        withholding_rate=D("0.37"),
        sell_fraction=D("0.5"),
        transaction_cost_pct=D("0.01"),
    )
    assert s.sold_shares == D("31.5")
    assert s.held_shares == D("31.5")
    assert s.transaction_costs == D("31.5")
    assert s.net_cash == D("3118.5")
    for fc in (f, h, s):
        assert fc.withheld_shares + f.sold_shares + f.held_shares == f.vested_shares
    with pytest.raises(ValueError):
        forecast_vest_cash(shares=D("1"), price=D("1"), strategy="yolo", withholding_rate=D("0"))
    with pytest.raises(ValueError):
        forecast_vest_cash(shares=D("-1"), price=D("1"), strategy="hold", withholding_rate=D("0"))


def test_reconcile_under_withholding_and_missing_price():
    vest = VestRecord(
        D("100"),
        "vested",
        D("100"),
        D("100"),
        withheld_shares=D("22"),
        dispositions=(Disposition("sale", D("10"), D("110"), D("5")),),
    )
    r = reconcile_vest(vest, D("0.37"), ref_id="v1")
    assert r.gross_vest_value == D("10000")
    assert r.estimated_withholding == D("3700")
    assert r.actual_withholding_value == D("2200")
    assert r.sale_proceeds_net == D("1095")
    assert [w.code for w in r.warnings] == ["UNDER_WITHHOLDING"]
    ok = reconcile_vest(
        VestRecord(
            D("100"),
            "vested",
            D("100"),
            D("100"),
            dispositions=(Disposition("sell_to_cover", D("40"), D("100"), D("0")),),
        ),
        D("0.37"),
    )
    assert ok.warnings == [] and ok.sell_to_cover_net == D("4000")
    missing = reconcile_vest(VestRecord(D("100"), "vested", D("100"), None), D("0.37"))
    assert [w.code for w in missing.warnings] == ["MISSING_PRICE"]


def test_net_sale_proceeds_and_duplicates():
    assert net_sale_proceeds(D("70"), D("150"), D("10"), D("500")) == D("9990")
    keys = [(date(2026, 1, 1), None), (date(2026, 4, 1), "x"), (date(2026, 1, 1), None), (date(2026, 4, 1), "y")]
    assert find_duplicate_vests(keys) == [2]
