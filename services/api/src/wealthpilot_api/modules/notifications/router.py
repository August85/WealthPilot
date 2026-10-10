"""Notification preferences (opt-in), push devices and the in-app inbox (FR-NOT-*)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import Field
from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert

from ...core.errors import not_found
from ...core.schema import ApiModel, ItemList, OutModel, Page, decode_cursor, encode_cursor
from ..auth.deps import Ctx, get_ctx
from ..compliance.service import audit
from .models import NOTIFICATION_TYPES, Device, Notification, NotificationPreference

router = APIRouter(tags=["notifications"])

NotificationType = Literal["vest_reminder", "stale_balance", "goal_milestone"]


class PreferenceItem(ApiModel):
    type: NotificationType
    channel: Literal["push"] = "push"
    enabled: bool


class PreferencesIn(ApiModel):
    items: list[PreferenceItem] = Field(max_length=20)


class DeviceIn(ApiModel):
    expo_push_token: str = Field(min_length=1, max_length=255)
    platform: Literal["ios", "android"]


class DeviceOut(OutModel):
    id: uuid.UUID
    expo_push_token: str
    platform: str
    created_at: datetime


class NotificationOut(OutModel):
    id: uuid.UUID
    type: str
    title: str
    body: str
    created_at: datetime
    read_at: datetime | None


def preferences(ctx: Ctx) -> list[PreferenceItem]:
    stored = {
        (p.type, p.channel): p.enabled
        for p in ctx.db.scalars(
            select(NotificationPreference).where(NotificationPreference.user_id == ctx.user.id)
        ).all()
    }
    return [
        PreferenceItem(type=t, channel="push", enabled=stored.get((t, "push"), False))  # type: ignore[arg-type]
        for t in NOTIFICATION_TYPES
    ]


@router.get("/notification-preferences", response_model=ItemList[PreferenceItem])
def get_preferences(ctx: Ctx = Depends(get_ctx)) -> dict:
    return {"items": preferences(ctx)}


@router.patch("/notification-preferences", response_model=ItemList[PreferenceItem])
def patch_preferences(body: PreferencesIn, ctx: Ctx = Depends(get_ctx)) -> dict:
    for item in body.items:
        stmt = insert(NotificationPreference).values(
            id=uuid.uuid4(), user_id=ctx.user.id, type=item.type, channel=item.channel, enabled=item.enabled
        )
        ctx.db.execute(
            stmt.on_conflict_do_update(
                constraint="uq_notification_preferences_user_type_channel",
                set_={"enabled": item.enabled, "updated_at": datetime.now(UTC)},
            )
        )
    audit(
        ctx.db,
        "settings.notifications_changed",
        actor_id=ctx.user.id,
        household_id=ctx.hid,
        entity_type="user",
        entity_id=ctx.user.id,
        fields=sorted({i.type for i in body.items}),
    )
    ctx.db.commit()
    return {"items": preferences(ctx)}


@router.post("/devices", response_model=DeviceOut, status_code=201)
def register_device(body: DeviceIn, ctx: Ctx = Depends(get_ctx)) -> Device:
    now = datetime.now(UTC)
    stmt = insert(Device).values(
        id=uuid.uuid4(), user_id=ctx.user.id, expo_push_token=body.expo_push_token, platform=body.platform
    )
    # a token moves to whoever registered it last (device sign-in by another user)
    ctx.db.execute(
        stmt.on_conflict_do_update(
            index_elements=["expo_push_token"],
            set_={"user_id": ctx.user.id, "platform": body.platform, "last_seen_at": now},
        )
    )
    ctx.db.commit()
    dev = ctx.db.scalar(select(Device).where(Device.expo_push_token == body.expo_push_token))
    assert dev is not None
    return dev


@router.delete("/devices/{token}", status_code=204)
def delete_device(token: str = Path(..., max_length=255), ctx: Ctx = Depends(get_ctx)) -> Response:
    dev = ctx.db.scalar(select(Device).where(Device.expo_push_token == token, Device.user_id == ctx.user.id))
    if dev is None:
        raise not_found("Device")
    ctx.db.delete(dev)
    ctx.db.commit()
    return Response(status_code=204)


@router.get("/notifications", response_model=Page[NotificationOut])
def inbox(
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    unread_only: bool = False,
    ctx: Ctx = Depends(get_ctx),
) -> dict:
    q = select(Notification).where(Notification.user_id == ctx.user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    if cursor:
        ts, id_ = decode_cursor(cursor)
        q = q.where(
            or_(Notification.created_at < ts, and_(Notification.created_at == ts, Notification.id < uuid.UUID(id_)))
        )
    rows = list(
        ctx.db.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)).all()
    )
    nxt = encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id) if len(rows) > limit else None
    return {"items": rows[:limit], "next_cursor": nxt}


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Notification:
    n = ctx.db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == ctx.user.id)
    )
    if n is None:
        raise not_found("Notification")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        ctx.db.commit()
    return n
