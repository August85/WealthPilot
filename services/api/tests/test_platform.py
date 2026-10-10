"""Notifications, billing webhook, privacy deletion (AC-008), idempotency keys and OIDC JWT verification."""

from __future__ import annotations

import json
import re
import time
from datetime import date, timedelta
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import select

from .conftest import WEBHOOK_SECRET, Api, auth

TODAY = date.today()


# ------------------------------------------------------------------------------------------ notifications
def test_notification_preferences_devices_and_daily_job(alice: Api, app: Any, push: Any) -> None:
    from wealthpilot_calc import add_months

    from wealthpilot_api.modules.notifications.service import handle_daily

    prefs = alice.ok(alice.get("/notification-preferences"))["items"]
    assert {p["type"] for p in prefs} == {"vest_reminder", "stale_balance", "goal_milestone"}
    assert all(p["enabled"] is False and p["channel"] == "push" for p in prefs)  # opt-in

    alice.account(type_="cash", amount="99999", as_of=(TODAY - timedelta(days=90)).isoformat())
    alice.ok(
        alice.post(
            "/rsu/grants",
            {
                "employer_name": "Acme",
                "symbol": "ACME",
                "grant_date": "2025-01-01",
                "granted_shares": "100",
                "schedule": {
                    "start_date": add_months(TODAY + timedelta(days=3), -3).isoformat(),
                    "cliff_months": 0,
                    "frequency_months": 3,
                    "total_months": 12,
                },
            },
        ),
        201,
    )

    def daily() -> None:
        with app.state.db.session() as s:
            handle_daily(s, {"date": TODAY.isoformat()}, app.state.job_context)
            s.commit()

    daily()
    assert alice.ok(alice.get("/notifications"))["items"] == []  # nothing until opted in

    dev = alice.ok(alice.post("/devices", {"expo_push_token": "ExponentPushToken[abc]", "platform": "ios"}), 201)
    assert dev["platform"] == "ios"
    upd = alice.ok(
        alice.patch(
            "/notification-preferences",
            {
                "items": [
                    {"type": "vest_reminder", "channel": "push", "enabled": True},
                    {"type": "stale_balance", "channel": "push", "enabled": True},
                ]
            },
        )
    )["items"]
    assert {p["type"]: p["enabled"] for p in upd} == {
        "vest_reminder": True,
        "stale_balance": True,
        "goal_milestone": False,
    }
    daily()
    daily()  # idempotent
    inbox = alice.ok(alice.get("/notifications"))["items"]
    assert sorted(n["type"] for n in inbox) == ["stale_balance", "vest_reminder"]
    vest = next(n for n in inbox if n["type"] == "vest_reminder")
    assert re.fullmatch(r"An RSU vest is scheduled (tomorrow|in [23] days)\.", vest["body"])  # month-end clamping
    for n in inbox:  # FR-NOT-002: no amounts or symbols
        assert not re.search(r"\d{3,}", n["title"] + n["body"]) and "ACME" not in n["body"]
    assert len(push.sent) == 2 and push.sent[0][0] == ["ExponentPushToken[abc]"]

    read = alice.ok(alice.post(f"/notifications/{vest['id']}/read"))
    assert read["read_at"] is not None
    unread = alice.ok(alice.get("/notifications", params={"unread_only": True}))["items"]
    assert [n["type"] for n in unread] == ["stale_balance"]

    assert alice.delete("/devices/ExponentPushToken[abc]").status_code == 204
    assert alice.delete("/devices/ExponentPushToken[abc]").status_code == 404


def test_notifications_are_private(alice: Api, bob: Api, app: Any) -> None:
    from wealthpilot_api.modules.notifications.service import _create

    me = alice.ok(alice.get("/me"))
    with app.state.db.session() as s:
        import uuid

        nid = _create(s, uuid.UUID(me["id"]), "stale_balance", "t", "b", "k1")
        s.commit()
    assert bob.post(f"/notifications/{nid}/read").status_code == 404
    assert bob.ok(bob.get("/notifications"))["items"] == []
    alice.ok(alice.post("/devices", {"expo_push_token": "tok-1", "platform": "android"}), 201)
    assert bob.delete("/devices/tok-1").status_code == 404


def test_expo_sender_posts_without_amounts(settings: Any) -> None:
    from wealthpilot_api.modules.notifications.push import ExpoPushSender

    seen: list[Any] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={"data": []})

    s = ExpoPushSender(httpx.Client(transport=httpx.MockTransport(handler)), "https://exp.test/send", "tok")
    assert s.send(["a", "b"], "Upcoming RSU vest", "An RSU vest is scheduled tomorrow.") == 2
    assert seen[0][0]["to"] == "a" and seen[0][1]["body"] == "An RSU vest is scheduled tomorrow."


