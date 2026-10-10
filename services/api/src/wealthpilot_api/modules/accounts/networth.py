"""Net worth, history and insights (FR-AS-004, spec §6.1, §10.3). All maths is delegated to wealthpilot_calc."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from wealthpilot_calc import FxQuote, NetWorthResult, UpcomingVest, compute_insights, compute_net_worth

from ...core.schema import CurrencyCode, Money, OutModel, qty_str
from ..auth.deps import Ctx, get_ctx
from ..equity.models import RsuVest
from .service import FX_STALE_DAYS, month_ends, net_worth_input

router = APIRouter(tags=["net-worth"])


class FxRateOut(OutModel):
    base: str
    quote: str
    rate: str
    as_of: date | None
    provider: str
    kind: str
    stale: bool
    license_reference: str | None


class Bucket(BaseModel):
    key: str
    amount: Money


class CurrencyBucket(BaseModel):
    key: str
    native_amount: Money
    amount: Money


class NetWorthItemOut(BaseModel):
    ref_type: str
    ref_id: str
    name: str
    kind: str
    type: str
    country: str
    native_amount: Money | None
    native_currency: str
    amount: Money | None
    ownership_pct: str
    liquid: bool
    goal_eligible: bool
    as_of: date | None
    verification_status: str | None
    stale: bool
    excluded_reason: str | None = None


class WarningOut(BaseModel):
    code: str
    severity: str
    message: str
    ref_type: str | None = None
    ref_id: str | None = None


class NetWorthOut(BaseModel):
    currency: str
    as_of: date
    gross_assets: Money
    liabilities: Money
    net_worth: Money
    liquid_net_worth: Money
    goal_eligible: Money
    unvested_equity_excluded: Money
    by_country: list[Bucket]
    by_currency: list[CurrencyBucket]
    by_class: list[Bucket]
    fx: list[FxRateOut]
    items: list[NetWorthItemOut]
    warnings: list[WarningOut]


class HistoryPoint(BaseModel):
    as_of: date
    net_worth: Money
    liquid_net_worth: Money


class HistoryOut(BaseModel):
    items: list[HistoryPoint]


class InsightRefOut(BaseModel):
    ref_type: str
    ref_id: str


class InsightOut(BaseModel):
    code: str
    severity: str
    title: str
    body: str
    value: str | None = None
    refs: list[InsightRefOut]


class InsightsOut(BaseModel):
    items: list[InsightOut]


def fx_out(q: FxQuote, as_of: date) -> FxRateOut:
    return FxRateOut(
        base=q.base,
        quote=q.quote,
        rate=qty_str(q.rate),
        as_of=q.as_of,
        provider=q.provider,
        kind=q.kind,
        license_reference=q.license_reference,
        stale=q.as_of is None or (as_of - q.as_of).days > FX_STALE_DAYS,
    )


def net_worth_out(r: NetWorthResult) -> NetWorthOut:
    return NetWorthOut(
        currency=r.currency,
        as_of=r.as_of,
        gross_assets=r.gross_assets,
        liabilities=r.liabilities,
        net_worth=r.net_worth,
        liquid_net_worth=r.liquid_net_worth,
        goal_eligible=r.goal_eligible,
        unvested_equity_excluded=r.unvested_equity_excluded,
        by_country=[Bucket(key=b.key, amount=b.amount) for b in r.by_country],
        by_currency=[CurrencyBucket(key=b.key, native_amount=b.native_amount, amount=b.amount) for b in r.by_currency],
        by_class=[Bucket(key=b.key, amount=b.amount) for b in r.by_class],
        fx=[fx_out(q, r.as_of) for q in r.fx],
        items=[NetWorthItemOut(**{**i.model_dump(), "ownership_pct": qty_str(i.ownership_pct)}) for i in r.items],
        warnings=[WarningOut(**w.model_dump()) for w in r.warnings],
    )


def _today() -> date:
    return datetime.now(UTC).date()


def compute_for(ctx: Ctx, currency: str | None, as_of: date | None) -> NetWorthResult:
    cur = currency or ctx.user.reporting_currency
    return compute_net_worth(net_worth_input(ctx.db, ctx.hid, cur, as_of or _today()))


@router.get("/net-worth", response_model=NetWorthOut)
def get_net_worth(
    currency: CurrencyCode | None = None, as_of: date | None = None, ctx: Ctx = Depends(get_ctx)
) -> NetWorthOut:
    return net_worth_out(compute_for(ctx, currency, as_of))


@router.get("/net-worth/history", response_model=HistoryOut)
def net_worth_history(
    currency: CurrencyCode | None = None, months: int = Query(12, ge=1, le=120), ctx: Ctx = Depends(get_ctx)
) -> HistoryOut:
    cur = currency or ctx.user.reporting_currency
    points: list[HistoryPoint] = []
    for d in month_ends(_today(), months):
        inp = net_worth_input(ctx.db, ctx.hid, cur, d)
        if not any(a.amount is not None for a in inp.accounts) and not any(g.held_shares > 0 for g in inp.rsu_grants):
            continue  # no data effective at that month end
        r = compute_net_worth(inp)
        points.append(HistoryPoint(as_of=d, net_worth=r.net_worth, liquid_net_worth=r.liquid_net_worth))
    return HistoryOut(items=points)


def upcoming_vests(ctx: Ctx, start: date, days: int) -> list[UpcomingVest]:
    rows = ctx.db.scalars(
        select(RsuVest).where(
            RsuVest.household_id == ctx.hid,
            RsuVest.status == "scheduled",
            RsuVest.vest_date >= start,
            RsuVest.vest_date <= start + timedelta(days=days),
        )
    ).all()
    return [
        UpcomingVest(vest_id=str(v.id), grant_id=str(v.grant_id), vest_date=v.vest_date, shares=v.scheduled_shares)
        for v in rows
        if v.grant.deleted_at is None
    ]


@router.get("/insights", response_model=InsightsOut)
def insights(currency: CurrencyCode | None = None, ctx: Ctx = Depends(get_ctx)) -> InsightsOut:
    cur = currency or ctx.user.reporting_currency
    today = _today()
    inp = net_worth_input(ctx.db, ctx.hid, cur, today)
    items = compute_insights(inp, upcoming_vests=upcoming_vests(ctx, today, 30))
    return InsightsOut(items=[InsightOut(**i.model_dump()) for i in items])
