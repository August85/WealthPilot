from __future__ import annotations

import copy
from datetime import date
from decimal import Decimal
from typing import Any

from wealthpilot_calc.samples import seed_assumptions_dict

from .conftest import Api

TODAY = date.today()


def household(api: Api) -> None:
    """A small synthetic household: USD cash + brokerage, INR EPF with unverified access, ACME grant."""
    api.fx("85")
    api.account(type_="checking", amount="180000")
    api.account(type_="brokerage", amount="220000")
    api.account(
        type_="epf",
        currency="INR",
        country="IN",
        amount="2500000",
        details={"interest_rate_annual": "0.0825", "access_status": "unknown"},
    )
    api.ok(api.post("/prices", {"symbol": "ACME", "price": "180", "currency": "USD", "as_of": TODAY.isoformat()}), 201)
    api.ok(
        api.post(
            "/rsu/grants",
            {
                "employer_name": "Acme",
                "symbol": "ACME",
                "grant_date": "2025-12-15",
                "granted_shares": "800",
                "default_withholding_rate": "0.37",
                "schedule": {"start_date": "2025-12-15", "cliff_months": 0, "frequency_months": 3, "total_months": 48},
            },
        ),
        201,
    )


def assumptions(**home: Any) -> dict[str, Any]:
    a = seed_assumptions_dict()
    a["home"].update(home)
    return a


def scenario(api: Api, name: str = "Home plan", **kw: Any) -> dict[str, Any]:
    return api.ok(
        api.post(
            "/scenarios",
            {"name": name, "kind": "home", "preset": "baseline", "assumptions": kw.pop("a", assumptions()), **kw},
        ),
        201,
    )


def run(api: Api, version_id: str, seed: int | None = None) -> dict[str, Any]:
    r = api.ok(api.post(f"/scenario-versions/{version_id}/runs", {"seed": seed}), 202)
    assert r["status"] == "completed", r
    return r


def test_defaults_require_fx_and_apply_presets(alice: Api) -> None:
    r = alice.get("/scenarios/defaults")
    assert r.status_code == 422 and r.json()["code"] == "FX_RATE_MISSING"
    household(alice)
    base = alice.ok(alice.get("/scenarios/defaults", params={"preset": "baseline", "kind": "home"}))
    assert base["fx"]["usd_inr_start"] == "85"
    assert base["epf"]["accessible_from_age"] is None
    assert base["rsu"]["price_now"] == "180"
    cons = alice.ok(alice.get("/scenarios/defaults", params={"preset": "conservative"}))
    opt = alice.ok(alice.get("/scenarios/defaults", params={"preset": "optimistic"}))
    d = Decimal
    assert d(cons["returns"]["us_portfolio_annual"]) == d(base["returns"]["us_portfolio_annual"]) - d("0.02")
    assert d(cons["inflation"]["us_annual"]) == d(base["inflation"]["us_annual"]) + d("0.01")
    assert d(cons["fx"]["inr_depreciation_annual"]) == d(base["fx"]["inr_depreciation_annual"]) + d("0.01")
    assert d(cons["rsu"]["price_growth_annual"]) == d(base["rsu"]["price_growth_annual"]) - d("0.10")
    assert d(opt["returns"]["india_portfolio_annual"]) == d(base["returns"]["india_portfolio_annual"]) + d("0.01")
    assert d(opt["rsu"]["price_growth_annual"]) == d(base["rsu"]["price_growth_annual"]) + d("0.05")
    assert d(opt["fx"]["inr_depreciation_annual"]) == d(base["fx"]["inr_depreciation_annual"]) - d("0.01")


