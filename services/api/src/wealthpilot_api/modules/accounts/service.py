"""Household data loaders shared by net worth, insights, scenario snapshots, goals and exports."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from wealthpilot_calc import (
    Disposition,
    FxQuote,
    NetWorthInput,
    VestRecord,
    grant_totals,
)

from ..equity.models import RsuGrant, RsuVest
from ..market_data.models import FxRate, PriceQuote
from .models import Account, Valuation

STALE_DAYS = 45
FX_STALE_DAYS = 7
PRICE_STALE_DAYS = 7


def is_stale(valuation: Valuation | None, today: date) -> bool:
    return valuation is None or (today - valuation.as_of).days > STALE_DAYS


def active_accounts(db: Session, hid: uuid.UUID, include_archived: bool = False) -> list[Account]:
    q = select(Account).where(Account.household_id == hid, Account.deleted_at.is_(None))
    if not include_archived:
        q = q.where(Account.archived.is_(False))
    return list(db.scalars(q.order_by(Account.created_at, Account.id)).all())


def latest_valuations(
    db: Session, hid: uuid.UUID, as_of: date | None = None, account_ids: Iterable[uuid.UUID] | None = None
) -> dict[uuid.UUID, Valuation]:
    q = (
        select(Valuation)
        .where(Valuation.household_id == hid, Valuation.superseded_by.is_(None))
        .distinct(Valuation.account_id)
        .order_by(Valuation.account_id, Valuation.as_of.desc(), Valuation.created_at.desc())
    )
    if as_of is not None:
        q = q.where(Valuation.as_of <= as_of)
    if account_ids is not None:
        q = q.where(Valuation.account_id.in_(list(account_ids)))
    return {v.account_id: v for v in db.scalars(q).all()}


def latest_user_fx(db: Session, hid: uuid.UUID, as_of: date | None = None) -> list[FxRate]:
    q = (
        select(FxRate)
        .where(FxRate.household_id == hid, FxRate.kind == "user")
        .distinct(FxRate.base_currency, FxRate.quote_currency)
        .order_by(FxRate.base_currency, FxRate.quote_currency, FxRate.as_of.desc(), FxRate.created_at.desc())
    )
    if as_of is not None:
        q = q.where(FxRate.as_of <= as_of)
    return list(db.scalars(q).all())


def latest_prices(db: Session, hid: uuid.UUID, as_of: date | None = None) -> dict[str, PriceQuote]:
    q = (
        select(PriceQuote)
        .where(PriceQuote.household_id == hid)
        .distinct(PriceQuote.symbol)
        .order_by(PriceQuote.symbol, PriceQuote.as_of.desc(), PriceQuote.created_at.desc())
    )
    if as_of is not None:
        q = q.where(PriceQuote.as_of <= as_of)
    return {p.symbol: p for p in db.scalars(q).all()}


def active_grants(db: Session, hid: uuid.UUID) -> list[RsuGrant]:
    return list(
        db.scalars(
            select(RsuGrant)
            .where(RsuGrant.household_id == hid, RsuGrant.deleted_at.is_(None))
            .options(selectinload(RsuGrant.vests).selectinload(RsuVest.dispositions))
            .order_by(RsuGrant.grant_date, RsuGrant.id)
        ).all()
    )


def vest_record(v: RsuVest, as_of: date | None = None) -> VestRecord:
    status = v.status
    if as_of is not None and status == "vested" and v.vest_date > as_of:
        status = "scheduled"
    disps = tuple(
        Disposition(kind=d.kind, shares=d.shares, price=d.price, fees=d.fees, date=d.date)
        for d in v.dispositions
        if status == "vested" and (as_of is None or d.date <= as_of)
    )
    return VestRecord(
        scheduled_shares=v.scheduled_shares,
        status=status,
        vested_shares=v.vested_shares,
        vest_fmv=v.vest_fmv,
        withheld_shares=v.withheld_shares,
        dispositions=disps,
    )


def grant_position(g: RsuGrant, as_of: date | None = None) -> tuple[Decimal, Decimal]:
    """(held_shares, unvested_shares) as of a date."""
    t = grant_totals(vest_record(v, as_of) for v in g.vests)
    return t.held, t.unvested


def fx_quote(r: FxRate) -> FxQuote:
    return FxQuote(
        base=r.base_currency,
        quote=r.quote_currency,
        rate=r.rate,
        as_of=r.as_of,
        provider=r.provider,
        kind=r.kind,
        license_reference=r.license_reference,
    )


def net_worth_input(db: Session, hid: uuid.UUID, currency: str, as_of: date) -> NetWorthInput:
    accounts = active_accounts(db, hid)
    vals = latest_valuations(db, hid, as_of)
    acc_items: list[dict[str, Any]] = []
    for a in accounts:
        v = vals.get(a.id)
        acc_items.append(
            {
                "id": str(a.id),
                "name": a.name,
                "kind": a.kind,
                "type": a.type,
                "country": a.country,
                "currency": a.currency,
                "amount": v.amount if v else None,
                "accessibility": a.accessibility,
                "goal_eligible": a.goal_eligible,
                "include_in_net_worth": a.include_in_net_worth,
                "ownership_pct": a.ownership_pct,
                "details": a.details or {},
                "verification_status": v.verification_status if v else None,
                "valuation_as_of": v.as_of if v else None,
            }
        )
    grants = []
    for g in active_grants(db, hid):
        if g.status != "active":
            continue
        held, unvested = grant_position(g, as_of)
        grants.append(
            {
                "id": str(g.id),
                "name": f"{g.employer_name} ({g.symbol})",
                "symbol": g.symbol,
                "award_currency": g.award_currency,
                "country": "US",
                "held_in_account_id": str(g.held_in_account_id) if g.held_in_account_id else None,
                "held_shares": held,
                "unvested_shares": unvested,
            }
        )
    prices = {
        s: {"price": p.price, "currency": p.currency, "as_of": p.as_of}
        for s, p in latest_prices(db, hid, as_of).items()
    }
    fx = [fx_quote(r) for r in latest_user_fx(db, hid, as_of)]
    return NetWorthInput.model_validate(
        {
            "as_of": as_of,
            "currency": currency,
            "accounts": acc_items,
            "rsu_grants": grants,
            "prices": prices,
            "fx": [q.model_dump() for q in fx],
            "stale_after_days": STALE_DAYS,
            "fx_stale_after_days": FX_STALE_DAYS,
            "price_stale_after_days": PRICE_STALE_DAYS,
        }
    )


def month_ends(today: date, months: int) -> list[date]:
    """The last ``months`` month-end dates strictly before today's month, oldest first."""
    out: list[date] = []
    first_of_month = today.replace(day=1)
    d = first_of_month - timedelta(days=1)
    for _ in range(months):
        out.append(d)
        d = d.replace(day=1) - timedelta(days=1)
    return sorted(out)
