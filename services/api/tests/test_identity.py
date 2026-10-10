from __future__ import annotations

from fastapi.testclient import TestClient

from wealthpilot_api.core.config import Settings

from .conftest import Api, auth


def test_health_and_ready(client: TestClient) -> None:
    for path in ("/healthz", "/readyz", "/v1/healthz", "/v1/readyz"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.json() == {"status": "ok"}
        assert r.headers["x-request-id"]


def test_request_id_echoed_and_problem_format(client: TestClient) -> None:
    r = client.get("/v1/me", headers={"X-Request-ID": "req-12345678"})
    assert r.status_code == 401
    assert r.headers["x-request-id"] == "req-12345678"
    body = r.json()
    assert r.headers["content-type"].startswith("application/problem+json")
    assert body["code"] == "UNAUTHENTICATED"
    assert body["request_id"] == "req-12345678"
    assert set(body) >= {"type", "title", "status", "detail", "code", "request_id"}


def test_unknown_route_is_problem(client: TestClient) -> None:
    r = client.get("/v1/nope", headers=auth())
    assert r.status_code == 404
    assert r.json()["code"] == "NOT_FOUND"


def test_dev_auth_refused_in_production() -> None:
    import pytest

    with pytest.raises(ValueError):
        Settings(env="production", auth_mode="dev", secret_key="x" * 32)


def test_me_autoprovision_and_onboarding(client: TestClient) -> None:
    api = Api(client, "carol")
    me = api.ok(api.get("/me"))
    assert me["onboarding_completed"] is False
    assert me["household_id"] is None
    assert me["entitlement"] == "free"
    assert me["limits"] == {"accounts": 5, "goals": 1, "scenarios": 1}

    # data endpoints require onboarding
    r = api.get("/accounts")
    assert r.status_code == 409 and r.json()["code"] == "ONBOARDING_REQUIRED"

    bad = api.post("/me/onboarding", {**_onb(), "disclaimer_accepted": False})
    assert bad.status_code == 422

    me = api.onboard()
    assert me["onboarding_completed"] is True
    assert me["household_id"]
    assert me["disclaimer_accepted_at"]
    # idempotent
    again = api.onboard()
    assert again["household_id"] == me["household_id"]

    res = api.ok(api.get("/me/tax-residency"))
    assert len(res["items"]) == 1 and res["items"][0]["jurisdiction"] == "US"
    put = api.ok(
        api.put(
            "/me/tax-residency",
            {
                "items": [
                    {"jurisdiction": "US", "residency_type": "resident", "from_date": "2020-01-01", "to_date": None},
                    {
                        "jurisdiction": "IN",
                        "residency_type": "nri",
                        "from_date": "2020-01-01",
                        "to_date": None,
                        "verified_by_user": True,
                    },
                ]
            },
        )
    )
    assert len(put["items"]) == 2

    patched = api.ok(api.patch("/me", {"display_name": "CK", "reporting_currency": "INR"}))
    assert patched["display_name"] == "CK" and patched["reporting_currency"] == "INR"

    hh = api.ok(api.get(f"/households/{me['household_id']}"))
    assert hh["members"][0]["role"] == "owner"
    hh2 = api.ok(api.patch(f"/households/{me['household_id']}", {"display_name": "Renamed", "version": hh["version"]}))
    assert hh2["display_name"] == "Renamed"
    conflict = api.patch(f"/households/{me['household_id']}", {"display_name": "X", "version": hh["version"]})
    assert conflict.status_code == 409 and conflict.json()["code"] == "VERSION_CONFLICT"

    inv = api.post(f"/households/{me['household_id']}/invites", {})
    assert inv.status_code == 501

    events = api.ok(api.get("/me/security-events"))
    actions = {e["action"] for e in events["items"]}
    assert "auth.user_provisioned" in actions
    assert "auth.session_started" in actions
    assert "settings.profile_changed" in actions or any(a.startswith("settings.") for a in actions)


def test_household_of_other_user_is_404(alice: Api, bob: Api) -> None:
    hid = alice.ok(alice.get("/me"))["household_id"]
    r = bob.get(f"/households/{hid}")
    assert r.status_code == 404
    assert bob.patch(f"/households/{hid}", {"display_name": "pwn"}).status_code == 404


def test_security_events_pagination(alice: Api) -> None:
    for i in range(3):
        alice.ok(alice.patch("/me", {"display_name": f"n{i}"}))
    page = alice.ok(alice.get("/me/security-events", params={"limit": 2}))
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = alice.ok(alice.get("/me/security-events", params={"limit": 2, "cursor": page["next_cursor"]}))
    ids = {e["id"] for e in page["items"]} & {e["id"] for e in page2["items"]}
    assert not ids
    for e in page["items"] + page2["items"]:
        assert "amount" not in str(e["metadata"])


def _onb() -> dict:
    from .conftest import ONBOARDING

    return dict(ONBOARDING)
