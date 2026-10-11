"""Imports every module's models so ``Base.metadata`` is complete (Alembic, tests)."""

from .core.db import Base
from .modules.accounts.models import Account, Valuation
from .modules.billing.models import BillingEvent, Subscription
from .modules.compliance.models import AuditEvent
from .modules.equity.models import RsuDisposition, RsuGrant, RsuVest
from .modules.goals.models import Goal
from .modules.households.models import Household, Membership, SessionRevocation, TaxResidencyPeriod, User
from .modules.jobs.models import IdempotencyKey, Job
from .modules.market_data.models import FxRate, PriceQuote
from .modules.notifications.models import Device, Notification, NotificationPreference
from .modules.reports.models import ExportArtifact, ExportJob
from .modules.scenarios.models import Scenario, ScenarioVersion, SimulationRun

__all__ = [
    "Account",
    "AuditEvent",
    "Base",
    "BillingEvent",
    "Device",
    "ExportArtifact",
    "ExportJob",
    "FxRate",
    "Goal",
    "Household",
    "IdempotencyKey",
    "Job",
    "Membership",
    "Notification",
    "NotificationPreference",
    "PriceQuote",
    "RsuDisposition",
    "RsuGrant",
    "RsuVest",
    "Scenario",
    "ScenarioVersion",
    "SessionRevocation",
    "SimulationRun",
    "Subscription",
    "TaxResidencyPeriod",
    "User",
    "Valuation",
]
