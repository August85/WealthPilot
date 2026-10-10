"""Authentication dependencies: bearer token → Principal → provisioned User → household context.

Every data endpoint depends on :func:`get_ctx`, which scopes all queries to the caller's household; tenant
scope is never taken from a client-provided ID alone (spec §9).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.config import Settings
from ...core.db import get_db
from ...core.errors import ApiError
from ..compliance.service import audit
from ..households.models import Household, Membership, SessionRevocation, User
from .oidc import Principal, parse_dev_token


def _unauthenticated(detail: str = "A bearer token is required.") -> ApiError:
    return ApiError(401, "UNAUTHENTICATED", detail, headers={"WWW-Authenticate": "Bearer"})


def authenticate(request: Request) -> Principal:
    """Verify the bearer token (no database access)."""
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise _unauthenticated()
    token = header[7:].strip()
    if not token:
        raise _unauthenticated()
    settings: Settings = request.app.state.settings
    principal: Principal | None = None
    if settings.auth_mode == "dev":
        principal = parse_dev_token(token)
    if principal is None:
        principal = request.app.state.verifier.verify(token)
    request.state.principal = principal
    return principal


def check_revocation(db: Session, principal: Principal) -> None:
    rev = db.get(SessionRevocation, principal.subject)
    if rev is None:
        return
    issued = principal.iat or 0
    if issued < int(rev.revoked_before.timestamp()) + 1:
        raise ApiError(
            401,
            "TOKEN_REVOKED",
            "This session has been revoked. Sign in again.",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )


def provision_user(db: Session, principal: Principal) -> User:
    user = db.scalar(select(User).where(User.auth_subject == principal.subject))
    if user is None:
        user = User(auth_subject=principal.subject, email=principal.email)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(User.auth_subject == principal.subject))
            assert user is not None
        else:
            audit(db, "auth.user_provisioned", actor_id=user.id, entity_type="user", entity_id=user.id)
            db.commit()
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    principal = authenticate(request)
    check_revocation(db, principal)
    user = provision_user(db, principal)
    if user.status == "deleted":
        raise ApiError(401, "ACCOUNT_DELETED", "This account has been deleted.")
    ref = principal.session_ref
    if ref and user.last_session_ref != ref:
        user.last_session_ref = ref
        if principal.email and not user.email:
            user.email = principal.email
        audit(db, "auth.session_started", actor_id=user.id, entity_type="user", entity_id=user.id)
        db.commit()
    return user


def household_for(db: Session, user: User) -> Household | None:
    return db.scalar(
        select(Household)
        .join(Membership, Membership.household_id == Household.id)
        .where(Membership.user_id == user.id, Membership.status == "active", Household.deleted_at.is_(None))
        .order_by(Membership.created_at)
        .limit(1)
    )


@dataclass
class Ctx:
    db: Session
    user: User
    household: Household
    settings: Settings
    request: Request

    @property
    def hid(self) -> uuid.UUID:
        return self.household.id

    @property
    def now(self) -> datetime:
        return datetime.now(UTC)


def get_ctx(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Ctx:
    household = household_for(db, user)
    if household is None:
        raise ApiError(409, "ONBOARDING_REQUIRED", "Complete onboarding to create your household first.")
    return Ctx(db=db, user=user, household=household, settings=request.app.state.settings, request=request)
