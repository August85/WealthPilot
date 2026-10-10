"""Entitlements and free-tier limits (spec §12). Enforced server-side; 402 ``PLAN_LIMIT`` when exceeded."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import ApiError
from .models import Subscription

LIMITS: dict[str, dict[str, int | None]] = {
    "free": {"accounts": 5, "goals": 1, "scenarios": 1},
    "plus": {"accounts": None, "goals": None, "scenarios": 10},
    "pro": {"accounts": None, "goals": None, "scenarios": None},
}


def get_subscription(db: Session, household_id: uuid.UUID) -> Subscription | None:
    return db.scalar(select(Subscription).where(Subscription.household_id == household_id))


def entitlement_for(db: Session, household_id: uuid.UUID | None) -> str:
    if household_id is None:
        return "free"
    sub = get_subscription(db, household_id)
    if sub is None:
        return "free"
    if sub.entitlement != "free" and sub.expires_at is not None and sub.expires_at < datetime.now(UTC):
        return "free"
    return sub.entitlement


def limits_for(entitlement: str) -> dict[str, int | None]:
    return dict(LIMITS.get(entitlement, LIMITS["free"]))


def enforce_limit(db: Session, household_id: uuid.UUID, resource: str, current_count: int) -> None:
    ent = entitlement_for(db, household_id)
    limit = limits_for(ent)[resource]
    if limit is not None and current_count >= limit:
        raise ApiError(
            402,
            "PLAN_LIMIT",
            f"The {ent} plan allows {limit} {resource}. Upgrade to add more.",
            title="Plan limit reached",
        )
