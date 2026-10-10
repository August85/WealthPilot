"""RSU grants, vests, dispositions and the vest calendar (FR-RSU-*)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from wealthpilot_calc import (
    Disposition,
    ShareConservationError,
    VestRecord,
    check_disposition_allowed,
    generate_vest_schedule,
    grant_totals,
    q_money,
    vest_totals,
)

from ...core.errors import ApiError, not_found
from ...core.schema import ApiModel, CurrencyCode, ItemList, Money, NonNegMoney, NonNegQty, OutModel, Qty, Rate
from ..accounts.models import Account
from ..accounts.service import active_grants, latest_prices, vest_record
from ..auth.deps import Ctx, get_ctx
from ..compliance.service import audit
from .models import RsuDisposition, RsuGrant, RsuVest

router = APIRouter(tags=["rsu"])


class ScheduleIn(ApiModel):
    start_date: date
    cliff_months: int = Field(0, ge=0, le=120)
    frequency_months: int = Field(ge=1, le=60)
    total_months: int = Field(ge=1, le=240)


class GrantCreate(ApiModel):
    employer_name: str = Field(min_length=1, max_length=120)
    symbol: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9.\-_:]+$")
    grant_date: date
    granted_shares: NonNegQty
    award_currency: CurrencyCode = "USD"
    grant_price: NonNegMoney | None = None
    held_in_account_id: uuid.UUID | None = None
    default_withholding_rate: Rate | None = None
    schedule: ScheduleIn | None = None


class GrantPatch(ApiModel):
    employer_name: str | None = Field(default=None, min_length=1, max_length=120)
    symbol: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[A-Za-z0-9.\-_:]+$")
    grant_date: date | None = None
    granted_shares: NonNegQty | None = None
    award_currency: CurrencyCode | None = None
    grant_price: NonNegMoney | None = None
    held_in_account_id: uuid.UUID | None = None
    default_withholding_rate: Rate | None = None
    status: Literal["active", "cancelled"] | None = None
    version: int | None = None


class DispositionOut(OutModel):
    id: uuid.UUID
    vest_id: uuid.UUID
    date: date
    kind: str
    shares: Qty
    price: Money
    fees: Money


class VestOut(OutModel):
    id: uuid.UUID
    grant_id: uuid.UUID
    vest_date: date
    scheduled_shares: Qty
    status: str
    vested_shares: Qty | None
    vest_fmv: Money | None
    withheld_shares: Qty | None
    source_event_id: str | None
    version: int
    dispositions: list[DispositionOut]


class Totals(OutModel):
    scheduled: Qty
    vested: Qty
    withheld: Qty
    sold: Qty
    held: Qty
    unvested: Qty


class GrantOut(OutModel):
    id: uuid.UUID
    employer_name: str
    symbol: str
    grant_date: date
    granted_shares: Qty
    award_currency: str
    grant_price: Money | None
    held_in_account_id: uuid.UUID | None
    default_withholding_rate: Qty | None
    status: str
    version: int
    vests: list[VestOut]
    totals: Totals


class VestCreate(ApiModel):
    vest_date: date
    scheduled_shares: NonNegQty
    source_event_id: str | None = Field(default=None, max_length=255)


class VestPatch(ApiModel):
    status: Literal["scheduled", "vested", "cancelled"] | None = None
    vested_shares: NonNegQty | None = None
    vest_fmv: NonNegMoney | None = None
    withheld_shares: NonNegQty | None = None
    version: int | None = None

    @model_validator(mode="after")
    def _withheld(self) -> VestPatch:
        if (
            self.withheld_shares is not None
            and self.vested_shares is not None
            and self.withheld_shares > self.vested_shares
        ):
            raise ValueError("withheld_shares must not exceed vested_shares")
        return self


class DispositionCreate(ApiModel):
    date: date
    kind: Literal["sell_to_cover", "sale"]
    shares: NonNegQty
    price: NonNegMoney
    fees: NonNegMoney = Decimal(0)


class CalendarItem(OutModel):
    vest_id: uuid.UUID
    grant_id: uuid.UUID
    employer_name: str
    symbol: str
    vest_date: date
    shares: Qty
    status: str
    estimated_gross_value: Money | None
    currency: str


class WarningOut(OutModel):
    code: str
    severity: str
    message: str
    ref_type: str | None = None
    ref_id: str | None = None


class CalendarOut(OutModel):
    items: list[CalendarItem]
    warnings: list[WarningOut]


def grant_out(g: RsuGrant) -> GrantOut:
    t = grant_totals(vest_record(v) for v in g.vests)
    return GrantOut(
        id=g.id,
        employer_name=g.employer_name,
        symbol=g.symbol,
        grant_date=g.grant_date,
        granted_shares=g.granted_shares,
        award_currency=g.award_currency,
        grant_price=g.grant_price,
        held_in_account_id=g.held_in_account_id,
        default_withholding_rate=g.default_withholding_rate,
        status=g.status,
        version=g.version,
        vests=[VestOut.model_validate(v) for v in sorted(g.vests, key=lambda v: (v.vest_date, v.created_at))],
        totals=Totals(
            scheduled=t.scheduled, vested=t.vested, withheld=t.withheld, sold=t.sold, held=t.held, unvested=t.unvested
        ),
    )


def _grant(ctx: Ctx, grant_id: uuid.UUID) -> RsuGrant:
    g = ctx.db.scalar(
        select(RsuGrant).where(RsuGrant.id == grant_id, RsuGrant.household_id == ctx.hid, RsuGrant.deleted_at.is_(None))
    )
    if g is None:
        raise not_found("Grant")
    return g


def _vest(ctx: Ctx, vest_id: uuid.UUID) -> RsuVest:
    v = ctx.db.scalar(
        select(RsuVest)
        .join(RsuGrant)
        .where(RsuVest.id == vest_id, RsuVest.household_id == ctx.hid, RsuGrant.deleted_at.is_(None))
    )
    if v is None:
        raise not_found("Vest")
    return v


def _check_account(ctx: Ctx, account_id: uuid.UUID | None) -> None:
    if account_id is None:
        return
    ok = ctx.db.scalar(
        select(Account.id).where(
            Account.id == account_id,
            Account.household_id == ctx.hid,
            Account.deleted_at.is_(None),
            Account.kind == "asset",
        )
    )
    if ok is None:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "held_in_account_id must be one of your asset accounts.",
            errors=[{"loc": ["body", "held_in_account_id"], "msg": "unknown account"}],
        )


def _duplicate() -> ApiError:
    return ApiError(409, "DUPLICATE_VEST", "A vest with this date and source event already exists for this grant.")


@router.get("/rsu/grants", response_model=ItemList[GrantOut])
def list_grants(ctx: Ctx = Depends(get_ctx)) -> dict:
    return {"items": [grant_out(g) for g in active_grants(ctx.db, ctx.hid)]}


@router.post("/rsu/grants", response_model=GrantOut, status_code=201)
def create_grant(body: GrantCreate, ctx: Ctx = Depends(get_ctx)) -> GrantOut:
    _check_account(ctx, body.held_in_account_id)
    g = RsuGrant(
        household_id=ctx.hid,
        owner_id=ctx.user.id,
        employer_name=body.employer_name,
        symbol=body.symbol.upper(),
        grant_date=body.grant_date,
        granted_shares=body.granted_shares,
        award_currency=body.award_currency,
        grant_price=body.grant_price,
        held_in_account_id=body.held_in_account_id,
        default_withholding_rate=body.default_withholding_rate,
    )
    ctx.db.add(g)
    ctx.db.flush()
    if body.schedule is not None:
        s = body.schedule
        try:
            sched = generate_vest_schedule(
                start_date=s.start_date,
                total_shares=body.granted_shares,
                total_months=s.total_months,
                frequency_months=s.frequency_months,
                cliff_months=s.cliff_months,
            )
        except ValueError as exc:
            raise ApiError(422, "INVALID_SCHEDULE", str(exc)) from exc
        for sv in sched:
            g.vests.append(RsuVest(household_id=ctx.hid, vest_date=sv.vest_date, scheduled_shares=sv.shares))
    ctx.db.commit()
    ctx.db.refresh(g)
    return grant_out(g)


@router.get("/rsu/grants/{grant_id}", response_model=GrantOut)
def read_grant(grant_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> GrantOut:
    return grant_out(_grant(ctx, grant_id))


@router.patch("/rsu/grants/{grant_id}", response_model=GrantOut)
def patch_grant(grant_id: uuid.UUID, body: GrantPatch, ctx: Ctx = Depends(get_ctx)) -> GrantOut:
    g = _grant(ctx, grant_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != g.version:
        raise ApiError(409, "VERSION_CONFLICT", "The grant was modified; reload and retry.")
    if "held_in_account_id" in data:
        _check_account(ctx, data["held_in_account_id"])
    for k in ("employer_name", "symbol", "grant_date", "granted_shares", "award_currency", "status"):
        if k in data and data[k] is None:
            raise ApiError(422, "VALIDATION_ERROR", f"{k} cannot be null.")
    if "symbol" in data:
        data["symbol"] = data["symbol"].upper()
    for k, v in data.items():
        setattr(g, k, v)
    ctx.db.commit()
    return grant_out(g)


@router.delete("/rsu/grants/{grant_id}", status_code=204)
def delete_grant(grant_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    g = _grant(ctx, grant_id)
    g.deleted_at = datetime.now(UTC)
    audit(
        ctx.db, "rsu_grant.deleted", actor_id=ctx.user.id, household_id=ctx.hid, entity_type="rsu_grant", entity_id=g.id
    )
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/rsu/grants/{grant_id}/vests", response_model=VestOut, status_code=201)
def add_vest(grant_id: uuid.UUID, body: VestCreate, ctx: Ctx = Depends(get_ctx)) -> RsuVest:
    g = _grant(ctx, grant_id)
    dup = ctx.db.scalar(
        select(RsuVest.id).where(
            RsuVest.grant_id == g.id,
            RsuVest.vest_date == body.vest_date,
            RsuVest.source_event_id.is_(None)
            if body.source_event_id is None
            else RsuVest.source_event_id == body.source_event_id,
        )
    )
    if dup is not None:
        raise _duplicate()
    v = RsuVest(
        grant_id=g.id,
        household_id=ctx.hid,
        vest_date=body.vest_date,
        scheduled_shares=body.scheduled_shares,
        source_event_id=body.source_event_id,
    )
    ctx.db.add(v)
    try:
        ctx.db.commit()
    except IntegrityError as exc:
        ctx.db.rollback()
        raise _duplicate() from exc
    return v


@router.patch("/rsu/vests/{vest_id}", response_model=VestOut)
def patch_vest(vest_id: uuid.UUID, body: VestPatch, ctx: Ctx = Depends(get_ctx)) -> RsuVest:
    v = _vest(ctx, vest_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != v.version:
        raise ApiError(409, "VERSION_CONFLICT", "The vest was modified; reload and retry.")
    if "status" in data and data["status"] is None:
        raise ApiError(422, "VALIDATION_ERROR", "status cannot be null.")
    status = data.get("status", v.status)
    vested = data.get("vested_shares", v.vested_shares)
    withheld = data.get("withheld_shares", v.withheld_shares)
    if status == "vested" and vested is None:
        raise ApiError(422, "VALIDATION_ERROR", "vested_shares is required when status is vested.")
    if status != "vested" and v.dispositions:
        raise ApiError(409, "SHARE_CONSERVATION", "A vest with dispositions must stay vested.")
    if withheld is not None and (vested is None or withheld > vested):
        raise ApiError(422, "SHARE_CONSERVATION", "withheld_shares must not exceed vested_shares.")
    try:
        vest_totals(vest_record_from(v, status, vested, withheld, data.get("vest_fmv", v.vest_fmv)))
    except ShareConservationError as exc:
        raise ApiError(422, "SHARE_CONSERVATION", str(exc)) from exc
    for k, val in data.items():
        setattr(v, k, val)
    ctx.db.commit()
    return v


def vest_record_from(v: RsuVest, status: str, vested: Decimal | None, withheld: Decimal | None, fmv: Decimal | None):
    return VestRecord(
        scheduled_shares=v.scheduled_shares,
        status=status,
        vested_shares=vested,
        vest_fmv=fmv,
        withheld_shares=withheld,
        dispositions=tuple(Disposition(d.kind, d.shares, d.price, d.fees, d.date) for d in v.dispositions),
    )


@router.delete("/rsu/vests/{vest_id}", status_code=204)
def delete_vest(vest_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    v = _vest(ctx, vest_id)
    if v.dispositions:
        raise ApiError(409, "VEST_HAS_DISPOSITIONS", "A vest with recorded dispositions cannot be deleted.")
    ctx.db.delete(v)
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/rsu/vests/{vest_id}/dispositions", response_model=DispositionOut, status_code=201)
def add_disposition(vest_id: uuid.UUID, body: DispositionCreate, ctx: Ctx = Depends(get_ctx)) -> RsuDisposition:
    v = _vest(ctx, vest_id)
    if v.status != "vested":
        raise ApiError(422, "SHARE_CONSERVATION", "Shares can only be disposed of after the vest is recorded.")
    new = Disposition(body.kind, body.shares, body.price, body.fees, body.date)
    try:
        check_disposition_allowed(vest_record(v), new)
    except ShareConservationError as exc:
        raise ApiError(422, "SHARE_CONSERVATION", "Withheld plus sold shares would exceed vested shares.") from exc
    d = RsuDisposition(
        vest_id=v.id,
        household_id=ctx.hid,
        date=body.date,
        kind=body.kind,
        shares=body.shares,
        price=body.price,
        fees=body.fees,
    )
    ctx.db.add(d)
    ctx.db.commit()
    return d


@router.get("/rsu/calendar", response_model=CalendarOut)
def calendar(
    from_: date | None = Query(None, alias="from"),
    to: date | None = Query(None),
    ctx: Ctx = Depends(get_ctx),
) -> CalendarOut:
    today = datetime.now(UTC).date()
    start = from_ or today
    end = to or (start + timedelta(days=365))
    if end < start:
        raise ApiError(422, "VALIDATION_ERROR", "'to' must not precede 'from'.")
    prices = latest_prices(ctx.db, ctx.hid)
    items: list[CalendarItem] = []
    warnings: list[WarningOut] = []
    missing: set[str] = set()
    for g in active_grants(ctx.db, ctx.hid):
        for v in g.vests:
            if not (start <= v.vest_date <= end) or v.status == "cancelled":
                continue
            shares = v.vested_shares if v.status == "vested" and v.vested_shares is not None else v.scheduled_shares
            p = prices.get(g.symbol)
            value = None
            currency = g.award_currency
            if p is not None:
                value = q_money(shares * p.price)
                currency = p.currency
            elif g.symbol not in missing:
                missing.add(g.symbol)
                warnings.append(
                    WarningOut(
                        code="MISSING_PRICE",
                        severity="warning",
                        message=f"No price saved for {g.symbol}; estimated values are omitted.",
                        ref_type="rsu_grant",
                        ref_id=str(g.id),
                    )
                )
            items.append(
                CalendarItem(
                    vest_id=v.id,
                    grant_id=g.id,
                    employer_name=g.employer_name,
                    symbol=g.symbol,
                    vest_date=v.vest_date,
                    shares=shares,
                    status=v.status,
                    estimated_gross_value=value,
                    currency=currency,
                )
            )
    items.sort(key=lambda i: (i.vest_date, str(i.vest_id)))
    return CalendarOut(items=items, warnings=warnings)
