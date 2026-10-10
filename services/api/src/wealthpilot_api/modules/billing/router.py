"""RevenueCat webhook (S23). Authenticated with the shared secret configured in the RevenueCat dashboard as the
``Authorization`` header value. Events are processed at most once (``billing_events``).

The mobile app must configure RevenueCat with ``appUserID = <WealthPilot user id>`` (the ``id`` from ``GET /me``).
"""

from __future__ import annotations

import hmac
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.errors import ApiError
from ..auth.deps import household_for
from ..compliance.service import audit
from ..households.models import User
from .models import BillingEvent, Subscription

router = APIRouter(tags=["billing"])

ACTIVE_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "NON_RENEWING_PURCHASE",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
}


class RevenueCatEvent(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    type: str
    app_user_id: str | None = None
    original_app_user_id: str | None = None
    aliases: list[str] | None = None
    entitlement_ids: list[str] | None = None
    entitlement_id: str | None = None
    expiration_at_ms: int | None = None


class RevenueCatWebhook(BaseModel):
    model_config = ConfigDict(extra="allow")
    api_version: str | None = None
    event: RevenueCatEvent


class WebhookAck(BaseModel):
    status: str


def _check_secret(request: Request) -> None:
    secret = request.app.state.settings.revenuecat_webhook_secret
    if not secret:
        raise ApiError(503, "WEBHOOK_NOT_CONFIGURED", "The billing webhook is not configured.")
    header = request.headers.get("authorization", "")
    candidate = header[7:] if header.lower().startswith("bearer ") else header
    if not hmac.compare_digest(candidate.encode(), secret.encode()):
        raise ApiError(401, "UNAUTHENTICATED", "Invalid webhook credentials.")


def _entitlement(ids: list[str]) -> str:
    lowered = {i.lower() for i in ids}
    if any("pro" in i for i in lowered):
        return "pro"
    if any("plus" in i for i in lowered):
        return "plus"
    return "free"


def _find_user(db: Session, ev: RevenueCatEvent) -> User | None:
    for cand in [ev.app_user_id, ev.original_app_user_id, *(ev.aliases or [])]:
        if not cand:
            continue
        try:
            u = db.get(User, uuid.UUID(cand))
        except ValueError:
            u = db.scalar(select(User).where(User.auth_subject == cand))
        if u is not None:
            return u
    return None


@router.post("/billing/revenuecat/webhook", response_model=WebhookAck)
def revenuecat_webhook(body: RevenueCatWebhook, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check_secret(request)
    ev = body.event
    inserted = db.execute(
        insert(BillingEvent).values(event_id=ev.id).on_conflict_do_nothing().returning(BillingEvent.event_id)
    ).scalar_one_or_none()
    if inserted is None:
        db.rollback()
        return {"status": "duplicate"}
    if ev.type == "TEST":
        db.commit()
        return {"status": "ok"}
    user = _find_user(db, ev)
    household = household_for(db, user) if user is not None else None
    if user is None or household is None:
        db.commit()  # acknowledged so RevenueCat stops retrying; nothing to update
        return {"status": "ignored"}
    sub = db.scalar(select(Subscription).where(Subscription.household_id == household.id).with_for_update())
    if sub is None:
        sub = Subscription(household_id=household.id, entitlement="free")
        db.add(sub)
    previous = sub.entitlement
    expires = datetime.fromtimestamp(ev.expiration_at_ms / 1000, UTC) if ev.expiration_at_ms else None
    ids = ev.entitlement_ids or ([ev.entitlement_id] if ev.entitlement_id else [])
    if ev.type in ACTIVE_EVENTS:
        sub.entitlement = _entitlement(ids)
        sub.renewal_status = "active"
        sub.expires_at = expires
    elif ev.type == "CANCELLATION":
        sub.renewal_status = "cancelled"  # access continues until expires_at
        sub.expires_at = expires or sub.expires_at
    elif ev.type == "BILLING_ISSUE":
        sub.renewal_status = "billing_issue"
    elif ev.type == "EXPIRATION":
        sub.entitlement = "free"
        sub.renewal_status = "expired"
        sub.expires_at = expires
    sub.provider = "revenuecat"
    sub.last_event_id = ev.id
    if sub.entitlement != previous:
        audit(
            db,
            "billing.entitlement_changed",
            actor_id=user.id,
            household_id=household.id,
            entity_type="subscription",
            entity_id=household.id,
            entitlement=sub.entitlement,
            previous_entitlement=previous,
            type=ev.type,
        )
    db.commit()
    return {"status": "ok"}
