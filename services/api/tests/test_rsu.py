from __future__ import annotations

from datetime import date, timedelta

from .conftest import Api

TODAY = date.today()


def _grant(api: Api, **extra) -> dict:  # type: ignore[no-untyped-def]
    body = {
        "employer_name": "Acme",
        "symbol": "ACME",
        "grant_date": "2025-03-15",
        "granted_shares": "400",
        "grant_price": "150.00",
        "default_withholding_rate": "0.37",
        "schedule": {"start_date": "2025-03-15", "cliff_months": 12, "frequency_months": 3, "total_months": 48},
        **extra,
    }
    return api.ok(api.post("/rsu/grants", body), 201)


def test_schedule_generation_and_totals(alice: Api) -> None:
    g = _grant(alice)
    vests = g["vests"]
    # cliff at 12 months carries 4 quarters, then 12 quarterly vests
    assert len(vests) == 13
    assert vests[0]["vest_date"] == "2026-03-15" and vests[0]["scheduled_shares"] == "100"
    assert all(v["scheduled_shares"] == "25" for v in vests[1:])
    assert sum(int(v["scheduled_shares"]) for v in vests) == 400
    assert g["totals"] == {
        "scheduled": "400",
        "vested": "0",
        "withheld": "0",
        "sold": "0",
        "held": "0",
        "unvested": "400",
    }
    assert g["grant_price"] == "150.00" and g["default_withholding_rate"] == "0.37"


def test_record_vest_dispositions_and_share_conservation(alice: Api) -> None:
    g = _grant(alice)
    v = g["vests"][0]
    bad = alice.patch(
        f"/rsu/vests/{v['id']}",
        {"status": "vested", "vested_shares": "100", "vest_fmv": "180", "withheld_shares": "101"},
    )
    assert bad.status_code == 422
    rec = alice.ok(
        alice.patch(
            f"/rsu/vests/{v['id']}",
            {
                "status": "vested",
                "vested_shares": "100",
                "vest_fmv": "180.00",
                "withheld_shares": "37",
                "version": v["version"],
            },
        )
    )
    assert rec["status"] == "vested"
    conflict = alice.patch(
        f"/rsu/vests/{v['id']}", {"status": "vested", "vested_shares": "100", "version": v["version"]}
    )
    assert conflict.status_code == 409 and conflict.json()["code"] == "VERSION_CONFLICT"

    d = alice.ok(
        alice.post(
            f"/rsu/vests/{v['id']}/dispositions",
            {"date": "2026-03-20", "kind": "sale", "shares": "50.5", "price": "181.10", "fees": "4.95"},
        ),
        201,
    )
    assert d["shares"] == "50.5" and d["fees"] == "4.95"
    over = alice.post(
        f"/rsu/vests/{v['id']}/dispositions",
        {"date": "2026-03-21", "kind": "sale", "shares": "12.5000001", "price": "181"},
    )
    assert over.status_code == 422 and over.json()["code"] == "SHARE_CONSERVATION"
    exact = alice.ok(
        alice.post(
            f"/rsu/vests/{v['id']}/dispositions",
            {"date": "2026-03-21", "kind": "sale", "shares": "12.5", "price": "181"},
        ),
        201,
    )
    assert exact["shares"] == "12.5"

    grant = alice.ok(alice.get(f"/rsu/grants/{g['id']}"))
    assert grant["totals"]["vested"] == "100"
    assert grant["totals"]["withheld"] == "37"
    assert grant["totals"]["sold"] == "63"
    assert grant["totals"]["held"] == "0"
    assert grant["totals"]["unvested"] == "300"

    # cannot un-vest or delete a vest that has dispositions
    unvest = alice.patch(f"/rsu/vests/{v['id']}", {"status": "scheduled"})
    assert unvest.status_code == 409
    assert alice.delete(f"/rsu/vests/{v['id']}").json()["code"] == "VEST_HAS_DISPOSITIONS"

    # cannot dispose of unvested shares
    future = grant["vests"][1]
    early = alice.post(
        f"/rsu/vests/{future['id']}/dispositions", {"date": "2026-06-20", "kind": "sale", "shares": "1", "price": "181"}
    )
    assert early.status_code == 422 and early.json()["code"] == "SHARE_CONSERVATION"


