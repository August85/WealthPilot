"""FX rates (user + non-licensed reference suggestion) and manual price quotes."""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from wealthpilot_calc import q_rate
from wealthpilot_calc.fields import PosDec

from ...core.errors import ApiError
from ...core.schema import ApiModel, CurrencyCode, Money, OutModel, qty_str
from ..auth.deps import Ctx, get_ctx
from .models import FxRate, PriceQuote

router = APIRouter(tags=["market-data"])
log = logging.getLogger("wealthpilot.market_data")

FX_STALE_DAYS = 7
PRICE_STALE_DAYS = 7
REFERENCE_PROVIDER = "frankfurter.app (ECB reference)"


class FxRateOut(OutModel):
    base: str
    quote: str
    rate: str
    as_of: date
    provider: str
    kind: str
    stale: bool
    license_reference: str | None


class FxRateIn(ApiModel):
    base: CurrencyCode
    quote: CurrencyCode
    rate: PosDec
    as_of: date


class PriceIn(ApiModel):
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9.\-_:]+$")
    price: PosDec
    currency: CurrencyCode
    as_of: date


class PriceOut(OutModel):
    symbol: str
    price: Money
    currency: str
    as_of: date
    provider: str
    stale: bool


def _today() -> date:
    return datetime.now(UTC).date()


def _fx_out(r: FxRate, *, inverse: bool = False, stale: bool | None = None) -> FxRateOut:
    rate = q_rate(Decimal(1) / r.rate) if inverse else r.rate
    st = stale if stale is not None else (_today() - r.as_of).days > FX_STALE_DAYS
    return FxRateOut(
        base=r.quote_currency if inverse else r.base_currency,
        quote=r.base_currency if inverse else r.quote_currency,
        rate=qty_str(rate),
        as_of=r.as_of,
        provider=r.provider,
        kind=r.kind,
        stale=st,
        license_reference=r.license_reference,
    )


@router.get("/fx/rates", response_model=FxRateOut)
def get_fx_rate(
    base: CurrencyCode = Query(...), quote: CurrencyCode = Query(...), ctx: Ctx = Depends(get_ctx)
) -> FxRateOut:
    if base == quote:
        raise ApiError(422, "VALIDATION_ERROR", "base and quote must differ.")
    row = ctx.db.scalar(
        select(FxRate)
        .where(
            FxRate.household_id == ctx.hid,
            FxRate.kind == "user",
            or_(
                (FxRate.base_currency == base) & (FxRate.quote_currency == quote),
                (FxRate.base_currency == quote) & (FxRate.quote_currency == base),
            ),
        )
        .order_by(FxRate.as_of.desc(), (FxRate.base_currency == base).desc(), FxRate.created_at.desc())
        .limit(1)
    )
    if row is None:
        raise ApiError(404, "FX_RATE_MISSING", f"No {base}/{quote} rate saved. Add the rate you want to plan with.")
    return _fx_out(row, inverse=row.base_currency != base)


@router.post("/fx/rates", response_model=FxRateOut, status_code=201)
def post_fx_rate(body: FxRateIn, ctx: Ctx = Depends(get_ctx)) -> FxRateOut:
    if body.base == body.quote:
        raise ApiError(422, "VALIDATION_ERROR", "base and quote must differ.")
    r = FxRate(
        household_id=ctx.hid,
        base_currency=body.base,
        quote_currency=body.quote,
        rate=body.rate,
        as_of=body.as_of,
        kind="user",
        provider="user",
        license_reference=None,
        created_by=ctx.user.id,
    )
    ctx.db.add(r)
    ctx.db.commit()
    return _fx_out(r)


def fetch_reference(http: httpx.Client, base_url: str, base: str, quote: str) -> tuple[Decimal, date]:
    resp = http.get(f"{base_url.rstrip('/')}/latest", params={"from": base, "to": quote})
    resp.raise_for_status()
    data = json.loads(resp.text, parse_float=Decimal, parse_int=Decimal)
    rate = data["rates"][quote]
    if not isinstance(rate, Decimal) or rate <= 0:
        raise ValueError("bad rate")
    return rate, date.fromisoformat(data["date"])


def reference_rate(db: Session, request: Request, base: str, quote: str) -> FxRateOut:
    settings = request.app.state.settings
    cached = db.scalar(
        select(FxRate)
        .where(
            FxRate.household_id.is_(None),
            FxRate.kind == "reference",
            FxRate.base_currency == base,
            FxRate.quote_currency == quote,
        )
        .order_by(FxRate.fetched_at.desc().nulls_last(), FxRate.as_of.desc())
        .limit(1)
    )
    now = datetime.now(UTC)
    if (
        cached is not None
        and cached.fetched_at
        and now - cached.fetched_at < timedelta(hours=settings.fx_reference_cache_hours)
    ):
        return _fx_out(cached)
    try:
        rate, as_of = fetch_reference(request.app.state.http, settings.fx_reference_url, base, quote)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        log.warning("reference FX feed unavailable", extra={"error_type": type(exc).__name__})
        if cached is not None:
            return _fx_out(cached, stale=True)
        raise ApiError(
            503, "FX_FEED_UNAVAILABLE", "The reference FX feed is unavailable; enter your own rate."
        ) from exc
    row = FxRate(
        household_id=None,
        base_currency=base,
        quote_currency=quote,
        rate=rate,
        as_of=as_of,
        kind="reference",
        provider=REFERENCE_PROVIDER,
        license_reference=None,
        fetched_at=now,
    )
    db.add(row)
    db.commit()
    return _fx_out(row)


@router.get("/fx/reference", response_model=FxRateOut)
def get_fx_reference(
    request: Request, base: CurrencyCode = Query(...), quote: CurrencyCode = Query(...), ctx: Ctx = Depends(get_ctx)
) -> FxRateOut:
    """Suggestion only: never used in calculations unless the user saves it via POST /fx/rates."""
    if base == quote:
        raise ApiError(422, "VALIDATION_ERROR", "base and quote must differ.")
    return reference_rate(ctx.db, request, base, quote)


def _price_out(p: PriceQuote) -> PriceOut:
    return PriceOut(
        symbol=p.symbol,
        price=p.price,
        currency=p.currency,
        as_of=p.as_of,
        provider=p.provider,
        stale=(_today() - p.as_of).days > PRICE_STALE_DAYS,
    )


@router.get("/prices", response_model=PriceOut)
def get_price(symbol: str = Query(..., min_length=1, max_length=32), ctx: Ctx = Depends(get_ctx)) -> PriceOut:
    p = ctx.db.scalar(
        select(PriceQuote)
        .where(PriceQuote.household_id == ctx.hid, PriceQuote.symbol == symbol.upper())
        .order_by(PriceQuote.as_of.desc(), PriceQuote.created_at.desc())
        .limit(1)
    )
    if p is None:
        raise ApiError(404, "MISSING_PRICE", f"No price saved for {symbol.upper()}.")
    return _price_out(p)


@router.post("/prices", response_model=PriceOut, status_code=201)
def post_price(body: PriceIn, ctx: Ctx = Depends(get_ctx)) -> PriceOut:
    p = PriceQuote(
        household_id=ctx.hid,
        symbol=body.symbol.upper(),
        price=body.price,
        currency=body.currency,
        as_of=body.as_of,
        provider="manual",
        quality="user_entered",
    )
    ctx.db.add(p)
    ctx.db.commit()
    return _price_out(p)
