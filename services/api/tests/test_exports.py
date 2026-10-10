from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from fastapi.testclient import TestClient
from pypdf import PdfReader

from .conftest import Api
from .test_scenarios import _set_entitlement, household, run, scenario


def _download(client: TestClient, url: str):  # type: ignore[no-untyped-def]
    u = urlparse(url)
    return client.get(f"{u.path}?{u.query}")  # no bearer token


def _pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _completed_run(api: Api) -> tuple[dict, dict]:
    household(api)
    s = scenario(api)
    return s, run(api, s["active_version"]["id"])


def test_ac006_pdf_includes_assumptions_epf_warning_and_provenance(alice: Api, client: TestClient) -> None:
    s, r = _completed_run(alice)
    exp = alice.ok(alice.post("/exports", {"format": "pdf", "scope": "run", "run_id": r["id"]}), 202)
    assert exp["status"] == "completed" and exp["download_url"]
    assert exp["watermarked"] is True  # free tier
    expires = datetime.fromisoformat(exp["expires_at"].replace("Z", "+00:00"))
    assert expires <= datetime.now(UTC) + timedelta(minutes=15, seconds=5)

    resp = _download(client, exp["download_url"])
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment" in resp.headers["content-disposition"]
    text = _pdf_text(resp.content)
    flat = " ".join(text.split())

    # provenance (FR-EXP-002)
    assert "Generated" in flat
    assert s["id"] in flat.replace(" ", "") or s["id"] in text.replace("\n", "")
    assert r["id"] in text.replace("\n", "").replace(" ", "")
    assert "Model version" in flat and "1.0.0" in flat
    assert "FX source and date" in flat and "user-entered planning rate" in flat
    assert "Data freshness" in flat
    assert "Disclaimers" in flat and "not investment, tax or legal advice" in flat
    # AC-006: explicit EPF warning and every assumption
    assert "EPF_ACCESS_UNVERIFIED" in flat
    assert "EPF withdrawal" in flat
    from wealthpilot_api.modules.reports.generate import flatten

    squashed = text.replace("\n", "").replace(" ", "")
    for path, _value in flatten(s["active_version"]["assumptions"]):
        assert path.replace(" ", "") in squashed, path
    # stored results only: the PDF shows the stored checksum
    res = alice.ok(alice.get(f"/runs/{r['id']}/results"))
    assert res["checksum"].replace(" ", "") in squashed
    assert res["metrics"]["home_pi_monthly"] in flat
    # free-tier watermark
    assert "WealthPilot Free" in flat


def test_pdf_not_watermarked_for_paid_plan(alice: Api, client: TestClient) -> None:
    _, r = _completed_run(alice)
    _set_entitlement(alice, "pro")
    exp = alice.ok(alice.post("/exports", {"format": "pdf", "scope": "run", "run_id": r["id"]}), 202)
    assert exp["watermarked"] is False
    text = _pdf_text(_download(client, exp["download_url"]).content)
    assert "WealthPilot Free" not in text


def test_run_csv_and_json_exports(alice: Api, client: TestClient) -> None:
    s, r = _completed_run(alice)
    j = alice.ok(alice.post("/exports", {"format": "json", "scope": "run", "run_id": r["id"]}), 202)
    data = json.loads(_download(client, j["download_url"]).content)
    stored = alice.ok(alice.get(f"/runs/{r['id']}/results"))
    assert data["result"] == stored
    assert data["assumptions"] == s["active_version"]["assumptions"]
    assert data["run"]["id"] == r["id"]

    c = alice.ok(alice.post("/exports", {"format": "csv", "scope": "run", "run_id": r["id"]}), 202)
    body = _download(client, c["download_url"]).content.decode()
    assert "EPF_ACCESS_UNVERIFIED" in body and "home.target_price" in body
    assert f"meta,run_id,{r['id']}" in body


def test_balances_and_assumptions_exports(alice: Api, client: TestClient) -> None:
    alice.account(type_="cash", amount="1234.5")
    e = alice.ok(alice.post("/exports", {"format": "csv", "scope": "balances"}), 202)
    rows = list(csv.DictReader(io.StringIO(_download(client, e["download_url"]).content.decode())))
    assert rows[0]["amount"] == "1234.50000000"
    assert rows[0]["stale"] == "false"
    j = alice.ok(alice.post("/exports", {"format": "json", "scope": "balances"}), 202)
    assert json.loads(_download(client, j["download_url"]).content)["accounts"][0]["type"] == "cash"

    household(alice)
    scenario(alice)
    a = alice.ok(alice.post("/exports", {"format": "json", "scope": "assumptions"}), 202)
    doc = json.loads(_download(client, a["download_url"]).content)
    assert doc["scenarios"][0]["version_number"] == 1
    assert doc["scenarios"][0]["assumptions"]["home"]["target_price"] == "1300000"
    ac = alice.ok(alice.post("/exports", {"format": "csv", "scope": "assumptions"}), 202)
    assert "fx.usd_inr_start" in _download(client, ac["download_url"]).content.decode()


def test_export_validation(alice: Api) -> None:
    r = alice.post("/exports", {"format": "pdf", "scope": "balances"})
    assert r.status_code == 422
    r = alice.post("/exports", {"format": "csv", "scope": "run"})
    assert r.status_code == 422
    r = alice.post("/exports", {"format": "xml", "scope": "balances"})
    assert r.status_code == 422


def test_download_token_checks(alice: Api, client: TestClient, bob: Api) -> None:
    e = alice.ok(alice.post("/exports", {"format": "json", "scope": "balances"}), 202)
    u = urlparse(e["download_url"])
    assert client.get(u.path).status_code == 422  # token required
    bad = client.get(f"{u.path}?token=123.abc")
    assert bad.status_code == 403 and bad.json()["code"] == "INVALID_DOWNLOAD_TOKEN"
    # a token for one export does not open another
    e2 = bob.ok(bob.post("/exports", {"format": "json", "scope": "balances"}), 202)
    other = urlparse(e2["download_url"]).path
    assert client.get(f"{other}?{u.query}").status_code == 403
    # expired token
    from wealthpilot_api.modules.reports.tokens import sign_download

    old, _ = sign_download(
        "test-secret-key-0123456789",
        __import__("uuid").UUID(e["id"]),
        900,
        now=datetime.now(UTC) - timedelta(minutes=16),
    )
    assert client.get(f"{u.path}?token={old}").status_code == 403
    # status endpoint is household-scoped (AC-004)
    assert bob.get(f"/exports/{e['id']}").status_code == 404
    assert alice.ok(alice.get(f"/exports/{e['id']}"))["download_url"]
    events = {ev["action"] for ev in alice.ok(alice.get("/me/security-events", params={"limit": 200}))["items"]}
    assert "export.requested" in events


def test_export_queued_until_worker_runs(alice: Api, app) -> None:  # type: ignore[no-untyped-def]
    from wealthpilot_api.modules.jobs.service import run_pending

    app.state.settings.inline_jobs = False
    try:
        e = alice.ok(alice.post("/exports", {"format": "csv", "scope": "balances"}), 202)
        assert e["status"] == "queued" and e["download_url"] is None
        run_pending(app.state.job_context, "w")
        assert alice.ok(alice.get(f"/exports/{e['id']}"))["status"] == "completed"
    finally:
        app.state.settings.inline_jobs = True
