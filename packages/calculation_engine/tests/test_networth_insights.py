from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from wealthpilot_calc import NetWorthInput, UpcomingVest, compute_insights, compute_net_worth

D = Decimal
FX85 = [{"base": "USD", "quote": "INR", "rate": "85", "as_of": "2026-10-10"}]


def acc(
    id_: str,
    type_: str,
    amount: str | None,
    *,
    kind: str = "asset",
    currency: str = "USD",
    country: str = "US",
    accessibility: str = "liquid",
    goal: bool = True,
    **extra: Any,
) -> dict[str, Any]:
    d = {
        "id": id_,
        "name": id_,
        "kind": kind,
        "type": type_,
        "country": country,
        "currency": currency,
        "amount": amount,
        "accessibility": accessibility,
        "goal_eligible": goal,
        "ownership_pct": "100",
        "details": {},
        "verification_status": "verified",
        "valuation_as_of": "2026-10-01",
    }
    d.update(extra)
    return d


def nw(accounts=(), grants=(), prices=None, fx=FX85, currency="USD", **kw):
    return compute_net_worth(
        NetWorthInput.model_validate(
            {
                "as_of": "2026-10-10",
                "currency": currency,
                "accounts": list(accounts),
                "rsu_grants": list(grants),
                "prices": prices or {},
                "fx": fx,
                **kw,
            }
        )
    )


def test_ac001_usd_cash_plus_inr_fd_is_20000():
    r = nw(
        [
            acc("cash", "cash", "10000"),
            acc("fd", "fixed_deposit", "850000", currency="INR", country="IN", accessibility="restricted", goal=False),
        ]
    )
    assert r.gross_assets == D("20000.00")
    assert r.liabilities == D("0.00")
    assert r.net_worth == D("20000.00")
    assert r.liquid_net_worth == D("10000.00")
    assert r.goal_eligible == D("10000.00")
    assert {b.key: b.amount for b in r.by_country} == {"US": D("10000.00"), "IN": D("10000.00")}
    inr = next(b for b in r.by_currency if b.key == "INR")
    assert (inr.native_amount, inr.amount) == (D("850000.00"), D("10000.00"))
    assert {b.key for b in r.by_class} == {"cash", "fixed_deposit"}
    assert [f"{q.base}/{q.quote}" for q in r.fx] == ["USD/INR"]
    assert r.warnings == []


def test_ac001_excludes_liabilities_from_gross():
    r = nw(
        [
            acc("cash", "cash", "10000"),
            acc("cc", "credit_card", "2500", kind="liability"),
            acc("mort", "mortgage", "300000", kind="liability"),
            acc("home", "real_estate", "500000", accessibility="illiquid", goal=False),
        ]
    )
    assert r.gross_assets == D("510000.00")
    assert r.liabilities == D("302500.00")
    assert r.net_worth == D("207500.00")
    # mortgage is netted against the property, credit card against liquid funds
    assert r.liquid_net_worth == D("7500.00")
    assert sum(b.amount for b in r.by_country) == r.net_worth


def test_ac002_unvested_100k_adds_zero_to_liquid():
    grants = [{"id": "g", "symbol": "ACME", "unvested_shares": "1000", "held_shares": "0"}]
    prices = {"ACME": {"price": "100", "currency": "USD", "as_of": "2026-10-10"}}
    before = nw([acc("cash", "cash", "5000")])
    after = nw([acc("cash", "cash", "5000")], grants, prices)
    assert after.liquid_net_worth == before.liquid_net_worth == D("5000.00")
    assert after.net_worth == before.net_worth
    assert after.unvested_equity_excluded == D("100000.00")
    assert any(w.code == "UNVESTED_EQUITY_EXCLUDED" for w in after.warnings)


