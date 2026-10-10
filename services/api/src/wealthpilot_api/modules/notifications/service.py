"""Daily notification job: vest reminders, stale-balance and goal-milestone notices (all opt-in).

Each notification is de-duplicated per user by ``dedupe_key`` so the job is idempotent and can run repeatedly.
Titles and bodies never contain amounts, symbols or account names (FR-NOT-002: no inference from notifications).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from wealthpilot_calc import compute_net_worth

from ..accounts.service import active_accounts, is_stale, latest_valuations, net_worth_input
from ..auth.deps import household_for
from ..equity.models import RsuGrant, RsuVest
from ..goals.models import Goal
from ..households.models import User
from ..jobs.service import JobContext, register
from .models import Device, Notification, NotificationPreference

log = logging.getLogger("wealthpilot.notifications")

VEST_REMINDER_DAYS = 7
MILESTONES = (50, 100)


def _create(db: Session, user_id: uuid.UUID, type_: str, title: str, body: str, dedupe_key: str) -> uuid.UUID | None:
    stmt = insert(Notification).values(
        id=uuid.uuid4(), user_id=user_id, type=type_, title=title, body=body, dedupe_key=dedupe_key
    )
    return db.execute(
        stmt.on_conflict_do_nothing(constraint="uq_notifications_user_dedupe").returning(Notification.id)
    ).scalar_one_or_none()


def notifications_for_user(db: Session, user: User, enabled: set[str], today: date) -> list[uuid.UUID]:
    household = household_for(db, user)
    if household is None:
        return []
    hid = household.id
    created: list[uuid.UUID] = []
    if "vest_reminder" in enabled:
        vests = db.scalars(
            select(RsuVest)
            .join(RsuGrant, RsuGrant.id == RsuVest.grant_id)
            .where(
                RsuVest.household_id == hid,
                RsuVest.status == "scheduled",
                RsuGrant.deleted_at.is_(None),
                RsuGrant.status == "active",
                RsuVest.vest_date >= today,
                RsuVest.vest_date <= today + timedelta(days=VEST_REMINDER_DAYS),
            )
        ).all()
        for v in vests:
            days = (v.vest_date - today).days
            when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
            nid = _create(
                db, user.id, "vest_reminder", "Upcoming RSU vest", f"An RSU vest is scheduled {when}.", f"vest:{v.id}"
            )
            if nid:
                created.append(nid)
    if "stale_balance" in enabled:
        accounts = active_accounts(db, hid)
        vals = latest_valuations(db, hid)
        if any(is_stale(vals.get(a.id), today) for a in accounts):
            nid = _create(
                db,
                user.id,
                "stale_balance",
                "Balances need an update",
                "Some balances haven't been updated in over 45 days.",
                f"stale:{today:%Y-%m}",
            )
            if nid:
                created.append(nid)
    if "goal_milestone" in enabled:
        goals = db.scalars(select(Goal).where(Goal.household_id == hid, Goal.deleted_at.is_(None))).all()
        eligible: dict[str, Decimal] = {}
        for g in goals:
            if g.target_amount <= 0:
                continue
            if g.currency not in eligible:
                try:
                    eligible[g.currency] = compute_net_worth(net_worth_input(db, hid, g.currency, today)).goal_eligible
                except Exception:
                    eligible[g.currency] = Decimal(0)
            pct = eligible[g.currency] / g.target_amount * 100
            for m in MILESTONES:
                if pct >= m:
                    nid = _create(
                        db,
                        user.id,
                        "goal_milestone",
                        "Goal milestone reached",
                        f"One of your goals is {m}% funded by goal-eligible savings.",
                        f"goal:{g.id}:{m}",
                    )
                    if nid:
                        created.append(nid)
    return created


def push_pending(db: Session, ctx: JobContext, user_id: uuid.UUID) -> int:
    sender = ctx.services.get("push")
    pending = db.scalars(
        select(Notification).where(Notification.user_id == user_id, Notification.pushed_at.is_(None))
    ).all()
    if not pending:
        return 0
    tokens = list(db.scalars(select(Device.expo_push_token).where(Device.user_id == user_id)).all())
    now = datetime.now(UTC)
    for n in pending:
        if sender is not None and tokens:
            sender.send(tokens, n.title, n.body, {"notification_id": str(n.id), "type": n.type})
        n.pushed_at = now
    return len(pending)


@register("daily_notifications")
def handle_daily(db: Session, payload: dict[str, Any], ctx: JobContext) -> None:
    today = date.fromisoformat(payload["date"]) if payload.get("date") else datetime.now(UTC).date()
    prefs = db.execute(
        select(NotificationPreference.user_id, NotificationPreference.type)
        .join(User, User.id == NotificationPreference.user_id)
        .where(NotificationPreference.enabled.is_(True), User.status == "active")
    ).all()
    by_user: dict[uuid.UUID, set[str]] = {}
    for uid, t in prefs:
        by_user.setdefault(uid, set()).add(t)
    for uid, enabled in by_user.items():
        user = db.get(User, uid)
        if user is None:
            continue
        notifications_for_user(db, user, enabled, today)
        push_pending(db, ctx, uid)
        db.commit()
