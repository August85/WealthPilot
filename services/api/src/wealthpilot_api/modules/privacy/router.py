"""Account deletion (FR-ID-004, AC-008).

``POST /privacy/delete-request`` immediately: revokes every session for the caller's ``sub`` (server-side denylist,
tokens with ``iat`` at or before now are refused), disables notifications and removes push devices, soft-deletes
the user (and the household when the caller is its only active member), and schedules permanent erasure after
``WP_ERASURE_DELAY_DAYS`` on the job queue.
"""

from __future__ import annotations

import contextlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.schema import ApiModel
from ..auth.deps import authenticate, get_current_user, household_for
from ..compliance.service import audit
from ..households.models import Household, Membership, SessionRevocation, User
from ..jobs.service import JobContext, enqueue, register
from ..notifications.models import Device, NotificationPreference
from ..reports.models import ExportJob

router = APIRouter(tags=["privacy"])


class DeleteRequestIn(ApiModel):
    confirm: Literal["DELETE"]


class DeleteRequestOut(BaseModel):
    status: Literal["scheduled"]
    erase_after: date


def revoke_sessions(db: Session, subject: str, now: datetime) -> None:
    db.execute(
        insert(SessionRevocation)
        .values(subject=subject, revoked_before=now)
        .on_conflict_do_update(index_elements=["subject"], set_={"revoked_before": now})
    )


@router.post("/privacy/delete-request", response_model=DeleteRequestOut, status_code=202)
def delete_request(
    body: DeleteRequestIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict[str, Any]:
    principal = authenticate(request)
    settings = request.app.state.settings
    now = datetime.now(UTC)
    erase_after = now + timedelta(days=settings.erasure_delay_days)
    household = household_for(db, user)

    revoke_sessions(db, principal.subject, now)
    db.execute(update(NotificationPreference).where(NotificationPreference.user_id == user.id).values(enabled=False))
    db.execute(delete(Device).where(Device.user_id == user.id))

    user.status = "deleted"
    user.deleted_at = now
    if household is not None:
        others = (
            db.scalar(
                select(func.count())
                .select_from(Membership)
                .where(
                    Membership.household_id == household.id,
                    Membership.user_id != user.id,
                    Membership.status == "active",
                )
            )
            or 0
        )
        db.execute(update(Membership).where(Membership.user_id == user.id).values(status="removed"))
        if others == 0:
            household.deleted_at = now
        db.execute(update(ExportJob).where(ExportJob.user_id == user.id).values(expires_at=now))
    enqueue(
        db,
        "privacy_erasure",
        {"user_id": str(user.id), "household_id": str(household.id) if household else None},
        dedupe_key=f"privacy_erasure:{user.id}",
        run_after=erase_after,
    )
    audit(
        db,
        "privacy.delete_requested",
        actor_id=user.id,
        household_id=household.id if household else None,
        entity_type="user",
        entity_id=user.id,
        erase_after=erase_after.date().isoformat(),
    )
    db.commit()
    return {"status": "scheduled", "erase_after": erase_after.date()}


@register("privacy_erasure")
def handle_erasure(db: Session, payload: dict[str, Any], ctx: JobContext) -> None:
    """Permanently erase a deleted user's data (idempotent). Audit events keep only redacted metadata and lose
    their actor/household links via ``ON DELETE SET NULL``."""
    user = db.get(User, uuid.UUID(payload["user_id"]))
    if user is None:
        return
    if user.status != "deleted":
        return  # deletion was cancelled by support; nothing to erase
    db.execute(text("SET LOCAL wealthpilot.erasure = 'on'"))
    storage = ctx.services.get("storage")
    hid = uuid.UUID(payload["household_id"]) if payload.get("household_id") else None
    if hid is not None:
        household = db.get(Household, hid)
        if household is not None and household.deleted_at is not None:
            if storage is not None:
                for ref in db.scalars(
                    select(ExportJob.artifact_ref).where(
                        ExportJob.household_id == hid, ExportJob.artifact_ref.is_not(None)
                    )
                ):
                    with contextlib.suppress(Exception):  # best effort; artifacts also expire
                        storage.delete(ref)
            db.execute(delete(Household).where(Household.id == hid))
    audit(db, "privacy.erased", actor_id=None, entity_type="user", entity_id=user.id)
    db.execute(delete(User).where(User.id == user.id))