def test_held_rsu_not_double_counted():
    prices = {"ACME": {"price": "150", "currency": "USD", "as_of": "2026-10-10"}}
    brokerage = acc("brk", "brokerage", "10500")  # already includes the 70 held shares
    linked = nw([brokerage], [{"id": "g", "symbol": "ACME", "held_shares": "70", "held_in_account_id": "brk"}], prices)
    assert linked.gross_assets == D("10500.00")
    assert any(w.code == "RSU_HELD_IN_BROKERAGE" for w in linked.warnings)
    held_item = next(i for i in linked.items if i.ref_type == "rsu_grant")
    assert held_item.amount is None and held_item.excluded_reason == "included_in_account"
    direct = nw([], [{"id": "g", "symbol": "ACME", "held_shares": "70"}], prices)
    assert direct.gross_assets == D("10500.00")  # 70 × 150, not 100 × 150
    assert direct.liquid_net_worth == D("10500.00")
    assert direct.goal_eligible == D("10500.00")


def test_missing_fx_excludes_item_with_critical_warning():
    r = nw([acc("cash", "cash", "10000"), acc("fd", "fixed_deposit", "850000", currency="INR", country="IN")], fx=[])
    assert r.gross_assets == D("10000.00")
    w = next(w for w in r.warnings if w.code == "FX_RATE_MISSING")
    assert w.severity == "critical" and w.ref_id == "fd"
    item = next(i for i in r.items if i.ref_id == "fd")
    assert item.amount is None and item.excluded_reason == "fx_rate_missing"


def test_missing_price_and_stale_flags():
    r = nw(
        [
            acc("old", "savings", "100", valuation_as_of="2026-01-01", verification_status="estimated"),
            acc("none", "savings", None),
        ],
        [{"id": "g", "symbol": "ZZZ", "held_shares": "10"}],
        fx=[{"base": "USD", "quote": "INR", "rate": "85", "as_of": "2026-01-01"}],
    )
    codes = {w.code for w in r.warnings}
    assert {"STALE_BALANCE", "UNVERIFIED_BALANCE", "MISSING_PRICE"} <= codes
    assert r.gross_assets == D("100.00")
    old = next(i for i in r.items if i.ref_id == "old")
    assert old.stale and old.amount == D("100.00")  # AC-007: stale stays visible, not zeroed
    assert next(i for i in r.items if i.ref_id == "none").excluded_reason == "no_valuation"


def test_fx_stale_warning_and_inr_reporting():
    r = nw(
        [acc("cash", "cash", "100")],
        fx=[{"base": "USD", "quote": "INR", "rate": "85", "as_of": "2026-09-01"}],
        currency="INR",
    )
    assert r.net_worth == D("8500.00")
    assert any(w.code == "FX_RATE_STALE" for w in r.warnings)


def test_ownership_weighting_and_exclusion():
    r = nw(
        [
            acc("joint", "savings", "1000", ownership_pct="50"),
            acc("hidden", "savings", "999", include_in_net_worth=False),
        ]
    )
    assert r.gross_assets == D("500.00")
    assert next(i for i in r.items if i.ref_id == "hidden").excluded_reason == "excluded_by_user"


def test_negative_liability_and_bad_ownership_rejected():
    with pytest.raises(ValidationError, match="NEGATIVE_AMOUNT"):
        nw([acc("cc", "credit_card", "-500", kind="liability")])
    with pytest.raises(ValidationError):
        nw([acc("x", "savings", "1", ownership_pct="150")])
    with pytest.raises(ValidationError):
        nw([acc("x", "mortgage", "1")])  # liability type on an asset
    with pytest.raises(ValidationError):
        NetWorthInput.model_validate({"as_of": "2026-10-10", "currency": "USD", "accounts": [acc("x", "savings", 0.1)]})


def test_retirement_account_never_goal_eligible():
    r = nw([acc("k", "retirement_401k", "100000", accessibility="liquid", goal=True)])
    assert r.goal_eligible == D("0.00")


