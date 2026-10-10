"""Accounts and append-only valuations (FR-AS-*)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select

from ...core.errors import ApiError, not_found
from ...core.schema import ItemList
from ..auth.deps import Ctx, get_ctx
from ..billing.service import enforce_limit
from ..compliance.service import audit
from .models import Account, Valuation
from .schemas import (
    AccountCreate,
    AccountOut,
    AccountPatch,
    ValuationIn,
    ValuationOut,
    check_kind_type,
    default_accessibility,
    validate_details,
)
from .service import active_accounts, is_stale, latest_valuations

router = APIRouter(tags=["accounts"])

RETIREMENT_TYPES = {"retirement_401k", "ira_traditional", "ira_roth", "hsa", "epf", "ppf"}


def today() -> date:
    return datetime.now(UTC).date()


def account_out(a: Account, latest: Valuation | None) -> AccountOut:
    return AccountOut(
        id=a.id,
        household_id=a.household_id,
        owner_id=a.owner_id,
        kind=a.kind,
        type=a.type,
        name=a.name,
        country=a.country,
        currency=a.currency,
        accessibility=a.accessibility,
        accessibility_override_note=a.accessibility_override_note,
        goal_eligible=a.goal_eligible,
        include_in_net_worth=a.include_in_net_worth,
        ownership_pct=a.ownership_pct,
        details=a.details or {},
        archived=a.archived,
        version=a.version,
        latest_valuation=ValuationOut.model_validate(latest) if latest else None,
        stale=is_stale(latest, today()),
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


def get_account(ctx: Ctx, account_id: uuid.UUID) -> Account:
    a = ctx.db.scalar(
        select(Account).where(Account.id == account_id, Account.household_id == ctx.hid, Account.deleted_at.is_(None))
    )
    if a is None:
        raise not_found("Account")
    return a


def _check_accessibility(kind: str, type_: str, accessibility: str, note: str | None) -> None:
    if kind == "asset" and accessibility != default_accessibility(kind, type_) and not (note and note.strip()):
        raise ApiError(
            422,
            "OVERRIDE_NOTE_REQUIRED",
            "Changing an account's default accessibility requires accessibility_override_note.",
            errors=[{"loc": ["body", "accessibility_override_note"], "msg": "required for override"}],
        )


def _check_goal_eligible(kind: str, type_: str, goal_eligible: bool) -> None:
    if goal_eligible and (kind == "liability" or type_ in RETIREMENT_TYPES):
        raise ApiError(
            422,
            "GOAL_ELIGIBILITY_NOT_ALLOWED",
            "Retirement accounts and liabilities cannot fund goals.",
            errors=[{"loc": ["body", "goal_eligible"], "msg": "not allowed for this account type"}],
        )


def _sum_401k(details: dict) -> Decimal | None:
    pre, roth = details.get("pretax_balance"), details.get("roth_balance")
    if pre is None and roth is None:
        return None
    return Decimal(pre or "0") + Decimal(roth or "0")


@router.get("/accounts", response_model=ItemList[AccountOut])
def list_accounts(
    kind: str | None = Query(None, pattern="^(asset|liability)$"),
    country: str | None = Query(None, pattern="^(US|IN|OTHER)$"),
    include_archived: bool = False,
    ctx: Ctx = Depends(get_ctx),
) -> dict:
    rows = [
        a
        for a in active_accounts(ctx.db, ctx.hid, include_archived)
        if (kind is None or a.kind == kind) and (country is None or a.country == country)
    ]
    vals = latest_valuations(ctx.db, ctx.hid, account_ids=[a.id for a in rows])
    return {"items": [account_out(a, vals.get(a.id)) for a in rows]}


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate, ctx: Ctx = Depends(get_ctx)) -> AccountOut:
    db = ctx.db
    check_kind_type(body.kind, body.type)
    count = (
        db.scalar(
            select(func.count())
            .select_from(Account)
            .where(Account.household_id == ctx.hid, Account.deleted_at.is_(None), Account.archived.is_(False))
        )
        or 0
    )
    enforce_limit(db, ctx.hid, "accounts", count)
    accessibility = body.accessibility or default_accessibility(body.kind, body.type)
    _check_accessibility(body.kind, body.type, accessibility, body.accessibility_override_note)
    goal = (
        body.goal_eligible
        if body.goal_eligible is not None
        else (body.kind == "asset" and accessibility == "liquid" and body.type not in RETIREMENT_TYPES)
    )
    _check_goal_eligible(body.kind, body.type, goal)
    details = validate_details(body.type, body.details)
    a = Account(
        household_id=ctx.hid,
        owner_id=ctx.user.id,
        kind=body.kind,
        type=body.type,
        name=body.name,
        country=body.country,
        currency=body.currency,
        accessibility=accessibility,
        accessibility_override_note=body.accessibility_override_note,
        goal_eligible=goal,
        include_in_net_worth=body.include_in_net_worth,
        ownership_pct=body.ownership_pct,
        details=details,
    )
    db.add(a)
    db.flush()
    latest = None
    total_401k = _sum_401k(details) if body.type == "retirement_401k" else None
    if body.initial_valuation is not None:
        iv = body.initial_valuation
        if total_401k is not None and total_401k != iv.amount:
            raise ApiError(
                422, "INCONSISTENT_BALANCES", "initial_valuation.amount must equal pretax_balance + roth_balance."
            )
        latest = Valuation(
            account_id=a.id,
            household_id=ctx.hid,
            amount=iv.amount,
            currency=a.currency,
            as_of=iv.as_of,
            source="manual",
            verification_status=iv.verification_status,
            note=iv.note,
            created_by=ctx.user.id,
        )
    elif total_401k is not None:
        latest = Valuation(
            account_id=a.id,
            household_id=ctx.hid,
            amount=total_401k,
            currency=a.currency,
            as_of=today(),
            source="computed",
            verification_status="estimated",
            created_by=ctx.user.id,
        )
    if latest is not None:
        db.add(latest)
    if accessibility != default_accessibility(body.kind, body.type):
        audit(
            db,
            "account.accessibility_overridden",
            actor_id=ctx.user.id,
            household_id=ctx.hid,
            entity_type="account",
            entity_id=a.id,
        )
    db.commit()
    return account_out(a, latest)


@router.get("/accounts/{account_id}", response_model=AccountOut)
def read_account(account_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> AccountOut:
    a = get_account(ctx, account_id)
    return account_out(a, latest_valuations(ctx.db, ctx.hid, account_ids=[a.id]).get(a.id))


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def patch_account(account_id: uuid.UUID, body: AccountPatch, ctx: Ctx = Depends(get_ctx)) -> AccountOut:
    db = ctx.db
    a = get_account(ctx, account_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != a.version:
        raise ApiError(409, "VERSION_CONFLICT", "The account was modified; reload and retry.")
    for k in (
        "type",
        "name",
        "country",
        "currency",
        "accessibility",
        "ownership_pct",
        "archived",
        "include_in_net_worth",
        "goal_eligible",
    ):
        if k in data and data[k] is None:
            raise ApiError(422, "VALIDATION_ERROR", f"{k} cannot be null.")
    new_type = data.get("type", a.type)
    check_kind_type(a.kind, new_type)
    if "currency" in data and data["currency"] != a.currency:
        has_vals = db.scalar(select(func.count()).select_from(Valuation).where(Valuation.account_id == a.id))
        if has_vals:
            raise ApiError(409, "CURRENCY_LOCKED", "An account's currency cannot change once it has valuations.")
    accessibility = data.get("accessibility", a.accessibility)
    note = data.get("accessibility_override_note", a.accessibility_override_note)
    _check_accessibility(a.kind, new_type, accessibility, note)
    _check_goal_eligible(a.kind, new_type, data.get("goal_eligible", a.goal_eligible))
    if "details" in data or "type" in data:
        data["details"] = validate_details(new_type, data.get("details", a.details))
    if data.get("archived") is False and a.archived:
        count = (
            db.scalar(
                select(func.count())
                .select_from(Account)
                .where(Account.household_id == ctx.hid, Account.deleted_at.is_(None), Account.archived.is_(False))
            )
            or 0
        )
        enforce_limit(db, ctx.hid, "accounts", count)
    overridden = "accessibility" in data and data["accessibility"] != a.accessibility
    for k, v in data.items():
        setattr(a, k, v)
    if overridden:
        audit(
            db,
            "account.accessibility_overridden",
            actor_id=ctx.user.id,
            household_id=ctx.hid,
            entity_type="account",
            entity_id=a.id,
        )
    db.commit()
    return account_out(a, latest_valuations(db, ctx.hid, account_ids=[a.id]).get(a.id))


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    a = get_account(ctx, account_id)
    a.deleted_at = datetime.now(UTC)
    audit(ctx.db, "account.deleted", actor_id=ctx.user.id, household_id=ctx.hid, entity_type="account", entity_id=a.id)
    ctx.db.commit()
    return Response(status_code=204)


@router.post("/accounts/{account_id}/valuations", response_model=ValuationOut, status_code=201)
def add_valuation(account_id: uuid.UUID, body: ValuationIn, ctx: Ctx = Depends(get_ctx)) -> Valuation:
    db = ctx.db
    a = get_account(ctx, account_id)
    old = None
    if body.supersedes_id is not None:
        old = db.scalar(select(Valuation).where(Valuation.id == body.supersedes_id, Valuation.account_id == a.id))
        if old is None:
            raise not_found("Valuation")
        if old.superseded_by is not None:
            raise ApiError(409, "ALREADY_SUPERSEDED", "That valuation has already been superseded.")
    v = Valuation(
        account_id=a.id,
        household_id=ctx.hid,
        amount=body.amount,
        currency=a.currency,
        as_of=body.as_of,
        source=body.source,
        verification_status=body.verification_status,
        note=body.note,
        supersedes_id=body.supersedes_id,
        created_by=ctx.user.id,
    )
    db.add(v)
    db.flush()
    if old is not None:
        old.superseded_by = v.id
    db.commit()
    return v


@router.get("/accounts/{account_id}/valuations", response_model=ItemList[ValuationOut])
def list_valuations(account_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> dict:
    a = get_account(ctx, account_id)
    rows = ctx.db.scalars(
        select(Valuation)
        .where(Valuation.account_id == a.id)
        .order_by(Valuation.as_of.desc(), Valuation.created_at.desc())
    ).all()
    return {"items": rows}