def test_scenario_lifecycle_versions_runs_results(alice: Api) -> None:
    household(alice)
    s = scenario(alice)
    v1 = s["active_version"]
    assert v1["number"] == 1 and v1["input_hash"].startswith("sha256:")
    snap = v1["snapshot"]
    assert {a["type"] for a in snap["accounts"]} == {"checking", "brokerage", "epf"}
    assert snap["fx"]["USD/INR"]["rate"] == "85" or snap["fx"]["USD/INR"]["rate"].startswith("85")
    assert snap["rsu_grants"][0]["symbol"] == "ACME"

    r = run(alice, v1["id"])
    assert r["checksum"].startswith("sha256:")
    got = alice.ok(alice.get(f"/runs/{r['id']}"))
    assert got["status"] == "completed" and got["checksum"] == r["checksum"]
    res = alice.ok(alice.get(f"/runs/{r['id']}/results"))
    assert res["run_id"] == r["id"]
    assert res["checksum"] == r["checksum"]
    assert res["input_hash"] == v1["input_hash"]
    assert res["model_version"] == "1.0.0"
    m = res["metrics"]
    for key in ("net_worth_now", "liquid_net_worth_now", "home_pi_monthly", "home_all_in_monthly", "home_cash_needed"):
        assert isinstance(m[key], str)
    assert "EPF_ACCESS_UNVERIFIED" in {w["code"] for w in res["warnings"]}
    assert res["yearly"] and res["home"]["all_in_monthly"]["total"]

    listed = alice.ok(alice.get("/scenarios"))["items"]
    assert listed[0]["latest_run"]["id"] == r["id"]

    # new version becomes active; versions are immutable and numbered
    a2 = assumptions(hoa_monthly="300")
    v2 = alice.ok(alice.post(f"/scenarios/{s['id']}/versions", {"assumptions": a2, "notes": "add HOA"}), 201)
    assert v2["number"] == 2
    vs = alice.ok(alice.get(f"/scenarios/{s['id']}/versions"))["items"]
    assert [v["number"] for v in vs] == [2, 1] or [v["number"] for v in vs] == [1, 2]
    assert alice.ok(alice.get(f"/scenarios/{s['id']}"))["active_version"]["id"] == v2["id"]

    # patch (rename / archive) with optimistic concurrency
    cur = alice.ok(alice.get(f"/scenarios/{s['id']}"))
    p = alice.ok(alice.patch(f"/scenarios/{s['id']}", {"name": "Renamed", "version": cur["version"]}))
    assert p["name"] == "Renamed"
    c = alice.patch(f"/scenarios/{s['id']}", {"name": "X", "version": cur["version"]})
    assert c.status_code == 409 and c.json()["code"] == "VERSION_CONFLICT"
    arch = alice.ok(alice.patch(f"/scenarios/{s['id']}", {"archived": True}))
    assert arch["archived"] is True
    assert alice.ok(alice.get("/scenarios"))["items"] == []
    assert len(alice.ok(alice.get("/scenarios", params={"include_archived": True}))["items"]) == 1


def test_ac003_hoa_changes_all_in_not_pi(alice: Api) -> None:
    """AC-003: P&I is separate from tax/insurance/HOA; changing HOA changes all-in cost but not P&I."""
    household(alice)
    s = scenario(alice, a=assumptions(hoa_monthly="0"))
    r1 = run(alice, s["active_version"]["id"])
    v2 = alice.ok(alice.post(f"/scenarios/{s['id']}/versions", {"assumptions": assumptions(hoa_monthly="450")}), 201)
    r2 = run(alice, v2["id"])
    h1 = alice.ok(alice.get(f"/runs/{r1['id']}/results"))["home"]
    h2 = alice.ok(alice.get(f"/runs/{r2['id']}/results"))["home"]
    assert h1["pi_monthly"] == h2["pi_monthly"] == "6403.46"
    a1, a2 = h1["all_in_monthly"], h2["all_in_monthly"]
    assert a1["principal_interest"] == a2["principal_interest"] == "6403.46"
    assert a1["property_tax"] == a2["property_tax"] and a1["insurance"] == a2["insurance"] == "200.00"
    assert a1["hoa"] == "0.00" and a2["hoa"] == "450.00"
    assert Decimal(a2["total"]) - Decimal(a1["total"]) == Decimal("450.00")