# ------------------------------------------------------------------------------------------------ billing
def _webhook(client: TestClient, event: dict[str, Any], secret: str | None = WEBHOOK_SECRET) -> httpx.Response:
    headers = {"Authorization": secret} if secret is not None else {}
    return client.post("/v1/billing/revenuecat/webhook", headers=headers, json={"api_version": "1.0", "event": event})


def test_revenuecat_webhook_updates_entitlement(alice: Api, client: TestClient) -> None:
    me = alice.ok(alice.get("/me"))
    ev = {
        "id": "evt-1",
        "type": "INITIAL_PURCHASE",
        "app_user_id": me["id"],
        "entitlement_ids": ["plus"],
        "expiration_at_ms": int((time.time() + 86400 * 30) * 1000),
    }
    assert _webhook(client, ev, secret=None).status_code == 401
    assert _webhook(client, ev, secret="wrong").status_code == 401
    assert _webhook(client, ev).json() == {"status": "ok"}
    assert _webhook(client, ev).json() == {"status": "duplicate"}
    me = alice.ok(alice.get("/me"))
    assert me["entitlement"] == "plus"
    assert me["limits"] == {"accounts": None, "goals": None, "scenarios": 10}
    for _ in range(6):  # plus: unlimited accounts
        alice.account(amount=None)

    assert (
        _webhook(
            client,
            {
                "id": "evt-2",
                "type": "CANCELLATION",
                "app_user_id": me["id"],
                "expiration_at_ms": int((time.time() + 86400) * 1000),
            },
        ).status_code
        == 200
    )
    assert alice.ok(alice.get("/me"))["entitlement"] == "plus"  # access continues until expiry
    assert (
        _webhook(
            client,
            {"id": "evt-3", "type": "EXPIRATION", "app_user_id": me["id"], "expiration_at_ms": int(time.time() * 1000)},
        ).status_code
        == 200
    )
    assert alice.ok(alice.get("/me"))["entitlement"] == "free"
    lim = alice.post("/accounts", {"kind": "asset", "type": "cash", "name": "x", "country": "US", "currency": "USD"})
    assert lim.status_code == 402
    assert _webhook(client, {"id": "evt-4", "type": "INITIAL_PURCHASE", "app_user_id": "nobody"}).json() == {
        "status": "ignored"
    }
    events = {e["action"] for e in alice.ok(alice.get("/me/security-events", params={"limit": 200}))["items"]}
    assert "billing.entitlement_changed" in events


# ------------------------------------------------------------------------------------------------ privacy
def test_ac008_delete_request_revokes_sessions_and_notifications(alice: Api, client: TestClient, app: Any) -> None:
    from wealthpilot_api.modules.households.models import User
    from wealthpilot_api.modules.jobs.models import Job
    from wealthpilot_api.modules.notifications.models import Device, NotificationPreference
    from wealthpilot_api.modules.privacy.router import handle_erasure

    acc = alice.account(type_="cash", amount="500")
    alice.ok(alice.post("/devices", {"expo_push_token": "tok-del", "platform": "ios"}), 201)
    alice.ok(alice.patch("/notification-preferences", {"items": [{"type": "vest_reminder", "enabled": True}]}))
    from .test_scenarios import household, run, scenario

    household(alice)
    s = scenario(alice)
    run(alice, s["active_version"]["id"])
    alice.ok(alice.post("/exports", {"format": "json", "scope": "balances"}), 202)

    bad = alice.post("/privacy/delete-request", {"confirm": "yes"})
    assert bad.status_code == 422
    r = alice.ok(alice.post("/privacy/delete-request", {"confirm": "DELETE"}), 202)
    assert r["status"] == "scheduled"
    assert date.fromisoformat(r["erase_after"]) == TODAY + timedelta(days=30)

    # the same token (and every token issued before now) is revoked
    after = alice.get("/me")
    assert after.status_code == 401 and after.json()["code"] == "TOKEN_REVOKED"
    assert alice.get(f"/accounts/{acc['id']}").status_code == 401

    with app.state.db.session() as db:
        user = db.scalar(select(User).where(User.auth_subject == "dev|alice"))
        assert user is not None and user.status == "deleted"
        assert db.scalars(select(Device).where(Device.user_id == user.id)).all() == []
        assert all(
            not p.enabled
            for p in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
        )
        job = db.scalar(select(Job).where(Job.type == "privacy_erasure"))
        assert job is not None and job.run_after.date() == TODAY + timedelta(days=30)
        # erasure (normally run by the worker after the delay) removes the household data
        handle_erasure(db, job.payload, app.state.job_context)
        db.commit()
        assert db.scalar(select(User).where(User.auth_subject == "dev|alice")) is None