def test_duplicate_vest_rejected(alice: Api) -> None:
    g = _grant(alice, schedule=None)
    body = {"vest_date": "2027-01-15", "scheduled_shares": "10", "source_event_id": "broker-123"}
    alice.ok(alice.post(f"/rsu/grants/{g['id']}/vests", body), 201)
    dup = alice.post(f"/rsu/grants/{g['id']}/vests", body)
    assert dup.status_code == 409 and dup.json()["code"] == "DUPLICATE_VEST"
    # manual entries without a source event id are also de-duplicated per date
    manual = {"vest_date": "2027-04-15", "scheduled_shares": "10"}
    alice.ok(alice.post(f"/rsu/grants/{g['id']}/vests", manual), 201)
    assert alice.post(f"/rsu/grants/{g['id']}/vests", manual).json()["code"] == "DUPLICATE_VEST"


def test_grant_patch_delete_and_calendar(alice: Api) -> None:
    start = TODAY + timedelta(days=10)
    g = _grant(
        alice, schedule={"start_date": start.isoformat(), "cliff_months": 0, "frequency_months": 3, "total_months": 12}
    )
    cal = alice.ok(
        alice.get("/rsu/calendar", params={"from": TODAY.isoformat(), "to": (TODAY + timedelta(days=400)).isoformat()})
    )
    assert len(cal["items"]) == 4
    assert cal["items"][0]["estimated_gross_value"] is None
    assert "MISSING_PRICE" in {w["code"] for w in cal["warnings"]}
    alice.ok(
        alice.post("/prices", {"symbol": "ACME", "price": "200", "currency": "USD", "as_of": TODAY.isoformat()}), 201
    )
    cal = alice.ok(
        alice.get("/rsu/calendar", params={"from": TODAY.isoformat(), "to": (TODAY + timedelta(days=400)).isoformat()})
    )
    assert cal["items"][0]["estimated_gross_value"] == "20000.00"
    assert cal["items"][0]["currency"] == "USD"

    p = alice.ok(alice.patch(f"/rsu/grants/{g['id']}", {"employer_name": "Acme Corp", "version": g["version"]}))
    assert p["employer_name"] == "Acme Corp"
    assert alice.patch(f"/rsu/grants/{g['id']}", {"employer_name": "x", "version": g["version"]}).status_code == 409
    assert alice.delete(f"/rsu/grants/{g['id']}").status_code == 204
    assert alice.get(f"/rsu/grants/{g['id']}").status_code == 404
    assert alice.ok(alice.get("/rsu/grants"))["items"] == []


def test_held_in_brokerage_not_double_counted(alice: Api) -> None:
    brk = alice.account(type_="brokerage", amount="20000")
    alice.ok(
        alice.post("/prices", {"symbol": "ACME", "price": "200", "currency": "USD", "as_of": TODAY.isoformat()}), 201
    )
    g = _grant(alice, schedule=None, held_in_account_id=brk["id"])
    v = alice.ok(
        alice.post(f"/rsu/grants/{g['id']}/vests", {"vest_date": "2026-01-15", "scheduled_shares": "100"}), 201
    )
    alice.ok(
        alice.patch(
            f"/rsu/vests/{v['id']}",
            {"status": "vested", "vested_shares": "100", "vest_fmv": "150", "withheld_shares": "0"},
        )
    )
    nw = alice.ok(alice.get("/net-worth"))
    assert nw["gross_assets"] == "20000.00"
    assert "RSU_HELD_IN_BROKERAGE" in {w["code"] for w in nw["warnings"]}

    alice.ok(alice.patch(f"/rsu/grants/{g['id']}", {"held_in_account_id": None}))
    nw = alice.ok(alice.get("/net-worth"))
    assert nw["gross_assets"] == "40000.00"  # 100 held shares x 200 added as a liquid asset


def test_ac004_other_household_grant_is_404(alice: Api, bob: Api) -> None:
    g = _grant(alice)
    vid = g["vests"][0]["id"]
    assert bob.get(f"/rsu/grants/{g['id']}").status_code == 404
    assert bob.patch(f"/rsu/grants/{g['id']}", {"employer_name": "x"}).status_code == 404
    assert bob.delete(f"/rsu/grants/{g['id']}").status_code == 404
    assert (
        bob.post(f"/rsu/grants/{g['id']}/vests", {"vest_date": "2030-01-01", "scheduled_shares": "1"}).status_code
        == 404
    )
    assert bob.patch(f"/rsu/vests/{vid}", {"status": "cancelled"}).status_code == 404
    assert (
        bob.post(
            f"/rsu/vests/{vid}/dispositions", {"date": "2026-03-20", "kind": "sale", "shares": "1", "price": "1"}
        ).status_code
        == 404
    )
    assert bob.ok(bob.get("/rsu/calendar"))["items"] == []