def test_ac005_identical_version_runs_have_identical_checksum(alice: Api) -> None:
    household(alice)
    s = scenario(alice)
    vid = s["active_version"]["id"]
    r1, r2 = run(alice, vid), run(alice, vid)
    assert r1["id"] != r2["id"]
    assert r1["checksum"] == r2["checksum"]
    res1 = alice.ok(alice.get(f"/runs/{r1['id']}/results"))
    res2 = alice.ok(alice.get(f"/runs/{r2['id']}/results"))
    strip = lambda d: {k: v for k, v in d.items() if k not in ("run_id", "seed")}  # noqa: E731
    assert strip(res1) == strip(res2)


def test_clone_comparisons_and_plan_limit(alice: Api) -> None:
    household(alice)
    s = scenario(alice)
    # free plan: 1 scenario
    lim = alice.post("/scenarios", {"name": "Second", "kind": "home", "assumptions": assumptions()})
    assert lim.status_code == 402 and lim.json()["code"] == "PLAN_LIMIT"
    clone_lim = alice.post(f"/scenarios/{s['id']}/clone", {"name": "Copy"})
    assert clone_lim.status_code == 402

    _set_entitlement(alice, "plus")
    clone = alice.ok(alice.post(f"/scenarios/{s['id']}/clone", {"name": "Delayed"}), 201)
    assert clone["parent_id"] == s["id"]
    assert clone["active_version"]["assumptions"] == s["active_version"]["assumptions"]
    delayed = copy.deepcopy(s["active_version"]["assumptions"])
    delayed["home"]["purchase_date"] = "2032-10-01"
    v = alice.ok(alice.post(f"/scenarios/{clone['id']}/versions", {"assumptions": delayed}), 201)
    r1 = run(alice, s["active_version"]["id"])
    r2 = run(alice, v["id"])
    cmp_ = alice.ok(alice.post("/comparisons", {"run_ids": [r1["id"], r2["id"]]}))
    assert [x["scenario_name"] for x in cmp_["runs"]] == ["Home plan", "Delayed"]
    pt = cmp_["series"]["net_worth"][0]
    assert set(pt["values"]) == {r1["id"], r2["id"]}
    assert set(cmp_["series"]) == {"net_worth", "liquid_net_worth", "retirement_balance"}
    too_many = alice.post("/comparisons", {"run_ids": [r1["id"]] * 5})
    assert too_many.status_code == 422


def test_scenario_assumption_validation(alice: Api) -> None:
    household(alice)
    a = assumptions()
    a["returns"]["us_portfolio_annual"] = 0.06  # floats are rejected
    r = alice.post("/scenarios", {"name": "Bad", "kind": "home", "assumptions": a})
    assert r.status_code == 422


def test_ac004_other_household_scenario_and_run_404(alice: Api, bob: Api) -> None:
    household(alice)
    s = scenario(alice)
    r = run(alice, s["active_version"]["id"])
    for resp in (
        bob.get(f"/scenarios/{s['id']}"),
        bob.patch(f"/scenarios/{s['id']}", {"name": "x"}),
        bob.post(f"/scenarios/{s['id']}/clone", {"name": "x"}),
        bob.get(f"/scenarios/{s['id']}/versions"),
        bob.post(f"/scenarios/{s['id']}/versions", {"assumptions": assumptions()}),
        bob.post(f"/scenario-versions/{s['active_version']['id']}/runs", {}),
        bob.get(f"/runs/{r['id']}"),
        bob.get(f"/runs/{r['id']}/results"),
        bob.post("/comparisons", {"run_ids": [r["id"]]}),
        bob.post("/exports", {"format": "pdf", "scope": "run", "run_id": r["id"]}),
    ):
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "NOT_FOUND"
        assert "checksum" not in resp.text


