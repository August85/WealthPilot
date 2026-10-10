"""Deterministic insights (spec §10.3). Each insight is a computed fact with links to its inputs.

Codes: ``CONCENTRATION_EMPLOYER_STOCK``, ``INR_EXPOSURE`` (``USD_EXPOSURE`` when reporting in INR),
``STALE_BALANCE``, ``UNVERIFIED_BALANCE``, ``EPF_ACCESS_UNVERIFIED``, ``UPCOMING_VEST``, ``LIQUIDITY_SHARE``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal

from .fx import FxRateMissing, FxTable, Rate
from .models import Insight, InsightRef, NetWorthInput, NetWorthResult, UpcomingVest
from .money import HUNDRED, ZERO, calc_context, fmt, q_money
from .networth import compute_net_worth

TEN_PCT = Decimal("0.10")


def _pct(part: Decimal, whole: Decimal) -> Decimal | None:
    if whole <= 0:
        return None
    return q_money(part / whole * HUNDRED)


@calc_context
def compute_insights(
    inp: NetWorthInput,
    result: NetWorthResult | None = None,
    *,
    upcoming_vests: Sequence[UpcomingVest] = (),
    upcoming_days: int = 30,
    concentration_threshold: Decimal = Decimal("0.20"),
) -> list[Insight]:
    nw = result if result is not None else compute_net_worth(inp)
    out: list[Insight] = []
    rc = inp.currency
    table = FxTable(Rate(q.base, q.quote, q.rate, q.as_of) for q in inp.fx)

    # 1. Employer-stock concentration (vested shares, whether held directly or inside a brokerage account)
    stock_value = ZERO
    refs: list[InsightRef] = []
    for g in inp.rsu_grants:
        price = inp.prices.get(g.symbol)
        if price is None or g.held_shares <= 0:
            continue
        try:
            stock_value += q_money(table.convert(g.held_shares * price.price, price.currency, rc))
        except FxRateMissing:
            continue
        refs.append(InsightRef(ref_type="rsu_grant", ref_id=g.id))
    if refs:
        pct = _pct(stock_value, nw.net_worth)
        if pct is not None:
            severity = "warning" if pct >= concentration_threshold * HUNDRED else "info"
            out.append(
                Insight(
                    code="CONCENTRATION_EMPLOYER_STOCK",
                    severity=severity,
                    title="Employer stock concentration",
                    body=f"Vested employer stock is {fmt(pct)}% of your net worth.",
                    value=fmt(pct),
                    refs=refs,
                )
            )

    # 2. Currency exposure and the impact of a 10% move
    for cb in nw.by_currency:
        if cb.key == rc:
            continue
        pct = _pct(cb.amount, nw.net_worth)
        impact = q_money(cb.amount * TEN_PCT)
        code = "INR_EXPOSURE" if cb.key == "INR" else f"{cb.key}_EXPOSURE"
        body = (f"{fmt(pct)}% of your net worth is held in {cb.key}. " if pct is not None else "") + (
            f"A 10% fall in the value of {cb.key} against {rc} would change your reported net worth by "
            f"about {fmt(impact)} {rc}."
        )
        out.append(
            Insight(code=code, severity="info", title=f"{cb.key} exposure", body=body, value=fmt(impact), refs=[])
        )

    # 3. Stale and unverified balances
    stale = [i for i in nw.items if i.ref_type == "account" and i.stale]
    if stale:
        out.append(
            Insight(
                code="STALE_BALANCE",
                severity="warning",
                title="Balances need updating",
                body=f"{len(stale)} account(s) have not been updated in over {inp.stale_after_days} days.",
                value=str(len(stale)),
                refs=[InsightRef(ref_type="account", ref_id=i.ref_id) for i in stale],
            )
        )
    unverified = [i for i in nw.items if i.ref_type == "account" and i.verification_status == "estimated"]
    if unverified:
        out.append(
            Insight(
                code="UNVERIFIED_BALANCE",
                severity="info",
                title="Estimated balances",
                body=f"{len(unverified)} account balance(s) are estimates rather than verified figures.",
                value=str(len(unverified)),
                refs=[InsightRef(ref_type="account", ref_id=i.ref_id) for i in unverified],
            )
        )

    # 4. EPF accessibility not verified
    epf = [a for a in inp.accounts if a.type == "epf" and a.details.get("access_status") != "user_verified_accessible"]
    if epf:
        out.append(
            Insight(
                code="EPF_ACCESS_UNVERIFIED",
                severity="warning",
                title="EPF access not verified",
                body="Your EPF balance is treated as restricted. Withdrawal eligibility and tax treatment depend on "
                "rules WealthPilot does not determine; verify with EPFO or a professional.",
                refs=[InsightRef(ref_type="account", ref_id=a.id) for a in epf],
            )
        )

    # 5. Upcoming vests
    horizon = inp.as_of + timedelta(days=upcoming_days)
    soon = sorted((v for v in upcoming_vests if inp.as_of <= v.vest_date <= horizon), key=lambda v: v.vest_date)
    if soon:
        days = (soon[0].vest_date - inp.as_of).days
        out.append(
            Insight(
                code="UPCOMING_VEST",
                severity="info",
                title="Upcoming RSU vest",
                body=f"{len(soon)} RSU vest(s) in the next {upcoming_days} days; the next is in {days} day(s).",
                value=str(len(soon)),
                refs=[InsightRef(ref_type="rsu_vest", ref_id=v.vest_id) for v in soon],
            )
        )

    # 6. Liquid versus restricted share of assets
    if nw.gross_assets > 0:
        liquid = sum((i.amount for i in nw.items if i.kind == "asset" and i.liquid and i.amount is not None), ZERO)
        pct = _pct(liquid, nw.gross_assets)
        out.append(
            Insight(
                code="LIQUIDITY_SHARE",
                severity="info",
                title="Liquid share of assets",
                body=f"{fmt(pct)}% of your assets are liquid; the rest are restricted (e.g. retirement, EPF, FDs) "
                f"or illiquid (e.g. property).",
                value=fmt(pct) if pct is not None else None,
                refs=[],
            )
        )
    return out
