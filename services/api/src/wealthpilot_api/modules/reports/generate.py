"""Export content builders (CSV / JSON / PDF).

Run exports use exactly the stored ``SimulationRun.result`` and the immutable ``ScenarioVersion`` it was computed
from; nothing is recomputed with newer data (spec §8.4 rule 6, FR-EXP-002, AC-006).
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..accounts.service import STALE_DAYS, active_accounts, latest_valuations
from ..scenarios.models import Scenario, ScenarioVersion, SimulationRun

DISCLAIMERS = [
    "WealthPilot provides educational planning estimates, not investment, tax or legal advice.",
    "Projections depend entirely on the assumptions listed in this report; actual outcomes will differ.",
    "Market returns, inflation, FX rates and RSU prices shown are user assumptions, not forecasts or market facts.",
    "Tax amounts are simplified effective-rate estimates. Consult a qualified US and India tax professional.",
    "EPF, 401(k) and other retirement balances may be restricted; verify access rules before relying on them.",
]

WATERMARK_TEXT = "WealthPilot Free - not for distribution"


def _fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, date | datetime):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    return str(v)


def flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Flatten nested assumptions into ``(dotted.path, value)`` rows, keeping key order."""
    out: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        if not obj and prefix:
            out.append((prefix, ""))
        for k, v in obj.items():
            out.extend(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
    elif isinstance(obj, list) and obj and all(not isinstance(x, dict | list) for x in obj):
        out.append((prefix, ", ".join(_fmt(x) for x in obj)))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.extend(flatten(v, f"{prefix}[{i}]"))
    else:
        out.append((prefix, _fmt(obj)))
    return out


def to_csv(header: list[str], rows: list[list[Any]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow([_safe_cell(_fmt(c)) for c in r])
    return buf.getvalue().encode("utf-8")


def _safe_cell(s: str) -> str:
    """Neutralise spreadsheet formula injection in user-entered text (names), but keep negative numbers."""
    if s and s[0] in "=+@\t\r":
        return "'" + s
    if s.startswith("-") and not _is_number(s):
        return "'" + s
    return s


def _is_number(s: str) -> bool:
    try:
        Decimal(s)
    except Exception:
        return False
    return True


def to_json(obj: Any) -> bytes:
    return json.dumps(obj, indent=2, default=_fmt, ensure_ascii=False).encode("utf-8")


# ---------------------------------------------------------------------------------------------- balances
BALANCE_COLUMNS = [
    "account_id",
    "name",
    "kind",
    "type",
    "country",
    "currency",
    "accessibility",
    "goal_eligible",
    "include_in_net_worth",
    "ownership_pct",
    "amount",
    "valuation_as_of",
    "verification_status",
    "source",
    "stale",
]


def balances(db: Session, hid: uuid.UUID, today: date) -> list[dict[str, Any]]:
    accounts = active_accounts(db, hid)
    vals = latest_valuations(db, hid)
    rows = []
    for a in accounts:
        v = vals.get(a.id)
        rows.append(
            {
                "account_id": str(a.id),
                "name": a.name,
                "kind": a.kind,
                "type": a.type,
                "country": a.country,
                "currency": a.currency,
                "accessibility": a.accessibility,
                "goal_eligible": a.goal_eligible,
                "include_in_net_worth": a.include_in_net_worth,
                "ownership_pct": _fmt(a.ownership_pct.normalize()),
                "amount": _fmt(v.amount) if v else None,
                "valuation_as_of": v.as_of.isoformat() if v else None,
                "verification_status": v.verification_status if v else None,
                "source": v.source if v else None,
                "stale": v is None or (today - v.as_of).days > STALE_DAYS,
            }
        )
    return rows


# ------------------------------------------------------------------------------------------- assumptions
def assumption_versions(db: Session, hid: uuid.UUID, run: SimulationRun | None) -> list[dict[str, Any]]:
    if run is not None:
        version = db.get(ScenarioVersion, run.scenario_version_id)
        assert version is not None
        versions = [version]
    else:
        versions = list(
            db.scalars(
                select(ScenarioVersion)
                .join(Scenario, Scenario.active_version_id == ScenarioVersion.id)
                .where(Scenario.household_id == hid, Scenario.archived.is_(False))
                .order_by(Scenario.created_at)
            ).all()
        )
    out = []
    for v in versions:
        s = db.get(Scenario, v.scenario_id)
        out.append(
            {
                "scenario_id": str(v.scenario_id),
                "scenario_name": s.name if s else None,
                "version_id": str(v.id),
                "version_number": v.number,
                "input_hash": v.input_hash,
                "model_version": v.model_version,
                "assumptions": v.assumptions,
            }
        )
    return out


# --------------------------------------------------------------------------------------------------- run
def run_bundle(db: Session, run: SimulationRun) -> dict[str, Any]:
    version = db.get(ScenarioVersion, run.scenario_version_id)
    assert version is not None and run.result is not None
    scenario = db.get(Scenario, version.scenario_id)
    return {
        "scenario": {
            "id": str(version.scenario_id),
            "name": scenario.name if scenario else None,
            "kind": scenario.kind if scenario else None,
            "preset": scenario.preset if scenario else None,
        },
        "version": {
            "id": str(version.id),
            "number": version.number,
            "input_hash": version.input_hash,
            "model_version": version.model_version,
            "rulepack_version": version.rulepack_version,
            "notes": version.notes,
            "created_at": version.created_at.isoformat(),
        },
        "run": {
            "id": str(run.id),
            "status": run.status,
            "seed": run.seed,
            "model_version": run.model_version,
            "checksum": run.checksum,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        },
        "assumptions": version.assumptions,
        "snapshot": version.snapshot,
        "result": run.result,
        "disclaimers": DISCLAIMERS,
    }


YEARLY_COLUMNS = [
    "year",
    "age",
    "net_worth",
    "net_worth_real",
    "liquid",
    "us_assets",
    "india_assets",
    "retirement_balance",
    "retirement_balance_real",
    "income",
    "expenses",
    "savings",
    "rsu_net_proceeds",
    "withdrawals",
    "deficit",
    "housing_cost",
    "usd_inr",
]


def run_csv(bundle: dict[str, Any]) -> bytes:
    res = bundle["result"]
    rows: list[list[Any]] = [
        ["meta", k, v]
        for k, v in (
            ("scenario_id", bundle["scenario"]["id"]),
            ("version_number", bundle["version"]["number"]),
            ("run_id", bundle["run"]["id"]),
            ("model_version", res.get("model_version")),
            ("input_hash", res.get("input_hash")),
            ("checksum", res.get("checksum")),
            ("currency", res.get("currency")),
            ("base_date", res.get("base_date")),
        )
    ]
    rows += [["metric", k, v] for k, v in (res.get("metrics") or {}).items()]
    rows += [["assumption", k, v] for k, v in flatten(bundle["assumptions"])]
    rows += [["warning", w.get("code"), w.get("message")] for w in res.get("warnings") or []]
    head = to_csv(["section", "key", "value"], rows)
    cols = [c for c in YEARLY_COLUMNS if any(c in y for y in res.get("yearly") or [])]
    yearly = to_csv(cols, [[y.get(c) for c in cols] for y in res.get("yearly") or []])
    return head + b"\n" + yearly


# --------------------------------------------------------------------------------------------------- pdf
def _fx_lines(bundle: dict[str, Any]) -> list[str]:
    snap_fx = (bundle.get("snapshot") or {}).get("fx") or {}
    lines = []
    for pair, q in snap_fx.items():
        src = "user-entered planning rate" if q.get("kind") == "user" else f"{q.get('kind')} rate"
        lines.append(f"{pair} {q.get('rate')} ({src}, as of {q.get('as_of')})")
    start = ((bundle.get("assumptions") or {}).get("fx") or {}).get("usd_inr_start")
    if start is not None:
        lines.append(f"Scenario USD/INR starting rate (assumption): {start}")
    return lines or ["No FX rates were used."]


def _freshness_rows(bundle: dict[str, Any]) -> list[list[str]]:
    snap = bundle.get("snapshot") or {}
    as_of = date.fromisoformat(snap["as_of"]) if snap.get("as_of") else None
    rows = []
    for a in snap.get("accounts") or []:
        va = a.get("valuation_as_of")
        if va is None:
            status = "no balance"
        else:
            age = (as_of - date.fromisoformat(va)).days if as_of else 0
            status = f"stale ({age} days)" if age > STALE_DAYS else "current"
        rows.append(
            [a.get("name") or "", a.get("currency") or "", va or "-", a.get("verification_status") or "-", status]
        )
    return rows


def render_pdf(bundle: dict[str, Any], generated_at: datetime, watermark: bool) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    body, h1, h2 = styles["BodyText"], styles["Title"], styles["Heading2"]
    small = styles["BodyText"].clone("small", fontSize=8, leading=10)
    res = bundle["result"]

    def p(text: Any, style: Any = body) -> Paragraph:
        return Paragraph(escape(_fmt(text)), style)

    def table(rows: list[list[Any]], widths: list[float] | None = None, header: bool = True) -> Table:
        t = Table([[p(c, small) for c in r] for r in rows], colWidths=widths, repeatRows=1 if header else 0)
        style = [("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]
        if header:
            style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF4")))
        t.setStyle(TableStyle(style))
        return t

    story: list[Any] = [p("WealthPilot scenario report", h1)]
    story.append(
        table(
            [
                ["Generated", generated_at.strftime("%Y-%m-%d %H:%M UTC")],
                ["Scenario", f"{bundle['scenario']['name']} ({bundle['scenario']['id']})"],
                ["Scenario version", f"{bundle['version']['number']} ({bundle['version']['id']})"],
                ["Run ID", bundle["run"]["id"]],
                ["Model version", f"{res.get('model_version')} (rulepack {res.get('rulepack_version')})"],
                ["Input hash", res.get("input_hash")],
                ["Result checksum", res.get("checksum")],
                ["Reporting currency", res.get("currency")],
                ["Base date", res.get("base_date")],
            ],
            [1.6 * inch, 5.4 * inch],
            header=False,
        )
    )

    story += [Spacer(1, 8), p("FX source and date", h2)] + [p(line) for line in _fx_lines(bundle)]

    story += [
        Spacer(1, 8),
        p("Data freshness", h2),
        p(
            f"Household data captured {(bundle.get('snapshot') or {}).get('as_of')}. "
            f"Balances older than {STALE_DAYS} days are marked stale and still included."
        ),
    ]
    fr = _freshness_rows(bundle)
    if fr:
        story.append(table([["Account", "Currency", "Balance as of", "Verification", "Status"], *fr]))

    story += [Spacer(1, 8), p("Key results", h2)]
    story.append(
        table(
            [["Metric", "Value"], *[[k, v if v is not None else "-"] for k, v in (res.get("metrics") or {}).items()]],
            [3.5 * inch, 3.5 * inch],
        )
    )

    warnings = res.get("warnings") or []
    story += [Spacer(1, 8), p("Warnings", h2)]
    if warnings:
        story.append(
            table(
                [
                    ["Severity", "Code", "Message"],
                    *[[w.get("severity"), w.get("code"), w.get("message")] for w in warnings],
                ],
                [0.8 * inch, 1.9 * inch, 4.3 * inch],
            )
        )
    else:
        story.append(p("No warnings."))

    home = res.get("home")
    if home:
        story += [Spacer(1, 8), p("Home purchase", h2)]
        rows = [[k, v] for k, v in home.items() if not isinstance(v, dict | list)]
        rows += [[f"all_in_monthly.{k}", v] for k, v in (home.get("all_in_monthly") or {}).items()]
        story.append(table([["Item", "Value"], *rows], [3.5 * inch, 3.5 * inch]))
        if home.get("stress"):
            story.append(Spacer(1, 4))
            story.append(
                table(
                    [
                        ["Stress test", "P&I monthly", "All-in monthly", "Funding gap"],
                        *[
                            [s.get("label"), s.get("pi_monthly"), s.get("all_in_monthly"), s.get("funding_gap")]
                            for s in home["stress"]
                        ],
                    ]
                )
            )

    yearly = res.get("yearly") or []
    if yearly:
        story += [Spacer(1, 8), p("Yearly projection", h2)]
        cols = [
            "year",
            "age",
            "net_worth",
            "liquid",
            "retirement_balance",
            "income",
            "expenses",
            "withdrawals",
            "deficit",
        ]
        story.append(table([cols, *[[y.get(c) for c in cols] for y in yearly]]))

    if res.get("sensitivity"):
        story += [Spacer(1, 8), p("Sensitivity", h2)]
        story.append(
            table(
                [
                    ["Variable", "Metric", "Low", "Base", "High"],
                    *[
                        [
                            s.get("label"),
                            s.get("metric"),
                            s.get("low_result"),
                            s.get("base_result"),
                            s.get("high_result"),
                        ]
                        for s in res["sensitivity"]
                    ],
                ]
            )
        )

    story += [
        Spacer(1, 8),
        p("All assumptions", h2),
        p("Every value below is a user-provided or illustrative assumption, not a market fact."),
    ]
    story.append(
        table([["Assumption", "Value"], *[list(r) for r in flatten(bundle["assumptions"])]], [3.8 * inch, 3.2 * inch])
    )

    if res.get("explanations"):
        story += [Spacer(1, 8), p("Methodology", h2)]
        for e in res["explanations"]:
            inputs = ", ".join(f"{k}={v}" for k, v in (e.get("inputs") or {}).items())
            story.append(p(f"{e.get('metric')}: {e.get('formula')} with {inputs} = {e.get('result')}", small))

    story += [Spacer(1, 8), p("Disclaimers", h2)] + [p(d) for d in DISCLAIMERS]

    def on_page(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.grey)
        canvas.drawString(
            0.6 * inch, 0.4 * inch, f"Run {bundle['run']['id']} | model {res.get('model_version')} | page {doc.page}"
        )
        if watermark:
            canvas.setFont("Helvetica-Bold", 34)
            canvas.setFillColor(colors.Color(0.6, 0.6, 0.6, alpha=0.25))
            canvas.translate(LETTER[0] / 2, LETTER[1] / 2)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, WATERMARK_TEXT)
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.7 * inch,
        title="WealthPilot scenario report",
        author="WealthPilot",
        invariant=1,
    )
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
