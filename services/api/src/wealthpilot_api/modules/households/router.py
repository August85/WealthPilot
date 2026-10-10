"""Identity, onboarding, profile, tax residency, households (FR-ID-*)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import Field, field_validator, model_validator
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.errors import ApiError, not_found
from ...core.schema import ApiModel, CurrencyCode, ItemList, OutModel, Page, decode_cursor, encode_cursor
from ..auth.deps import Ctx, get_ctx, get_current_user, household_for
from ..billing.models import Subscription
from ..billing.service import entitlement_for, limits_for
from ..compliance.models import AuditEvent
from ..compliance.service import audit
from .models import Household, Membership, TaxResidencyPeriod, User

router = APIRouter(tags=["identity"])

Country = Literal["US", "IN", "OTHER"]
ResidencyType = Literal["resident", "non_resident", "rnor", "nri", "other"]


class Limits(OutModel):
    accounts: int | None
    goals: int | None
    scenarios: int | None


class MeOut(OutModel):
    id: uuid.UUID
    email: str | None
    display_name: str | None
    locale: str
    timezone: str
    reporting_currency: str
    home_country: str
    onboarding_completed: bool
    household_id: uuid.UUID | None
    entitlement: Literal["free", "plus", "pro"]
    disclaimer_accepted_at: datetime | None
    limits: Limits


class MePatch(ApiModel):
    display_name: str | None = Field(default=None, max_length=120)
    locale: str | None = Field(default=None, max_length=35)
    timezone: str | None = Field(default=None, max_length=64)
    reporting_currency: CurrencyCode | None = None
    home_country: Country | None = None


class TaxResidencyIn(ApiModel):
    jurisdiction: Country
    residency_type: ResidencyType
    from_date: date
    to_date: date | None = None
    verified_by_user: bool = False

    @model_validator(mode="after")
    def _range(self) -> TaxResidencyIn:
        if self.to_date is not None and self.to_date < self.from_date:
            raise ValueError("to_date must not precede from_date")
        return self


class TaxResidencyOut(OutModel):
    id: uuid.UUID
    jurisdiction: str
    residency_type: str
    from_date: date
    to_date: date | None
    verified_by_user: bool


class OnboardingIn(ApiModel):
    home_country: Country
    reporting_currency: CurrencyCode
    household_name: str = Field(min_length=1, max_length=120)
    disclaimer_accepted: bool
    tax_residency: list[TaxResidencyIn] = Field(default_factory=list)

    @field_validator("disclaimer_accepted")
    @classmethod
    def _must_accept(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("disclaimer_accepted must be true")
        return v


class TaxResidencyPut(ApiModel):
    items: list[TaxResidencyIn]


class AuditEventOut(OutModel):
    id: uuid.UUID
    action: str
    entity_type: str | None
    entity_id: str | None
    created_at: datetime
    metadata: dict


class MemberOut(OutModel):
    user_id: uuid.UUID
    role: str
    status: str


class HouseholdOut(OutModel):
    id: uuid.UUID
    display_name: str
    default_currency: str
    owner_user_id: uuid.UUID
    members: list[MemberOut]
    version: int


class HouseholdPatch(ApiModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    default_currency: CurrencyCode | None = None
    version: int | None = None


def me_out(db: Session, user: User) -> MeOut:
    hh = household_for(db, user)
    ent = entitlement_for(db, hh.id if hh else None)
    return MeOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        locale=user.locale,
        timezone=user.timezone,
        reporting_currency=user.reporting_currency,
        home_country=user.home_country,
        onboarding_completed=user.onboarding_completed,
        household_id=hh.id if hh else None,
        entitlement=ent,
        disclaimer_accepted_at=user.disclaimer_accepted_at,
        limits=Limits(**limits_for(ent)),
    )


@router.get("/me", response_model=MeOut)
def get_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MeOut:
    return me_out(db, user)


@router.patch("/me", response_model=MeOut)
def patch_me(body: MePatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MeOut:
    changed = body.model_dump(exclude_unset=True)
    for k, v in changed.items():
        if v is None and k in ("locale", "timezone", "reporting_currency", "home_country"):
            raise ApiError(422, "VALIDATION_ERROR", f"{k} cannot be null.")
        setattr(user, k, v)
    if changed:
        audit(
            db,
            "settings.profile_updated",
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            fields=sorted(changed),
        )
    db.commit()
    return me_out(db, user)


def _replace_residency(db: Session, user: User, items: list[TaxResidencyIn]) -> None:
    db.execute(delete(TaxResidencyPeriod).where(TaxResidencyPeriod.user_id == user.id))
    for it in items:
        db.add(TaxResidencyPeriod(user_id=user.id, **it.model_dump()))


@router.post("/me/onboarding", response_model=MeOut)
def onboarding(body: OnboardingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MeOut:
    user.home_country = body.home_country
    user.reporting_currency = body.reporting_currency
    if user.disclaimer_accepted_at is None:
        user.disclaimer_accepted_at = datetime.now(UTC)
    hh = household_for(db, user)
    if hh is None:
        hh = Household(
            display_name=body.household_name, default_currency=body.reporting_currency, owner_user_id=user.id
        )
        db.add(hh)
        db.flush()
        db.add(Membership(household_id=hh.id, user_id=user.id, role="owner", status="active"))
        db.add(Subscription(household_id=hh.id, entitlement="free"))
        audit(
            db,
            "settings.onboarding_completed",
            actor_id=user.id,
            household_id=hh.id,
            entity_type="household",
            entity_id=hh.id,
        )
    if body.tax_residency:
        _replace_residency(db, user, body.tax_residency)
    user.onboarding_completed = True
    db.commit()
    return me_out(db, user)


@router.get("/me/tax-residency", response_model=ItemList[TaxResidencyOut])
def get_residency(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    rows = db.scalars(
        select(TaxResidencyPeriod).where(TaxResidencyPeriod.user_id == user.id).order_by(TaxResidencyPeriod.from_date)
    ).all()
    return {"items": rows}


@router.put("/me/tax-residency", response_model=ItemList[TaxResidencyOut])
def put_residency(body: TaxResidencyPut, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    _replace_residency(db, user, body.items)
    audit(
        db,
        "settings.tax_residency_updated",
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        count=len(body.items),
    )
    db.commit()
    return get_residency(db, user)


@router.get("/me/security-events", response_model=Page[AuditEventOut])
def security_events(
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    q = select(AuditEvent).where(AuditEvent.actor_id == user.id)
    if cursor:
        ts, cid = decode_cursor(cursor)
        q = q.where(or_(AuditEvent.created_at < ts, and_(AuditEvent.created_at == ts, AuditEvent.id < uuid.UUID(cid))))
    rows = db.scalars(q.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(limit + 1)).all()
    nxt = encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id) if len(rows) > limit else None
    items = [
        AuditEventOut(
            id=r.id,
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            created_at=r.created_at,
            metadata=r.metadata_redacted or {},
        )
        for r in rows[:limit]
    ]
    return {"items": items, "next_cursor": nxt}


def _household_out(db: Session, hh: Household) -> HouseholdOut:
    members = db.scalars(select(Membership).where(Membership.household_id == hh.id)).all()
    return HouseholdOut(
        id=hh.id,
        display_name=hh.display_name,
        default_currency=hh.default_currency,
        owner_user_id=hh.owner_user_id,
        version=hh.version,
        members=[MemberOut(user_id=m.user_id, role=m.role, status=m.status) for m in members],
    )


def _own_household(ctx: Ctx, household_id: uuid.UUID) -> Household:
    if household_id != ctx.household.id:
        raise not_found("Household")
    return ctx.household


@router.get("/households/{household_id}", response_model=HouseholdOut)
def get_household(household_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> HouseholdOut:
    return _household_out(ctx.db, _own_household(ctx, household_id))


@router.patch("/households/{household_id}", response_model=HouseholdOut)
def patch_household(household_id: uuid.UUID, body: HouseholdPatch, ctx: Ctx = Depends(get_ctx)) -> HouseholdOut:
    hh = _own_household(ctx, household_id)
    data = body.model_dump(exclude_unset=True)
    version = data.pop("version", None)
    if version is not None and version != hh.version:
        raise ApiError(409, "VERSION_CONFLICT", "The household was modified; reload and retry.")
    for k, v in data.items():
        if v is not None:
            setattr(hh, k, v)
    audit(
        ctx.db,
        "settings.household_updated",
        actor_id=ctx.user.id,
        household_id=hh.id,
        entity_type="household",
        entity_id=hh.id,
        fields=sorted(data),
    )
    ctx.db.commit()
    return _household_out(ctx.db, hh)


@router.post("/households/{household_id}/invites", status_code=501)
def invite(household_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> None:
    _own_household(ctx, household_id)
    raise ApiError(501, "NOT_IMPLEMENTED", "Household sharing is planned for a later release.")
