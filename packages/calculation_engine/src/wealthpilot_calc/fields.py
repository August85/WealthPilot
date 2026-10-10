"""Pydantic field types: decimals that refuse floats and serialise as plain strings."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BeforeValidator, Field, PlainSerializer

from .money import fmt, to_decimal


def _coerce_decimal(value: Any) -> Any:
    if isinstance(value, Decimal | str | int) and not isinstance(value, bool):
        return to_decimal(value)
    if isinstance(value, float | bool):
        raise ValueError("decimal values must be sent as strings, not JSON numbers with fractions")
    return value


_ser = PlainSerializer(fmt, return_type=str, when_used="json")

Dec = Annotated[Decimal, BeforeValidator(_coerce_decimal), _ser]
"""Any finite decimal, serialised as a string in JSON."""

NonNegDec = Annotated[Decimal, BeforeValidator(_coerce_decimal), Field(ge=0), _ser]
PosDec = Annotated[Decimal, BeforeValidator(_coerce_decimal), Field(gt=0), _ser]
Fraction = Annotated[Decimal, BeforeValidator(_coerce_decimal), Field(ge=0, le=1), _ser]
"""A proportion in [0, 1] (tax rates, percentages expressed as fractions)."""
AnnualRate = Annotated[Decimal, BeforeValidator(_coerce_decimal), Field(gt=-1, le=10), _ser]
"""An annual growth/interest rate as a fraction; must be > −100%."""
Pct100 = Annotated[Decimal, BeforeValidator(_coerce_decimal), Field(ge=0, le=100), _ser]
"""A percentage in [0, 100] (ownership)."""

CurrencyCode = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
SimCurrency = Literal["USD", "INR"]
Country = Literal["US", "IN", "OTHER"]
AccountKind = Literal["asset", "liability"]
AssetType = Literal[
    "cash",
    "checking",
    "savings",
    "brokerage",
    "retirement_401k",
    "ira_traditional",
    "ira_roth",
    "hsa",
    "epf",
    "ppf",
    "fixed_deposit",
    "mutual_fund",
    "real_estate",
    "custom_asset",
]
LiabilityType = Literal[
    "mortgage",
    "home_loan_india",
    "auto_loan",
    "student_loan",
    "personal_loan",
    "credit_card",
    "other_liability",
]
Accessibility = Literal["liquid", "restricted", "illiquid"]
VerificationStatus = Literal["estimated", "verified"]
FdCompounding = Literal["monthly", "quarterly", "half_yearly", "annually", "at_maturity"]
VestStatus = Literal["scheduled", "vested", "cancelled"]
DispositionKind = Literal["sell_to_cover", "sale"]
RsuStrategy = Literal["hold", "sell_on_vest", "sell_fraction"]
Severity = Literal["info", "warning", "critical"]
WithdrawalClass = Literal["taxable", "india", "tax_deferred", "roth"]

ASSET_TYPES: tuple[str, ...] = AssetType.__args__  # type: ignore[attr-defined]
LIABILITY_TYPES: tuple[str, ...] = LiabilityType.__args__  # type: ignore[attr-defined]

RETIREMENT_TYPES = frozenset({"retirement_401k", "ira_traditional", "ira_roth", "hsa", "epf", "ppf"})
SECURED_LIABILITY_TYPES = frozenset({"mortgage", "home_loan_india"})

DEFAULT_ACCESSIBILITY: dict[str, str] = {
    "cash": "liquid",
    "checking": "liquid",
    "savings": "liquid",
    "brokerage": "liquid",
    "mutual_fund": "liquid",
    "retirement_401k": "restricted",
    "ira_traditional": "restricted",
    "ira_roth": "restricted",
    "hsa": "restricted",
    "epf": "restricted",
    "ppf": "restricted",
    "fixed_deposit": "restricted",
    "real_estate": "illiquid",
    "custom_asset": "illiquid",
}
