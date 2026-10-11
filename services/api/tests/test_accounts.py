from __future__ import annotations

from datetime import date, timedelta

from .conftest import Api

TODAY = date.today()

FD_DETAILS = {
    "principal": "850000",
    "start_date": "2025-01-01",
    "maturity_date": "2028-01-01",
    "interest_rate_annual": "0.07",
    "compounding": "quarterly",
}


def test_ac001_usd_cash_plus_inr_fd(alice: Api) -> None:
    """AC-001: USD 10,000 + INR 850,000 at 85 INR/USD → USD 20,000 gross, liabilities excluded."""
    alice.fx("85")
    alice.account(type_="cash", amount="10000")
    fd = alice.account(type_="fixed_deposit", currency="INR", country="IN", amount="850000", details=FD_DETAILS)
    assert fd["accessibility"] == "restricted"
    assert fd["goal_eligible"] is False
    alice.account(kind="liability", type_="credit_card", amount="2500")

    nw = alice.ok(alice.get("/net-worth", params={"currency": "USD"}))
    assert nw["gross_assets"] == "20000.00"
    assert nw["liabilities"] == "2500.00"
    assert nw["net_worth"] == "17500.00"
    assert nw["liquid_net_worth"] == "7500.00"
    assert nw["goal_eligible"] == "10000.00"
    by_cur = {r["key"]: r for r in nw["by_currency"]}
    assert by_cur["INR"]["native_amount"] == "850000.00" and by_cur["INR"]["amount"] == "10000.00"
    assert {r["key"]: r["amount"] for r in nw["by_country"]}["IN"] == "10000.00"
    assert isinstance(nw["gross_assets"], str)

    inr = alice.ok(alice.get("/net-worth", params={"currency": "INR"}))
    assert inr["gross_assets"] == "1700000.00"


def test_missing_fx_excludes_item_with_critical_warning(alice: Api) -> None:
    alice.account(type_="cash", amount="10000")
    alice.account(type_="savings", currency="INR", country="IN", amount="850000")
    nw = alice.ok(alice.get("/net-worth"))
    assert nw["gross_assets"] == "10000.00"
    codes = {(w["code"], w["severity"]) for w in nw["warnings"]}
    assert ("FX_RATE_MISSING", "critical") in codes


def test_ac002_unvested_rsu_does_not_raise_liquid_net_worth(alice: Api) -> None:
    """AC-002: a $100,000 unvested award does not increase current liquid net worth."""
    alice.account(type_="checking", amount="5000")
    before = alice.ok(alice.get("/net-worth"))
    alice.ok(
        alice.post("/prices", {"symbol": "ACME", "price": "100", "currency": "USD", "as_of": TODAY.isoformat()}), 201
    )
    alice.ok(
        alice.post(
            "/rsu/grants",
            {
                "employer_name": "Acme",
                "symbol": "ACME",
                "grant_date": TODAY.isoformat(),
                "granted_shares": "1000",
                "schedule": {
                    "start_date": (TODAY + timedelta(days=365)).isoformat(),
                    "cliff_months": 0,
                    "frequency_months": 3,
                    "total_months": 12,
                },
            },
        ),
        201,
    )
    after = alice.ok(alice.get("/net-worth"))
    assert after["liquid_net_worth"] == before["liquid_net_worth"] == "5000.00"
    assert after["net_worth"] == "5000.00"
    assert after["unvested_equity_excluded"] == "100000.00"
    assert "UNVESTED_EQUITY_EXCLUDED" in {w["code"] for w in after["warnings"]}


def test_ac007_stale_balance_visible_not_zeroed(alice: Api) -> None:
    """AC-007: an old balance stays in net worth, flagged stale (never zeroed or silently updated)."""
    old = (TODAY - timedelta(days=120)).isoformat()
    acc = alice.account(type_="brokerage", amount="42000", as_of=old)
    assert acc["stale"] is True
    assert acc["latest_valuation"]["amount"] == "42000.00"
    nw = alice.ok(alice.get("/net-worth"))
    item = next(i for i in nw["items"] if i["ref_id"] == acc["id"])
    assert item["stale"] is True and item["amount"] == "42000.00"
    assert nw["gross_assets"] == "42000.00"
    assert "STALE_BALANCE" in {w["code"] for w in nw["warnings"]}
    listed = alice.ok(alice.get("/accounts"))["items"]
    assert listed[0]["stale"] is True
    ins = alice.ok(alice.get("/insights"))
    assert "STALE_BALANCE" in {i["code"] for i in ins["items"]}


