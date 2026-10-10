"""Load the SYNTHETIC spec §16 household for a dev user (never use in production).

    WP_AUTH_MODE=dev uv run python scripts/seed_dev.py [--subject demo] [--email demo@example.test]

Then sign in with ``Authorization: Bearer dev:<subject>:<email>``. Every value is fictional test data (see
``wealthpilot_calc.samples``): accounts, the ACME grant, the USD/INR planning rate, prices and assumptions are not
real data or market estimates. The household is given the ``pro`` entitlement so all four §16 scenarios fit.
The data is created through the API itself, so it passes the same validation as user input.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from wealthpilot_calc.samples import (
    SEED_ACME_PRICE,
    SEED_BASE_DATE,
    SEED_SCENARIO_VARIANTS,
    SEED_USD_INR,
    SYNTHETIC_LABEL,
    apply_variant,
    seed_assumptions_dict,
    seed_snapshot_dict,
)

from wealthpilot_api.core.config import Settings
from wealthpilot_api.main import create_app
from wealthpilot_api.modules.billing.models import Subscription


def _ok(resp: Any, status: int) -> Any:
    if resp.status_code != status:
        raise SystemExit(
            f"seed failed: {resp.request.method} {resp.request.url.path} -> {resp.status_code} {resp.text}"[:400]
        )
    return resp.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", default="demo")
    parser.add_argument("--email", default="demo@example.test")
    args = parser.parse_args()

    base = Settings()
    if base.env == "production":
        print("refusing to seed synthetic data in production", file=sys.stderr)
        return 2
    settings = base.model_copy(update={"auth_mode": "dev", "inline_jobs": True})
    app = create_app(settings)
    h = {"Authorization": f"Bearer dev:{args.subject}:{args.email}"}
    with TestClient(app, base_url="http://seed.local") as c:
        me = _ok(c.get("/v1/me", headers=h), 200)
        if me["onboarding_completed"] and _ok(c.get("/v1/accounts", headers=h), 200)["items"]:
            print("dev user already has data; nothing to do")
            return 0
        me = _ok(
            c.post(
                "/v1/me/onboarding",
                headers=h,
                json={
                    "home_country": "US",
                    "reporting_currency": "USD",
                    "household_name": "Synthetic §16 household",
                    "disclaimer_accepted": True,
                    "tax_residency": [{"jurisdiction": "US", "residency_type": "resident", "from_date": "2015-01-01"}],
                },
            ),
            200,
        )
        with app.state.db.session() as db:
            sub = db.scalar(select(Subscription).where(Subscription.household_id == me["household_id"]))
            assert sub is not None
            sub.entitlement = "pro"
            sub.renewal_status = "dev_seed"
            db.commit()

        as_of = SEED_BASE_DATE.isoformat()
        _ok(
            c.post(
                "/v1/fx/rates",
                headers=h,
                json={"base": "USD", "quote": "INR", "rate": str(SEED_USD_INR), "as_of": as_of},
            ),
            201,
        )
        _ok(
            c.post(
                "/v1/prices",
                headers=h,
                json={"symbol": "ACME", "price": str(SEED_ACME_PRICE), "currency": "USD", "as_of": as_of},
            ),
            201,
        )
        snap = seed_snapshot_dict()
        for a in snap["accounts"]:
            _ok(
                c.post(
                    "/v1/accounts",
                    headers=h,
                    json={
                        "kind": a["kind"],
                        "type": a["type"],
                        "name": a["name"],
                        "country": a["country"],
                        "currency": a["currency"],
                        "details": a["details"],
                        "initial_valuation": {
                            "amount": a["amount"],
                            "as_of": a["valuation_as_of"],
                            "verification_status": a["verification_status"],
                            "note": "synthetic seed data",
                        },
                    },
                ),
                201,
            )
        g = snap["rsu_grants"][0]
        total = sum(int(v["scheduled_shares"]) for v in g["vests"])
        grant = _ok(
            c.post(
                "/v1/rsu/grants",
                headers=h,
                json={
                    "employer_name": g["employer_name"],
                    "symbol": g["symbol"],
                    "grant_date": "2025-12-15",
                    "granted_shares": str(total),
                    "default_withholding_rate": g["default_withholding_rate"],
                },
            ),
            201,
        )
        for v in g["vests"]:
            _ok(
                c.post(
                    f"/v1/rsu/grants/{grant['id']}/vests",
                    headers=h,
                    json={"vest_date": v["vest_date"], "scheduled_shares": v["scheduled_shares"]},
                ),
                201,
            )

        baseline = seed_assumptions_dict()
        scenario_ids: dict[str, str] = {}
        for name, changes in SEED_SCENARIO_VARIANTS.items():
            s = _ok(
                c.post(
                    "/v1/scenarios",
                    headers=h,
                    json={
                        "name": f"{name} (synthetic)",
                        "kind": "home",
                        "preset": "custom",
                        "assumptions": apply_variant(baseline, changes),
                    },
                ),
                201,
            )
            scenario_ids[name] = s["id"]
            _ok(c.post(f"/v1/scenario-versions/{s['active_version']['id']}/runs", headers=h, json={}), 202)
        _ok(
            c.post(
                "/v1/goals",
                headers=h,
                json={
                    "type": "home_purchase",
                    "name": "Bay Area home (synthetic)",
                    "target_date": "2030-10-01",
                    "target_amount": baseline["home"]["target_price"],
                    "currency": "USD",
                    "priority": 1,
                    "scenario_id": scenario_ids["Baseline"],
                },
            ),
            201,
        )
    print(SYNTHETIC_LABEL)
    print(f"seeded dev user {args.subject!r}; sign in with: Bearer dev:{args.subject}:{args.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
