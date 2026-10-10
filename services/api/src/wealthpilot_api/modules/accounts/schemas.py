"""Account/valuation request and response schemas, including per-type ``details`` validation."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from wealthpilot_calc.fields import (
    ASSET_TYPES,
    DEFAULT_ACCESSIBILITY,
    LIABILITY_TYPES,
    AnnualRate,
    Dec,
    FdCompounding,
    Fraction,
    NonNegDec,
)

from ...core.errors import ApiError
from ...core.schema import ApiModel, CurrencyCode, Money, OutModel, Pct

Country = Literal["US", "IN", "OTHER"]
Kind = Literal["asset", "liability"]
Accessibility = Literal["liquid", "restricted", "illiquid"]
VerificationStatus = Literal["estimated", "verified"]
ValuationSource = Literal["manual", "import", "computed"]


class _Details(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyDetails(_Details):
    notes: str | None = Field(default=None, max_length=1000)


class Retirement401kDetails(_Details):
    pretax_balance: NonNegDec | None = None
    roth_balance: NonNegDec | None = None
    employee_contribution_annual: NonNegDec | None = None
    employee_roth_pct: Fraction | None = None
    employer_match_rate: NonNegDec | None = None
    employer_match_up_to_pct_of_salary: Fraction | None = None
    contribution_limit_annual: NonNegDec | None = None
    access_age: Dec = Decimal("59.5")
    early_withdrawal_penalty_pct: Fraction | None = None


class IraDetails(_Details):
    annual_contribution: NonNegDec | None = None
    access_age: Dec | None = None


class EpfDetails(_Details):
    employee_component: NonNegDec | None = None
    employer_component: NonNegDec | None = None
    monthly_employee_contribution: NonNegDec | None = None
    monthly_employer_contribution: NonNegDec | None = None
    interest_rate_annual: AnnualRate | None = None
    access_status: Literal["unknown", "restricted", "user_verified_accessible"] = "unknown"
    notes: str | None = Field(default=None, max_length=1000)


class PpfDetails(_Details):
    annual_contribution: NonNegDec | None = None
    interest_rate_annual: AnnualRate | None = None
    maturity_date: date | None = None


class FdDetails(_Details):
    principal: NonNegDec
    start_date: date
    maturity_date: date
    interest_rate_annual: Fraction
    compounding: FdCompounding
    tds_rate: Fraction | None = None

    @model_validator(mode="after")
    def _dates(self) -> FdDetails:
        if self.maturity_date < self.start_date:
            raise ValueError("maturity_date must not precede start_date")
        return self


class Holding(_Details):
    symbol: str = Field(max_length=32)
    quantity: NonNegDec
    cost_basis: NonNegDec | None = None


class InvestmentDetails(_Details):
    expected_return_annual: AnnualRate | None = None
    holdings: list[Holding] = Field(default_factory=list)


class RealEstateDetails(_Details):
    is_primary_residence: bool | None = None
    rental_income_monthly: NonNegDec | None = None
    appreciation_annual: AnnualRate | None = None


class LiabilityDetails(_Details):
    interest_rate_annual: Fraction | None = None
    monthly_payment: NonNegDec | None = None
    term_months_remaining: int | None = Field(default=None, ge=0, le=1200)


DETAILS_BY_TYPE: dict[str, type[_Details]] = {
    "retirement_401k": Retirement401kDetails,
    "ira_traditional": IraDetails,
    "ira_roth": IraDetails,
    "hsa": IraDetails,
    "epf": EpfDetails,
    "ppf": PpfDetails,
    "fixed_deposit": FdDetails,
    "brokerage": InvestmentDetails,
    "mutual_fund": InvestmentDetails,
    "real_estate": RealEstateDetails,
    **{t: LiabilityDetails for t in LIABILITY_TYPES},
}


def validate_details(type_: str, details: dict[str, Any] | None) -> dict[str, Any]:
    model = DETAILS_BY_TYPE.get(type_, EmptyDetails)
    try:
        parsed = model.model_validate(details or {})
    except ValidationError as exc:
        errors = [{"loc": ["body", "details", *[str(x) for x in e["loc"]]], "msg": e["msg"]} for e in exc.errors()]
        raise ApiError(422, "VALIDATION_ERROR", f"Invalid details for account type {type_}.", errors=errors) from exc
    return parsed.model_dump(mode="json", exclude_none=True)


def check_kind_type(kind: str, type_: str) -> None:
    allowed = ASSET_TYPES if kind == "asset" else LIABILITY_TYPES
    if type_ not in allowed:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            f"type {type_!r} is not valid for kind {kind!r}.",
            errors=[{"loc": ["body", "type"], "msg": "type does not match kind"}],
        )


def default_accessibility(kind: str, type_: str) -> str:
    return DEFAULT_ACCESSIBILITY.get(type_, "liquid") if kind == "asset" else "liquid"


def _nonneg(v: Decimal) -> Decimal:
    if v < 0:
        raise ValueError("NEGATIVE_AMOUNT: amount must be >= 0 (liabilities are positive amounts owed)")
    return v


class ValuationIn(ApiModel):
    amount: Money
    as_of: date
    verification_status: VerificationStatus
    source: ValuationSource = "manual"
    note: str | None = Field(default=None, max_length=500)
    supersedes_id: uuid.UUID | None = None

    _check_amount = field_validator("amount")(_nonneg)


class InitialValuationIn(ApiModel):
    amount: Money
    as_of: date
    verification_status: VerificationStatus
    note: str | None = Field(default=None, max_length=500)

    _check_amount = field_validator("amount")(_nonneg)


class ValuationOut(OutModel):
    id: uuid.UUID
    account_id: uuid.UUID
    amount: Money
    currency: str
    as_of: date
    source: str
    verification_status: str
    note: str | None
    supersedes_id: uuid.UUID | None
    superseded_by: uuid.UUID | None
    created_at: datetime


class AccountCreate(ApiModel):
    kind: Kind
    type: str
    name: str = Field(min_length=1, max_length=120)
    country: Country
    currency: CurrencyCode
    accessibility: Accessibility | None = None
    accessibility_override_note: str | None = Field(default=None, max_length=500)
    goal_eligible: bool | None = None
    include_in_net_worth: bool = True
    ownership_pct: Pct = Decimal(100)
    details: dict[str, Any] | None = None
    initial_valuation: InitialValuationIn | None = None


class AccountPatch(ApiModel):
    type: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    country: Country | None = None
    currency: CurrencyCode | None = None
    accessibility: Accessibility | None = None
    accessibility_override_note: str | None = Field(default=None, max_length=500)
    goal_eligible: bool | None = None
    include_in_net_worth: bool | None = None
    ownership_pct: Pct | None = None
    details: dict[str, Any] | None = None
    archived: bool | None = None
    version: int | None = None


class AccountOut(OutModel):
    id: uuid.UUID
    household_id: uuid.UUID
    owner_id: uuid.UUID
    kind: str
    type: str
    name: str
    country: str
    currency: str
    accessibility: str
    accessibility_override_note: str | None
    goal_eligible: bool
    include_in_net_worth: bool
    ownership_pct: Pct
    details: dict[str, Any]
    archived: bool
    version: int
    latest_valuation: ValuationOut | None
    stale: bool
    created_at: datetime
    updated_at: datetime