def test_account_crud_valuations_and_supersession(alice: Api) -> None:
    acc = alice.account(type_="savings", amount="100")
    assert acc["goal_eligible"] is True and acc["accessibility"] == "liquid"
    got = alice.ok(alice.get(f"/accounts/{acc['id']}"))
    assert got["latest_valuation"]["amount"] == "100.00"

    v2 = alice.ok(
        alice.post(
            f"/accounts/{acc['id']}/valuations",
            {"amount": "250.50", "as_of": TODAY.isoformat(), "verification_status": "estimated"},
        ),
        201,
    )
    corr = alice.ok(
        alice.post(
            f"/accounts/{acc['id']}/valuations",
            {
                "amount": "260.00",
                "as_of": TODAY.isoformat(),
                "verification_status": "verified",
                "supersedes_id": v2["id"],
            },
        ),
        201,
    )
    vals = alice.ok(alice.get(f"/accounts/{acc['id']}/valuations"))["items"]
    by_id = {v["id"]: v for v in vals}
    assert by_id[v2["id"]]["superseded_by"] == corr["id"]
    assert len(vals) == 3
    again = alice.post(
        f"/accounts/{acc['id']}/valuations",
        {"amount": "1", "as_of": TODAY.isoformat(), "verification_status": "verified", "supersedes_id": v2["id"]},
    )
    assert again.status_code == 409 and again.json()["code"] == "ALREADY_SUPERSEDED"
    assert alice.ok(alice.get(f"/accounts/{acc['id']}"))["latest_valuation"]["amount"] == "260.00"

    neg = alice.post(
        f"/accounts/{acc['id']}/valuations",
        {"amount": "-5", "as_of": TODAY.isoformat(), "verification_status": "verified"},
    )
    assert neg.status_code == 422 and neg.json()["code"] == "NEGATIVE_AMOUNT"
    flt = alice.post(
        f"/accounts/{acc['id']}/valuations",
        {"amount": 5.5, "as_of": TODAY.isoformat(), "verification_status": "verified"},
    )
    assert flt.status_code == 422

    patched = alice.ok(alice.patch(f"/accounts/{acc['id']}", {"name": "Renamed", "version": got["version"]}))
    assert patched["name"] == "Renamed" and patched["version"] == got["version"] + 1
    stale_write = alice.patch(f"/accounts/{acc['id']}", {"name": "Again", "version": got["version"]})
    assert stale_write.status_code == 409 and stale_write.json()["code"] == "VERSION_CONFLICT"
    cur = alice.patch(f"/accounts/{acc['id']}", {"currency": "INR"})
    assert cur.status_code == 409 and cur.json()["code"] == "CURRENCY_LOCKED"

    override = alice.patch(f"/accounts/{acc['id']}", {"accessibility": "restricted"})
    assert override.status_code == 422 and override.json()["code"] == "OVERRIDE_NOTE_REQUIRED"
    ok = alice.ok(
        alice.patch(
            f"/accounts/{acc['id']}",
            {"accessibility": "restricted", "accessibility_override_note": "locked for a year", "goal_eligible": False},
        )
    )
    assert ok["accessibility"] == "restricted"

    assert alice.delete(f"/accounts/{acc['id']}").status_code == 204
    assert alice.get(f"/accounts/{acc['id']}").status_code == 404
    events = {e["action"] for e in alice.ok(alice.get("/me/security-events", params={"limit": 200}))["items"]}
    assert "account.deleted" in events


def test_account_validation(alice: Api) -> None:
    bad_kind = alice.post(
        "/accounts", {"kind": "asset", "type": "mortgage", "name": "x", "country": "US", "currency": "USD"}
    )
    assert bad_kind.status_code == 422
    bad_fd = alice.post(
        "/accounts",
        {
            "kind": "asset",
            "type": "fixed_deposit",
            "name": "FD",
            "country": "IN",
            "currency": "INR",
            "details": {"principal": "1"},
        },
    )
    assert bad_fd.status_code == 422
    neg = alice.post(
        "/accounts",
        {
            "kind": "asset",
            "type": "cash",
            "name": "c",
            "country": "US",
            "currency": "USD",
            "initial_valuation": {"amount": "-1", "as_of": TODAY.isoformat(), "verification_status": "verified"},
        },
    )
    assert neg.status_code == 422 and neg.json()["code"] == "NEGATIVE_AMOUNT"
    k401 = alice.post(
        "/accounts",
        {
            "kind": "asset",
            "type": "retirement_401k",
            "name": "401k",
            "country": "US",
            "currency": "USD",
            "details": {"pretax_balance": "100", "roth_balance": "50"},
            "initial_valuation": {"amount": "200", "as_of": TODAY.isoformat(), "verification_status": "verified"},
        },
    )
    assert k401.status_code == 422 and k401.json()["code"] == "INCONSISTENT_BALANCES"
    k401_ok = alice.ok(
        alice.post(
            "/accounts",
            {
                "kind": "asset",
                "type": "retirement_401k",
                "name": "401k",
                "country": "US",
                "currency": "USD",
                "details": {"pretax_balance": "100", "roth_balance": "50"},
                "initial_valuation": {"amount": "150", "as_of": TODAY.isoformat(), "verification_status": "verified"},
            },
        ),
        201,
    )
    assert k401_ok["details"]["access_age"] == "59.5"


def test_free_plan_account_limit(alice: Api) -> None:
    for _ in range(5):
        alice.account(amount=None)
    r = alice.post("/accounts", {"kind": "asset", "type": "cash", "name": "6th", "country": "US", "currency": "USD"})
    assert r.status_code == 402
    body = r.json()
    assert body["code"] == "PLAN_LIMIT" and "accounts" in body["detail"]