@settings(max_examples=60, deadline=None)
@given(
    st.lists(
        st.tuples(
            st.sampled_from(["savings", "brokerage", "epf", "real_estate", "credit_card", "mortgage"]),
            st.decimals(min_value=0, max_value=10**9, places=2),
            st.sampled_from(["USD", "INR"]),
            st.integers(min_value=0, max_value=100),
        ),
        max_size=8,
    )
)
def test_property_net_worth_invariants(rows):
    accounts = []
    for i, (t, amt, ccy, own) in enumerate(rows):
        kind = "liability" if t in ("credit_card", "mortgage") else "asset"
        accounts.append(
            acc(
                f"a{i}",
                t,
                str(amt),
                kind=kind,
                currency=ccy,
                country="IN" if ccy == "INR" else "US",
                accessibility="liquid" if t in ("savings", "brokerage") else "restricted",
                ownership_pct=str(own),
            )
        )
    r = nw(accounts)
    assert r.net_worth == r.gross_assets - r.liabilities
    assert sum((b.amount for b in r.by_country), D(0)) == r.net_worth
    assert sum((b.amount for b in r.by_class), D(0)) == r.net_worth
    assert sum((b.amount for b in r.by_currency), D(0)) == r.net_worth
    assert r.goal_eligible <= r.gross_assets
    liquid_assets = sum((i.amount for i in r.items if i.liquid and i.amount is not None), D(0))
    assert r.liquid_net_worth <= liquid_assets


def test_insights_are_deterministic_facts():
    inp = NetWorthInput.model_validate(
        {
            "as_of": "2026-10-10",
            "currency": "USD",
            "fx": FX85,
            "accounts": [
                acc("cash", "cash", "10000"),
                acc(
                    "fd",
                    "fixed_deposit",
                    "850000",
                    currency="INR",
                    country="IN",
                    accessibility="restricted",
                    goal=False,
                    verification_status="estimated",
                ),
                acc(
                    "epf",
                    "epf",
                    "850000",
                    currency="INR",
                    country="IN",
                    accessibility="restricted",
                    goal=False,
                    valuation_as_of="2026-01-01",
                ),
            ],
            "rsu_grants": [{"id": "g", "symbol": "ACME", "held_shares": "50", "unvested_shares": "100"}],
            "prices": {"ACME": {"price": "100", "currency": "USD", "as_of": "2026-10-10"}},
        }
    )
    vests = [
        UpcomingVest(vest_id="v1", grant_id="g", vest_date=date(2026, 10, 24), shares=D("25")),
        UpcomingVest(vest_id="v2", grant_id="g", vest_date=date(2027, 1, 24), shares=D("25")),
    ]
    ins = {i.code: i for i in compute_insights(inp, upcoming_vests=vests)}
    assert set(ins) == {
        "CONCENTRATION_EMPLOYER_STOCK",
        "INR_EXPOSURE",
        "STALE_BALANCE",
        "UNVERIFIED_BALANCE",
        "EPF_ACCESS_UNVERIFIED",
        "UPCOMING_VEST",
        "LIQUIDITY_SHARE",
    }
    # net worth = 10000 + 10000 + 10000 + 5000 = 35000; stock 5000 → 14.29%
    assert ins["CONCENTRATION_EMPLOYER_STOCK"].value == "14.29"
    assert ins["CONCENTRATION_EMPLOYER_STOCK"].severity == "info"
    assert ins["INR_EXPOSURE"].value == "2000.00"  # 10% of INR 20,000 USD-equivalent
    assert "57.14%" in ins["INR_EXPOSURE"].body
    assert ins["UPCOMING_VEST"].value == "1" and "14 day" in ins["UPCOMING_VEST"].body
    assert ins["LIQUIDITY_SHARE"].value == "42.86"
    assert [r.ref_id for r in ins["STALE_BALANCE"].refs] == ["epf"]
    again = compute_insights(inp, upcoming_vests=vests)
    assert [i.model_dump() for i in again] == [i.model_dump() for i in ins.values()]


def test_insights_empty_household():
    inp = NetWorthInput.model_validate({"as_of": "2026-10-10", "currency": "INR"})
    assert compute_insights(inp) == []
