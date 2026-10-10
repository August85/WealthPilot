"""RSU vest schedules, vest/disposition accounting and illustrative net-cash forecasts (spec §6.4, FR-RSU-*).

Share accounting per vest event (FR-RSU-002)::

    withheld = withheld_shares (net-settled by employer) + Σ sell_to_cover dispositions
    sold     = Σ sale dispositions
    held     = vested − withheld − sold            (conservation: withheld + sold ≤ vested)

Cash forecasts never subtract withholding twice: withheld (sold-to-cover) shares are removed from the share
count, and sale proceeds are computed on the remaining shares only.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .models import CalcWarning
from .money import ONE, ZERO, add_months, calc_context, floor_to, q_money, to_decimal


class ShareConservationError(ValueError):
    """Raised when withheld + sold shares would exceed vested shares, or a quantity is negative."""

    code = "SHARE_CONSERVATION"


@dataclass(frozen=True, slots=True)
class ScheduledVest:
    vest_date: date
    shares: Decimal


@calc_context
def generate_vest_schedule(
    *,
    start_date: date,
    total_shares: Decimal,
    total_months: int,
    frequency_months: int,
    cliff_months: int = 0,
) -> list[ScheduledVest]:
    """Equal vests every ``frequency_months`` over ``total_months`` from ``start_date``.

    * Shares are split evenly; whole-share grants vest whole shares and fractional grants are split at
      8 dp. Any remainder goes on the last vest.
    * Periods falling before the cliff accrue and vest together on the cliff date.
    """
    total = to_decimal(total_shares)
    if total < 0:
        raise ValueError("total_shares must be non-negative")
    if frequency_months <= 0 or total_months <= 0:
        raise ValueError("frequency_months and total_months must be positive")
    if total_months % frequency_months != 0:
        raise ValueError("total_months must be a multiple of frequency_months")
    if not 0 <= cliff_months <= total_months:
        raise ValueError("cliff_months must be within [0, total_months]")
    if cliff_months % frequency_months != 0:
        raise ValueError("cliff_months must be a multiple of frequency_months")
    periods = total_months // frequency_months
    quantum = ONE if total == total.to_integral_value() else Decimal("0.00000001")
    per = floor_to(total / Decimal(periods), quantum)

    vests: list[ScheduledVest] = []
    accrued = ZERO
    for k in range(1, periods + 1):
        offset = k * frequency_months
        accrued += per
        if offset < cliff_months:
            continue  # accrues into the cliff vest
        vests.append(ScheduledVest(add_months(start_date, offset), accrued))
        accrued = ZERO
    # remainder on the last vest
    allocated = sum((v.shares for v in vests), ZERO)
    remainder = total - allocated
    if vests and remainder != 0:
        last = vests[-1]
        vests[-1] = ScheduledVest(last.vest_date, last.shares + remainder)
    return vests


# ---------------------------------------------------------------------------------------------------------
# Vest accounting
# ---------------------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Disposition:
    kind: str  # "sell_to_cover" | "sale"
    shares: Decimal
    price: Decimal
    fees: Decimal = ZERO
    date: date | None = None


@dataclass(frozen=True, slots=True)
class VestRecord:
    scheduled_shares: Decimal
    status: str = "scheduled"  # scheduled | vested | cancelled
    vested_shares: Decimal | None = None
    vest_fmv: Decimal | None = None
    withheld_shares: Decimal | None = None
    dispositions: tuple[Disposition, ...] = ()


@dataclass(frozen=True, slots=True)
class ShareTotals:
    scheduled: Decimal
    vested: Decimal
    withheld: Decimal
    sold: Decimal
    held: Decimal
    unvested: Decimal


@calc_context
def vest_totals(vest: VestRecord) -> ShareTotals:
    """Share totals for one vest event. Raises :class:`ShareConservationError` on inconsistency."""
    scheduled = to_decimal(vest.scheduled_shares)
    if scheduled < 0:
        raise ShareConservationError("scheduled shares must be non-negative")
    if vest.status == "cancelled":
        return ShareTotals(scheduled, ZERO, ZERO, ZERO, ZERO, ZERO)
    if vest.status != "vested":
        if vest.dispositions:
            raise ShareConservationError("cannot dispose of shares from an unvested event")
        return ShareTotals(scheduled, ZERO, ZERO, ZERO, ZERO, scheduled)
    vested = to_decimal(vest.vested_shares if vest.vested_shares is not None else ZERO)
    withheld_direct = to_decimal(vest.withheld_shares if vest.withheld_shares is not None else ZERO)
    if vested < 0 or withheld_direct < 0:
        raise ShareConservationError("share quantities must be non-negative")
    stc = ZERO
    sold = ZERO
    for d in vest.dispositions:
        s = to_decimal(d.shares)
        if s < 0:
            raise ShareConservationError("disposition shares must be non-negative")
        if d.kind == "sell_to_cover":
            stc += s
        elif d.kind == "sale":
            sold += s
        else:
            raise ValueError(f"unknown disposition kind {d.kind!r}")
    withheld = withheld_direct + stc
    if withheld + sold > vested:
        raise ShareConservationError("withheld + sold shares exceed vested shares")
    return ShareTotals(scheduled, vested, withheld, sold, vested - withheld - sold, ZERO)


@calc_context
def check_disposition_allowed(vest: VestRecord, new: Disposition) -> None:
    """Validate that adding ``new`` keeps share conservation."""
    vest_totals(
        VestRecord(
            scheduled_shares=vest.scheduled_shares,
            status=vest.status,
            vested_shares=vest.vested_shares,
            vest_fmv=vest.vest_fmv,
            withheld_shares=vest.withheld_shares,
            dispositions=(*vest.dispositions, new),
        )
    )


@calc_context
def grant_totals(vests: Iterable[VestRecord]) -> ShareTotals:
    acc = [ZERO] * 6
    for v in vests:
        t = vest_totals(v)
        for i, x in enumerate((t.scheduled, t.vested, t.withheld, t.sold, t.held, t.unvested)):
            acc[i] += x
    return ShareTotals(*acc)


@dataclass(frozen=True, slots=True)
class VestReconciliation:
    gross_vest_value: Decimal
    estimated_withholding: Decimal
    actual_withholding_value: Decimal
    sell_to_cover_net: Decimal
    sale_proceeds_net: Decimal
    warnings: list[CalcWarning] = field(default_factory=list)


@calc_context
def reconcile_vest(vest: VestRecord, withholding_rate: Decimal, ref_id: str | None = None) -> VestReconciliation:
    """Event-level reconciliation (spec §6.4). ``estimated_withholding`` is illustrative only; an
    ``UNDER_WITHHOLDING`` warning is raised when the value actually withheld is below that estimate."""
    t = vest_totals(vest)
    fmv = to_decimal(vest.vest_fmv) if vest.vest_fmv is not None else None
    warnings: list[CalcWarning] = []
    if t.vested == 0 or fmv is None:
        if t.vested > 0 and fmv is None:
            warnings.append(
                CalcWarning(
                    code="MISSING_PRICE",
                    severity="warning",
                    message="Vest has no fair market value; values cannot be reconciled.",
                    ref_type="rsu_vest",
                    ref_id=ref_id,
                )
            )
        return VestReconciliation(ZERO, ZERO, ZERO, ZERO, ZERO, warnings)
    gross = t.vested * fmv
    estimate = gross * to_decimal(withholding_rate)
    direct = to_decimal(vest.withheld_shares or ZERO) * fmv
    stc_net = sum(
        (
            to_decimal(d.shares) * to_decimal(d.price) - to_decimal(d.fees)
            for d in vest.dispositions
            if d.kind == "sell_to_cover"
        ),
        ZERO,
    )
    sale_net = sum(
        (
            to_decimal(d.shares) * to_decimal(d.price) - to_decimal(d.fees)
            for d in vest.dispositions
            if d.kind == "sale"
        ),
        ZERO,
    )
    actual = direct + stc_net
    if q_money(actual) < q_money(estimate):
        warnings.append(
            CalcWarning(
                code="UNDER_WITHHOLDING",
                severity="warning",
                message="Shares withheld or sold to cover are worth less than the illustrative "
                "withholding estimate; additional tax may be due. Verify with a tax professional.",
                ref_type="rsu_vest",
                ref_id=ref_id,
            )
        )
    return VestReconciliation(gross, estimate, actual, stc_net, sale_net, warnings)


# ---------------------------------------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class VestCashForecast:
    vested_shares: Decimal
    price: Decimal
    gross_value: Decimal
    withheld_shares: Decimal
    withholding_value: Decimal
    sold_shares: Decimal
    held_shares: Decimal
    sale_proceeds: Decimal
    transaction_costs: Decimal
    additional_tax: Decimal
    net_cash: Decimal


@calc_context
def forecast_vest_cash(
    *,
    shares: Decimal,
    price: Decimal,
    strategy: str,
    withholding_rate: Decimal,
    additional_tax_rate: Decimal = ZERO,
    sell_fraction: Decimal = ZERO,
    transaction_cost_pct: Decimal = ZERO,
) -> VestCashForecast:
    """Illustrative cash from one future vest (FR-RSU-005).

    * ``withheld_shares = shares × withholding_rate`` are sold to cover and never reach the user.
    * Remaining ``net_shares`` are sold per strategy: ``hold`` → none, ``sell_on_vest`` → all,
      ``sell_fraction`` → ``sell_fraction × net_shares``.
    * ``net_cash = sold × price − transaction costs − gross × additional_tax_rate`` (the additional tax on
      vest income beyond withholding is due even when shares are held, so ``net_cash`` may be negative).
    """
    shares = to_decimal(shares)
    price = to_decimal(price)
    wr = to_decimal(withholding_rate)
    if shares < 0 or price < 0:
        raise ValueError("shares and price must be non-negative")
    gross = shares * price
    withheld = shares * wr
    net_shares = shares - withheld
    if strategy == "hold":
        sold = ZERO
    elif strategy == "sell_on_vest":
        sold = net_shares
    elif strategy == "sell_fraction":
        sold = net_shares * to_decimal(sell_fraction)
    else:
        raise ValueError(f"unknown RSU strategy {strategy!r}")
    held = net_shares - sold
    proceeds_gross = sold * price
    costs = proceeds_gross * to_decimal(transaction_cost_pct)
    add_tax = gross * to_decimal(additional_tax_rate)
    return VestCashForecast(
        vested_shares=shares,
        price=price,
        gross_value=gross,
        withheld_shares=withheld,
        withholding_value=withheld * price,
        sold_shares=sold,
        held_shares=held,
        sale_proceeds=proceeds_gross - costs,
        transaction_costs=costs,
        additional_tax=add_tax,
        net_cash=proceeds_gross - costs - add_tax,
    )


@calc_context
def net_sale_proceeds(
    sold_shares: Decimal, sale_price: Decimal, transaction_costs: Decimal = ZERO, estimated_taxes: Decimal = ZERO
) -> Decimal:
    """``NetSaleProceeds = sold_shares × sale_price − transaction_costs − estimated incremental taxes``."""
    return (
        to_decimal(sold_shares) * to_decimal(sale_price) - to_decimal(transaction_costs) - to_decimal(estimated_taxes)
    )


def find_duplicate_vests(vests: Sequence[tuple[date, str | None]]) -> list[int]:
    """Indexes of vests that duplicate an earlier ``(vest_date, source_event_id)`` (FR-RSU-006)."""
    seen: set[tuple[date, str | None]] = set()
    dups: list[int] = []
    for i, key in enumerate(vests):
        if key in seen:
            dups.append(i)
        seen.add(key)
    return dups
