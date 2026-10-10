"""One-variable sensitivity tables (spec §6.7): move one input down/up, hold everything else fixed."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from decimal import Decimal
from typing import Any, Literal

from pydantic import ValidationError

from .models import ScenarioAssumptions, SensitivityRow
from .money import ONE, ZERO, q_money

Mode = Literal["abs", "rel"]

# (path, label, mode, delta)
SENSITIVITY_VARIABLES: list[tuple[str, str, Mode, Decimal]] = [
    ("returns.us_portfolio_annual", "US returns ±2pp", "abs", Decimal("0.02")),
    ("returns.india_portfolio_annual", "India returns ±2pp", "abs", Decimal("0.02")),
    ("inflation.us_annual", "US inflation ±1pp", "abs", Decimal("0.01")),
    ("inflation.india_annual", "India inflation ±1pp", "abs", Decimal("0.01")),
    ("fx.inr_depreciation_annual", "INR depreciation ±2pp", "abs", Decimal("0.02")),
    ("income.salary_growth_annual", "Salary growth ±1pp", "abs", Decimal("0.01")),
    ("retirement.spending_monthly_today", "Retirement spending ±20%", "rel", Decimal("0.20")),
    ("rsu.price_growth_annual", "RSU price growth ±10pp", "abs", Decimal("0.10")),
]


def get_path(a: ScenarioAssumptions, path: str) -> Any:
    node: Any = a
    for p in path.split("."):
        node = getattr(node, p)
    return node


def sensitivity_table(
    a: ScenarioAssumptions,
    metrics: Sequence[str],
    *,
    base_values: dict[str, Decimal | None],
    evaluate: Callable[[ScenarioAssumptions], dict[str, Decimal | None]],
    with_value: Callable[[ScenarioAssumptions, str, Any], ScenarioAssumptions],
    variables: Sequence[tuple[str, str, Mode, Decimal]] = SENSITIVITY_VARIABLES,
) -> list[SensitivityRow]:
    rows: list[SensitivityRow] = []
    for path, label, mode, delta in variables:
        try:
            base_input = get_path(a, path)
        except AttributeError:
            continue
        if base_input is None:
            continue
        if mode == "abs":
            low, high = base_input - delta, base_input + delta
        else:
            low, high = base_input * (ONE - delta), base_input * (ONE + delta)
        if mode == "rel":
            low = max(low, ZERO)
        results: list[dict[str, Decimal | None]] = []
        for v in (low, high):
            try:
                results.append(evaluate(with_value(a, path, v)))
            except (ValidationError, ValueError):
                results.append({})
        for metric in metrics:
            lo, hi, base = results[0].get(metric), results[1].get(metric), base_values.get(metric)
            rows.append(
                SensitivityRow(
                    variable=path,
                    label=label,
                    metric=metric,
                    low_input=low,
                    high_input=high,
                    low_result=None if lo is None else q_money(lo),
                    base_result=None if base is None else q_money(base),
                    high_result=None if hi is None else q_money(hi),
                )
            )
    return rows
