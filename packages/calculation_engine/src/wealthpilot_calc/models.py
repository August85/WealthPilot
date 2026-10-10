"""Pydantic models mirroring docs/api-contract.md (ScenarioAssumptions, HouseholdSnapshot, RunResult, ...)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .fields import (
    ASSET_TYPES,
    LIABILITY_TYPES,
    Accessibility,
    AccountKind,
    AnnualRate,
    Country,
    CurrencyCode,
    Dec,
    Fraction,
    NonNegDec,
    Pct100,
    PosDec,
    RsuStrategy,
    Severity,
    SimCurrency,
    VerificationStatus,
    VestStatus,
    WithdrawalClass,
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=False, validate_default=True)


# ---------------------------------------------------------------------------------------------------------
# Warnings
# ---------------------------------------------------------------------------------------------------------


class CalcWarning(BaseModel):
    """Contract `Warning`: {code, severity, message, ref_type?, ref_id?}."""

    model_config = ConfigDict(extra="forbid")
    code: str
    severity: Severity
    message: str
    ref_type: str | None = None
    ref_id: str | None = None


Warning = CalcWarning


class WarningSink:
    """Collects warnings, de-duplicating on (code, ref_type, ref_id) while preserving first-seen order."""

    def __init__(self) -> None:
        self._items: list[CalcWarning] = []
        self._seen: set[tuple[str, str | None, str | None]] = set()

    def add(
        self,
        code: str,
        severity: Severity,
        message: str,
        ref_type: str | None = None,
        ref_id: str | None = None,
    ) -> None:
        key = (code, ref_type, ref_id)
        if key in self._seen:
            return
        self._seen.add(key)
        self._items.append(CalcWarning(code=code, severity=severity, message=message, ref_type=ref_type, ref_id=ref_id))

    def extend(self, warnings: list[CalcWarning]) -> None:
        for w in warnings:
            self.add(w.code, w.severity, w.message, w.ref_type, w.ref_id)

    @property
    def items(self) -> list[CalcWarning]:
        return list(self._items)


# ---------------------------------------------------------------------------------------------------------
# Scenario assumptions
# ---------------------------------------------------------------------------------------------------------


class HouseholdAssumptions(_Model):
    current_age: int = Field(ge=0, le=120)
    retirement_age: int = Field(ge=0, le=120)
    life_expectancy: int = Field(ge=1, le=120)

    @model_validator(mode="after")
    def _ages(self) -> HouseholdAssumptions:
        if self.life_expectancy <= self.current_age:
            raise ValueError("life_expectancy must be greater than current_age")
        if self.retirement_age > self.life_expectancy:
            raise ValueError("retirement_age must not exceed life_expectancy")
        return self


class IncomeAssumptions(_Model):
    salary_annual: NonNegDec
    bonus_annual: NonNegDec = Decimal(0)
    currency: SimCurrency = "USD"
    salary_growth_annual: AnnualRate = Decimal(0)
    effective_tax_rate: Fraction
    living_expenses_monthly: NonNegDec
    expense_currency: SimCurrency = "USD"


class ReturnsAssumptions(_Model):
    us_portfolio_annual: AnnualRate
    india_portfolio_annual: AnnualRate
    cash_annual: AnnualRate
    real_estate_annual: AnnualRate
    india_cash_annual: AnnualRate | None = None
    """Growth for INR cash/savings; falls back to ``cash_annual`` when omitted."""


class InflationAssumptions(_Model):
    us_annual: AnnualRate
    india_annual: AnnualRate


class FxAssumptions(_Model):
    usd_inr_start: PosDec
    """INR per 1 USD at base_date (user's planning rate)."""
    inr_depreciation_annual: AnnualRate = Decimal(0)
    """Annual change of INR-per-USD; positive = INR weakens."""
    transfer_cost_pct: Fraction = Decimal(0)


class RsuAssumptions(_Model):
    price_now: PosDec | None = None
    price_growth_annual: AnnualRate = Decimal(0)
    strategy: RsuStrategy = "sell_on_vest"
    sell_fraction: Fraction = Decimal("0.5")
    withholding_rate: Fraction
    additional_tax_rate: Fraction = Decimal(0)
    annual_refresh_value: NonNegDec = Decimal(0)
    transaction_cost_pct: Fraction = Decimal(0)


class Retirement401kAssumptions(_Model):
    employee_contribution_annual: NonNegDec
    employer_match_rate: NonNegDec = Decimal(0)
    match_up_to_pct_of_salary: Fraction = Decimal(0)
    contribution_limit_annual: NonNegDec | None = None
    access_age: Dec = Decimal("59.5")
    employee_roth_pct: Fraction = Decimal(0)
    allow_early_withdrawal: bool = False
    early_withdrawal_penalty_pct: Fraction = Decimal(0)


class EpfAssumptions(_Model):
    interest_rate_annual: AnnualRate
    monthly_contribution: NonNegDec = Decimal(0)
    accessible_from_age: Dec | None = None
    """User-set age from which EPF may be withdrawn. ``None`` = never treated as accessible."""
    accrual_convention: Literal["annual_credit", "monthly_compound"] = "annual_credit"


class RetirementAssumptions(_Model):
    location: Literal["US", "IN"] = "US"
    spending_monthly_today: NonNegDec
    healthcare_monthly_today: NonNegDec = Decimal(0)
    healthcare_inflation_annual: AnnualRate = Decimal(0)
    social_security_monthly_today: NonNegDec = Decimal(0)
    social_security_start_age: int | None = Field(default=None, ge=0, le=120)
    withdrawal_order: list[WithdrawalClass] = Field(
        default_factory=lambda: ["taxable", "india", "tax_deferred", "roth"]
    )
    withdrawal_tax_rate: Fraction = Decimal(0)

    @field_validator("withdrawal_order")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("withdrawal_order entries must be unique")
        return v


class HomeFundingSources(_Model):
    us_cash: bool = True
    brokerage: bool = True
    rsu_proceeds: bool = True
    india_liquid: bool = False


class HomeAssumptions(_Model):
    enabled: bool = True
    target_price: PosDec
    currency: SimCurrency = "USD"
    purchase_date: date
    down_payment_pct: Fraction
    closing_cost_pct: Fraction = Decimal(0)
    prepaid_costs: NonNegDec = Decimal(0)
    credits: NonNegDec = Decimal(0)
    mortgage_rate_annual: Fraction
    term_years: int = Field(default=30, ge=1, le=50)
    property_tax_rate_annual: Fraction = Decimal(0)
    insurance_annual: NonNegDec = Decimal(0)
    hoa_monthly: NonNegDec = Decimal(0)
    pmi_rate_annual: Fraction = Decimal(0)
    maintenance_pct_annual: Fraction = Decimal(0)
    utilities_monthly: NonNegDec = Decimal(0)
    emergency_reserve: NonNegDec = Decimal(0)
    replaces_rent_monthly: NonNegDec = Decimal(0)
    """Rent (in expense currency) that stops after purchase; 0 if living expenses exclude rent."""
    funding_sources: HomeFundingSources = Field(default_factory=HomeFundingSources)


class ScenarioAssumptions(_Model):
    base_date: date
    reporting_currency: SimCurrency = "USD"
    horizon_years: int = Field(default=40, ge=1, le=80)
    household: HouseholdAssumptions
    income: IncomeAssumptions
    returns: ReturnsAssumptions
    inflation: InflationAssumptions
    fx: FxAssumptions
    rsu: RsuAssumptions | None = None
    retirement_401k: Retirement401kAssumptions | None = None
    epf: EpfAssumptions | None = None
    retirement: RetirementAssumptions
    home: HomeAssumptions | None = None


# ---------------------------------------------------------------------------------------------------------
# Household snapshot
# ---------------------------------------------------------------------------------------------------------


class SnapshotAccount(_Model):
    id: str
    name: str = ""
    kind: AccountKind
    type: str
    country: Country
    currency: CurrencyCode
    amount: Dec | None = None
    accessibility: Accessibility
    goal_eligible: bool = False
    include_in_net_worth: bool = True
    ownership_pct: Pct100 = Decimal(100)
    details: dict[str, Any] = Field(default_factory=dict)
    verification_status: VerificationStatus | None = None
    valuation_as_of: date | None = None

    @model_validator(mode="after")
    def _validate(self) -> SnapshotAccount:
        allowed = ASSET_TYPES if self.kind == "asset" else LIABILITY_TYPES
        if self.type not in allowed:
            raise ValueError(f"type {self.type!r} is not valid for kind {self.kind!r}")
        if self.amount is not None and self.amount < 0:
            raise ValueError("NEGATIVE_AMOUNT: amounts must be >= 0 (liabilities are positive amounts owed)")
        return self


class SnapshotVest(_Model):
    vest_date: date
    scheduled_shares: NonNegDec
    status: VestStatus = "scheduled"


class SnapshotRsuGrant(_Model):
    id: str
    symbol: str
    employer_name: str | None = None
    award_currency: CurrencyCode = "USD"
    held_in_account_id: str | None = None
    default_withholding_rate: Fraction | None = None
    held_shares: NonNegDec = Decimal(0)
    vests: list[SnapshotVest] = Field(default_factory=list)


class SnapshotPrice(_Model):
    price: PosDec
    currency: CurrencyCode
    as_of: date | None = None


class SnapshotFx(_Model):
    rate: PosDec
    as_of: date | None = None
    kind: str = "user"


class HouseholdSnapshot(_Model):
    as_of: date
    accounts: list[SnapshotAccount] = Field(default_factory=list)
    rsu_grants: list[SnapshotRsuGrant] = Field(default_factory=list)
    prices: dict[str, SnapshotPrice] = Field(default_factory=dict)
    fx: dict[str, SnapshotFx] = Field(default_factory=dict)
    """Keyed by ``"BASE/QUOTE"``; rate = units of QUOTE per 1 BASE."""


# ---------------------------------------------------------------------------------------------------------
# Run result
# ---------------------------------------------------------------------------------------------------------


class RunMetrics(_Model):
    net_worth_now: Dec
    liquid_net_worth_now: Dec
    net_worth_at_retirement: Dec | None = None
    retirement_balance_at_retirement: Dec | None = None
    ending_balance_at_life_expectancy: Dec | None = None
    first_deficit_age: int | None = None
    years_in_deficit: int = 0
    home_cash_needed: Dec | None = None
    home_cash_available_at_purchase: Dec | None = None
    home_funding_gap: Dec | None = None
    home_earliest_feasible_date: date | None = None
    home_pi_monthly: Dec | None = None
    home_all_in_monthly: Dec | None = None
    rsu_net_proceeds_to_purchase: Dec | None = None


class YearlyRow(_Model):
    year: int
    age: int
    net_worth: Dec
    net_worth_real: Dec
    liquid: Dec
    us_assets: Dec
    india_assets: Dec
    retirement_balance: Dec
    retirement_balance_real: Dec
    income: Dec
    expenses: Dec
    savings: Dec
    rsu_net_proceeds: Dec
    withdrawals: Dec
    deficit: Dec
    housing_cost: Dec
    usd_inr: Dec


class AllInMonthly(_Model):
    principal_interest: Dec
    property_tax: Dec
    insurance: Dec
    hoa: Dec
    pmi: Dec
    maintenance: Dec
    utilities: Dec
    total: Dec


class FundingPoint(_Model):
    month: date
    available: Dec
    required: Dec


class StressRow(_Model):
    label: str
    pi_monthly: Dec
    all_in_monthly: Dec
    funding_gap: Dec


class HomeResult(_Model):
    purchase_date: date
    actual_purchase_date: date | None = None
    currency: str
    price: Dec
    down_payment: Dec
    loan_principal: Dec
    closing_costs: Dec
    prepaid_costs: Dec
    credits: Dec
    cash_to_close: Dec
    emergency_reserve: Dec
    total_cash_needed: Dec
    pi_monthly: Dec
    all_in_monthly: AllInMonthly
    funding_timeline: list[FundingPoint]
    stress: list[StressRow]


class SensitivityRow(_Model):
    variable: str
    label: str
    metric: str
    low_input: Dec
    high_input: Dec
    low_result: Dec | None
    base_result: Dec | None
    high_result: Dec | None


class Explanation(_Model):
    metric: str
    formula: str
    inputs: dict[str, str]
    result: str | None


class RunResult(_Model):
    run_id: str | None = None
    status: Literal["completed"] = "completed"
    model_version: str
    rulepack_version: str
    currency: str
    base_date: date
    seed: int | None = None
    input_hash: str
    checksum: str = ""
    metrics: RunMetrics
    yearly: list[YearlyRow]
    home: HomeResult | None = None
    sensitivity: list[SensitivityRow]
    explanations: list[Explanation]
    warnings: list[CalcWarning]


# ---------------------------------------------------------------------------------------------------------
# Net worth
# ---------------------------------------------------------------------------------------------------------


class FxQuote(_Model):
    base: CurrencyCode
    quote: CurrencyCode
    rate: PosDec
    as_of: date | None = None
    provider: str = "user"
    kind: str = "user"
    license_reference: str | None = None


class NetWorthAccount(SnapshotAccount):
    """An account item for net worth: same as a snapshot account."""


class NetWorthRsuGrant(_Model):
    id: str
    name: str = ""
    symbol: str
    award_currency: CurrencyCode = "USD"
    country: Country = "US"
    held_in_account_id: str | None = None
    held_shares: NonNegDec = Decimal(0)
    unvested_shares: NonNegDec = Decimal(0)


class NetWorthInput(_Model):
    as_of: date
    currency: CurrencyCode
    accounts: list[NetWorthAccount] = Field(default_factory=list)
    rsu_grants: list[NetWorthRsuGrant] = Field(default_factory=list)
    prices: dict[str, SnapshotPrice] = Field(default_factory=dict)
    fx: list[FxQuote] = Field(default_factory=list)
    stale_after_days: int = 45
    fx_stale_after_days: int = 7
    price_stale_after_days: int = 7


class Bucket(_Model):
    key: str
    amount: Dec


class CurrencyBucket(_Model):
    key: str
    native_amount: Dec
    amount: Dec


class NetWorthItem(_Model):
    ref_type: Literal["account", "rsu_grant"]
    ref_id: str
    name: str
    kind: AccountKind
    type: str
    country: str
    native_amount: Dec | None
    native_currency: str
    amount: Dec | None
    ownership_pct: Dec
    liquid: bool
    goal_eligible: bool
    as_of: date | None
    verification_status: str | None
    stale: bool
    excluded_reason: str | None = None


class NetWorthResult(_Model):
    currency: str
    as_of: date
    gross_assets: Dec
    liabilities: Dec
    net_worth: Dec
    liquid_net_worth: Dec
    goal_eligible: Dec
    unvested_equity_excluded: Dec
    by_country: list[Bucket]
    by_currency: list[CurrencyBucket]
    by_class: list[Bucket]
    fx: list[FxQuote]
    items: list[NetWorthItem]
    warnings: list[CalcWarning]


class InsightRef(_Model):
    ref_type: str
    ref_id: str


class Insight(_Model):
    code: str
    severity: Severity
    title: str
    body: str
    value: str | None = None
    refs: list[InsightRef] = Field(default_factory=list)


class UpcomingVest(_Model):
    vest_id: str
    grant_id: str
    vest_date: date
    shares: NonNegDec