def test_ac004_other_household_account_is_404(alice: Api, bob: Api) -> None:
    acc = alice.account(amount="987654321")
    for r in (
        bob.get(f"/accounts/{acc['id']}"),
        bob.patch(f"/accounts/{acc['id']}", {"name": "x"}),
        bob.delete(f"/accounts/{acc['id']}"),
        bob.get(f"/accounts/{acc['id']}/valuations"),
        bob.post(
            f"/accounts/{acc['id']}/valuations",
            {"amount": "1", "as_of": TODAY.isoformat(), "verification_status": "verified"},
        ),
    ):
        assert r.status_code == 404, r.text
        assert "987654321" not in r.text
    assert bob.ok(bob.get("/accounts"))["items"] == []
    assert bob.ok(bob.get("/net-worth"))["gross_assets"] == "0.00"


def test_net_worth_history(alice: Api) -> None:
    alice.account(type_="cash", amount="1000", as_of=(TODAY - timedelta(days=95)).isoformat())
    hist = alice.ok(alice.get("/net-worth/history", params={"months": 6}))["items"]
    assert hist, hist
    assert all(h["net_worth"] == "1000.00" for h in hist)
    assert all(date.fromisoformat(h["as_of"]) >= TODAY - timedelta(days=95) for h in hist)


def test_insights_inr_exposure_and_concentration(alice: Api) -> None:
    alice.fx("85")
    alice.account(type_="cash", amount="10000")
    alice.account(type_="savings", currency="INR", country="IN", amount="850000")
    ins = alice.ok(alice.get("/insights"))["items"]
    by_code = {i["code"]: i for i in ins}
    assert by_code["INR_EXPOSURE"]["value"] == "1000.00"  # 10% of the USD 10,000 held in INR
    assert by_code["LIQUIDITY_SHARE"]["value"].startswith("100")


def test_fx_rates_and_reference(alice: Api, fake_http) -> None:  # type: ignore[no-untyped-def]
    import httpx

    r = alice.get("/fx/rates", params={"base": "USD", "quote": "INR"})
    assert r.status_code == 404 and r.json()["code"] == "FX_RATE_MISSING"
    saved = alice.fx("84.50")
    assert saved["kind"] == "user" and saved["rate"] == "84.5"
    got = alice.ok(alice.get("/fx/rates", params={"base": "USD", "quote": "INR"}))
    assert got["stale"] is False
    inv = alice.ok(alice.get("/fx/rates", params={"base": "INR", "quote": "USD"}))
    assert inv["rate"].startswith("0.01183")

    # feed down, nothing cached → 503
    down = alice.get("/fx/reference", params={"base": "USD", "quote": "INR"})
    assert down.status_code == 503 and down.json()["code"] == "FX_FEED_UNAVAILABLE"

    fake_http.handlers["fx.test"] = lambda req: httpx.Response(
        200, text='{"amount":1.0,"base":"USD","date":"2026-10-09","rates":{"INR":83.912}}'
    )
    ref = alice.ok(alice.get("/fx/reference", params={"base": "USD", "quote": "INR"}))
    assert ref["kind"] == "reference" and ref["rate"] == "83.912"
    assert ref["provider"] == "frankfurter.app (ECB reference)"
    assert ref["license_reference"] is None
    # cached: no second HTTP call within 24h
    n = len(fake_http.calls)
    alice.ok(alice.get("/fx/reference", params={"base": "USD", "quote": "INR"}))
    assert len(fake_http.calls) == n
    # the reference rate is never used as the user's rate
    assert alice.ok(alice.get("/fx/rates", params={"base": "USD", "quote": "INR"}))["rate"].startswith("84.5")


def test_fx_reference_serves_stale_cache_when_feed_fails(alice: Api, fake_http, db) -> None:  # type: ignore[no-untyped-def]
    import httpx
    from sqlalchemy import update

    from wealthpilot_api.modules.market_data.models import FxRate

    fake_http.handlers["fx.test"] = lambda req: httpx.Response(
        200, text='{"amount":1.0,"base":"USD","date":"2026-10-09","rates":{"INR":83.9}}'
    )
    alice.ok(alice.get("/fx/reference", params={"base": "USD", "quote": "INR"}))
    with db.session() as s:
        s.execute(
            update(FxRate).where(FxRate.kind == "reference").values(fetched_at=FxRate.fetched_at - timedelta(days=3))
        )
        s.commit()
    fake_http.handlers["fx.test"] = lambda req: httpx.Response(500)
    ref = alice.ok(alice.get("/fx/reference", params={"base": "USD", "quote": "INR"}))
    assert ref["stale"] is True and ref["rate"] == "83.9"


def test_prices(alice: Api) -> None:
    assert alice.get("/prices", params={"symbol": "acme"}).json()["code"] == "MISSING_PRICE"
    alice.ok(
        alice.post("/prices", {"symbol": "acme", "price": "180.25", "currency": "USD", "as_of": TODAY.isoformat()}), 201
    )
    p = alice.ok(alice.get("/prices", params={"symbol": "ACME"}))
    assert p["symbol"] == "ACME" and p["price"] == "180.25" and p["provider"] == "manual" and p["stale"] is False