def test_run_queued_without_inline_and_worker_processes(alice: Api, app, db) -> None:  # type: ignore[no-untyped-def]
    from wealthpilot_api.modules.jobs.service import run_pending

    household(alice)
    s = scenario(alice)
    app.state.settings.inline_jobs = False
    try:
        r = alice.ok(alice.post(f"/scenario-versions/{s['active_version']['id']}/runs", {}), 202)
        assert r["status"] == "queued"
        nc = alice.get(f"/runs/{r['id']}/results")
        assert nc.status_code == 409 and nc.json()["code"] == "RUN_NOT_COMPLETE"
        assert run_pending(app.state.job_context, "test-worker") == 1
        done = alice.ok(alice.get(f"/runs/{r['id']}"))
        assert done["status"] == "completed" and done["checksum"]
        # idempotent: a second processing pass finds nothing to do
        assert run_pending(app.state.job_context, "test-worker") == 0
    finally:
        app.state.settings.inline_jobs = True


def test_goals_crud_progress_and_limit(alice: Api) -> None:
    household(alice)
    g = alice.ok(
        alice.post(
            "/goals",
            {
                "type": "home_purchase",
                "name": "House",
                "target_date": "2030-10-01",
                "target_amount": "800000",
                "currency": "USD",
                "priority": 1,
            },
        ),
        201,
    )
    # goal-eligible funds = liquid checking + brokerage = 400,000
    assert g["progress"]["funded_amount"] == "400000.00"
    assert g["progress"]["pct"] == "50.00"
    assert g["progress"]["scenario_run_id"] is None
    lim = alice.post("/goals", {"type": "custom", "name": "Car", "target_amount": "1", "currency": "USD"})
    assert lim.status_code == 402 and lim.json()["code"] == "PLAN_LIMIT"

    s = scenario(alice)
    r = run(alice, s["active_version"]["id"])
    linked = alice.ok(alice.patch(f"/goals/{g['id']}", {"scenario_id": s["id"], "version": g["version"]}))
    assert linked["progress"]["scenario_run_id"] == r["id"]
    res = alice.ok(alice.get(f"/runs/{r['id']}/results"))
    assert linked["progress"]["funded_amount"] == res["metrics"]["home_cash_available_at_purchase"]
    conflict = alice.patch(f"/goals/{g['id']}", {"name": "x", "version": g["version"]})
    assert conflict.status_code == 409
    assert len(alice.ok(alice.get("/goals"))["items"]) == 1
    assert alice.ok(alice.get(f"/goals/{g['id']}"))["name"] == "House"
    assert alice.delete(f"/goals/{g['id']}").status_code == 204
    assert alice.get(f"/goals/{g['id']}").status_code == 404


def test_goal_other_household_404(alice: Api, bob: Api) -> None:
    g = alice.ok(alice.post("/goals", {"type": "custom", "name": "G", "target_amount": "10", "currency": "USD"}), 201)
    assert bob.get(f"/goals/{g['id']}").status_code == 404
    assert bob.patch(f"/goals/{g['id']}", {"name": "x"}).status_code == 404
    assert bob.delete(f"/goals/{g['id']}").status_code == 404


def _set_entitlement(api: Api, entitlement: str) -> None:
    from .conftest import WEBHOOK_SECRET

    me = api.ok(api.get("/me"))
    r = api.c.post(
        "/v1/billing/revenuecat/webhook",
        headers={"Authorization": WEBHOOK_SECRET},
        json={
            "api_version": "1.0",
            "event": {
                "id": f"evt-{entitlement}-{me['id']}",
                "type": "INITIAL_PURCHASE",
                "app_user_id": me["id"],
                "entitlement_ids": [entitlement],
                "expiration_at_ms": 4102444800000,
            },
        },
    )
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text
    assert api.ok(api.get("/me"))["entitlement"] == entitlement