def test_ac008_jwt_issued_after_revocation_for_deleted_account(client: TestClient, oidc: Any) -> None:
    tok = oidc.token("user-7")
    api = Api(client, "unused")
    api.h = {"Authorization": f"Bearer {tok}"}
    api.onboard()
    api.ok(api.post("/privacy/delete-request", {"confirm": "DELETE"}), 202)
    assert api.get("/me").json()["code"] == "TOKEN_REVOKED"
    time.sleep(1.1)
    api.h = {"Authorization": f"Bearer {oidc.token('user-7')}"}
    r = api.get("/me")
    assert r.status_code == 401 and r.json()["code"] == "ACCOUNT_DELETED"


# -------------------------------------------------------------------------------------------- idempotency
def test_idempotency_key_replays_original_response(alice: Api) -> None:
    body = {"kind": "asset", "type": "cash", "name": "Idem", "country": "US", "currency": "USD"}
    h = {"Idempotency-Key": "key-123"}
    r1 = alice.post("/accounts", body, headers=h)
    r2 = alice.post("/accounts", body, headers=h)
    assert r1.status_code == r2.status_code == 201
    assert r1.json() == r2.json()
    assert r2.headers.get("idempotent-replayed") == "true"
    assert len(alice.ok(alice.get("/accounts"))["items"]) == 1
    reused = alice.post("/accounts", {**body, "name": "Other"}, headers=h)
    assert reused.status_code == 422 and reused.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    # keys are scoped per user
    other = Api(alice.c, "dave")
    other.onboard()
    r3 = other.post("/accounts", body, headers=h)
    assert r3.status_code == 201 and r3.json()["id"] != r1.json()["id"]


def test_idempotency_passes_unauthenticated_requests_through(client: TestClient) -> None:
    r = client.post("/v1/accounts", json={}, headers={"Idempotency-Key": "k"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------------------------- OIDC JWT
class Oidc:
    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.kid = "kid-1"
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        self.jwks = {"keys": [{**jwk, "kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def token(self, sub: str, **claims: Any) -> str:
        now = int(time.time())
        payload = {
            "iss": "https://issuer.test/",
            "aud": "wealthpilot-api",
            "sub": sub,
            "iat": now,
            "exp": now + 600,
            "email": f"{sub}@example.test",
            "sid": f"s-{sub}-{now}",
            **claims,
        }
        return jwt.encode(payload, self.key, algorithm="RS256", headers={"kid": self.kid})


@pytest.fixture
def oidc(fake_http: Any) -> Oidc:
    o = Oidc()
    fake_http.handlers["issuer.test"] = lambda req: httpx.Response(200, json=o.jwks)
    return o


def test_oidc_jwt_accepted_and_cached(client: TestClient, oidc: Oidc, fake_http: Any) -> None:
    h = {"Authorization": f"Bearer {oidc.token('abc')}"}
    me = client.get("/v1/me", headers=h)
    assert me.status_code == 200, me.text
    assert me.json()["email"] == "abc@example.test"
    client.get("/v1/me", headers=h)
    assert sum(1 for c in fake_http.calls if c.url.host == "issuer.test") == 1  # JWKS cached


@pytest.mark.parametrize(
    "claims",
    [
        {"iss": "https://evil.test/"},
        {"aud": "someone-else"},
        {"exp": int(time.time()) - 3600},
    ],
)
def test_oidc_rejects_bad_claims(client: TestClient, oidc: Oidc, claims: dict[str, Any]) -> None:
    r = client.get("/v1/me", headers={"Authorization": f"Bearer {oidc.token('abc', **claims)}"})
    assert r.status_code == 401 and r.json()["code"] == "INVALID_TOKEN"


def test_oidc_rejects_wrong_key_and_hs256(client: TestClient, oidc: Oidc) -> None:
    other = Oidc()
    r = client.get("/v1/me", headers={"Authorization": f"Bearer {other.token('abc')}"})
    assert r.status_code == 401
    hs = jwt.encode(
        {
            "sub": "x",
            "iss": "https://issuer.test/",
            "aud": "wealthpilot-api",
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        "secret-secret-secret-secret-1234",
        algorithm="HS256",
        headers={"kid": oidc.kid},
    )
    assert client.get("/v1/me", headers={"Authorization": f"Bearer {hs}"}).status_code == 401
    assert client.get("/v1/me", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_dev_tokens_rejected_when_not_in_dev_mode(settings: Any, db: Any, fake_http: Any) -> None:
    from wealthpilot_api.main import create_app

    s = settings.model_copy(update={"auth_mode": "oidc"})
    app = create_app(s, db=db, http=httpx.Client(transport=httpx.MockTransport(fake_http)))
    with TestClient(app) as c:
        assert c.get("/v1/me", headers=auth("x")).status_code == 401
