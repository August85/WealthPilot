"""Current net worth (spec §6.1, FR-AS-003/004/005/007).

``NetWorth = Σ asset_native × ownership × FX(native→reporting) − Σ liability_native × ownership × FX``.

* Each item is converted and rounded to cents first; totals are sums of the rounded items, so the
  breakdowns reconcile exactly with what is displayed.
* ``by_country``, ``by_currency`` and ``by_class`` are *net* contributions (liabilities negative) and each
  sums to ``net_worth``.
* ``liquid_net_worth`` = liquid assets (accessibility ``liquid`` + vested RSUs not held in an account) −
  liabilities not secured by real estate (mortgage / India home loan are excluded).
* ``goal_eligible`` = assets flagged goal-eligible, never retirement accounts or unvested RSUs.
* A missing FX rate excludes the item and raises a critical ``FX_RATE_MISSING`` warning (never silent).
* Unvested RSUs never count (``unvested_equity_excluded`` reports what was left out).
* Held RSU shares count only when ``held_in_account_id`` is null; otherwise the brokerage valuation is
  assumed to include them (``RSU_HELD_IN_BROKERAGE``).
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from .fields import RETIREMENT_TYPES, SECURED_LIABILITY_TYPES
from .fx import FxRateMissing, FxTable, Rate
from .models import (
    Bucket,
    CurrencyBucket,
    FxQuote,
    NetWorthInput,
    NetWorthItem,
    NetWorthResult,
    WarningSink,
)
from .money import HUNDRED, ZERO, calc_context, q_money


@calc_context
def compute_net_worth(inp: NetWorthInput) -> NetWorthResult:
    rc = inp.currency
    table = FxTable(Rate(q.base, q.quote, q.rate, q.as_of) for q in inp.fx)
    quotes_by_pair = {frozenset((q.base, q.quote)): q for q in inp.fx}
    used: dict[frozenset[str], FxQuote] = {}
    warnings = WarningSink()

    gross = ZERO
    liabilities = ZERO
    liquid_assets = ZERO
    unsecured_liabilities = ZERO
    goal = ZERO
    unvested_excluded = ZERO
    by_country: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_class: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_ccy_native: dict[str, Decimal] = defaultdict(lambda: ZERO)
    by_ccy_rep: dict[str, Decimal] = defaultdict(lambda: ZERO)
    items: list[NetWorthItem] = []

    def to_reporting(amount: Decimal, ccy: str, ref_type: str, ref_id: str) -> Decimal | None:
        if ccy == rc:
            return amount
        try:
            converted = table.convert(amount, ccy, rc)
        except FxRateMissing:
            warnings.add(
                "FX_RATE_MISSING",
                "critical",
                f"No {ccy}/{rc} rate is saved, so this item is excluded from totals. Add an FX rate.",
                ref_type,
                ref_id,
            )
            return None
        key = frozenset((ccy, rc))
        rate = table.find(ccy, rc)
        q = quotes_by_pair.get(key)
        if q is not None and rate is not None and q.rate == rate.rate and q.as_of == rate.as_of:
            used[key] = q
        elif rate is not None:
            used[key] = FxQuote(base=rate.base, quote=rate.quote, rate=rate.rate, as_of=rate.as_of)
        return converted

    for acc in inp.accounts:
        own = acc.ownership_pct
        stale = acc.valuation_as_of is None or (inp.as_of - acc.valuation_as_of).days > inp.stale_after_days
        liquid = acc.kind == "asset" and acc.accessibility == "liquid"
        goal_ok = acc.kind == "asset" and acc.goal_eligible and acc.type not in RETIREMENT_TYPES
        base_item = dict(
            ref_type="account",
            ref_id=acc.id,
            name=acc.name,
            kind=acc.kind,
            type=acc.type,
            country=acc.country,
            native_currency=acc.currency,
            ownership_pct=own,
            liquid=liquid,
            goal_eligible=goal_ok,
            as_of=acc.valuation_as_of,
            verification_status=acc.verification_status,
            stale=stale,
        )
        if acc.amount is None:
            warnings.add(
                "STALE_BALANCE",
                "warning",
                "This account has no balance yet; it is shown but not counted.",
                "account",
                acc.id,
            )
            items.append(NetWorthItem(**base_item, native_amount=None, amount=None, excluded_reason="no_valuation"))
            continue
        if stale:
            warnings.add(
                "STALE_BALANCE",
                "warning",
                f"Balance is older than {inp.stale_after_days} days; update it for an accurate view.",
                "account",
                acc.id,
            )
        if acc.verification_status == "estimated":
            warnings.add("UNVERIFIED_BALANCE", "info", "This balance is an estimate, not verified.", "account", acc.id)
        native = acc.amount * own / HUNDRED
        if not acc.include_in_net_worth:
            items.append(
                NetWorthItem(
                    **base_item, native_amount=q_money(native), amount=None, excluded_reason="excluded_by_user"
                )
            )
            continue
        converted = to_reporting(native, acc.currency, "account", acc.id)
        if converted is None:
            items.append(
                NetWorthItem(**base_item, native_amount=q_money(native), amount=None, excluded_reason="fx_rate_missing")
            )
            continue
        amt = q_money(converted)
        sign = 1 if acc.kind == "asset" else -1
        if acc.kind == "asset":
            gross += amt
            if liquid:
                liquid_assets += amt
            if goal_ok:
                goal += amt
        else:
            liabilities += amt
            if acc.type not in SECURED_LIABILITY_TYPES:
                unsecured_liabilities += amt
        by_country[acc.country] += sign * amt
        by_class[acc.type] += sign * amt
        by_ccy_native[acc.currency] += sign * q_money(native)
        by_ccy_rep[acc.currency] += sign * amt
        items.append(NetWorthItem(**base_item, native_amount=q_money(native), amount=amt))

    for g in inp.rsu_grants:
        price = inp.prices.get(g.symbol)
        base_item = dict(
            ref_type="rsu_grant",
            ref_id=g.id,
            name=g.name or g.symbol,
            kind="asset",
            type="rsu_vested",
            country=g.country,
            ownership_pct=HUNDRED,
            verification_status=None,
        )
        if (
            price is not None
            and price.as_of is not None
            and (inp.as_of - price.as_of).days > inp.price_stale_after_days
        ):
            warnings.add(
                "STALE_PRICE",
                "warning",
                f"The latest {g.symbol} price is older than {inp.price_stale_after_days} days.",
                "rsu_grant",
                g.id,
            )
        if g.unvested_shares > 0:
            if price is not None:
                uv = to_reporting(g.unvested_shares * price.price, price.currency, "rsu_grant", g.id)
                if uv is not None:
                    unvested_excluded += q_money(uv)
            warnings.add(
                "UNVESTED_EQUITY_EXCLUDED",
                "info",
                "Unvested RSUs are not counted in net worth or liquid net worth.",
                "rsu_grant",
                g.id,
            )
        if g.held_shares <= 0:
            continue
        if g.held_in_account_id is not None:
            warnings.add(
                "RSU_HELD_IN_BROKERAGE",
                "info",
                "Held RSU shares are assumed to be included in the linked brokerage account's balance "
                "and are not added again.",
                "rsu_grant",
                g.id,
            )
            items.append(
                NetWorthItem(
                    **base_item,
                    native_amount=None,
                    native_currency=g.award_currency,
                    amount=None,
                    liquid=True,
                    goal_eligible=True,
                    as_of=None,
                    stale=False,
                    excluded_reason="included_in_account",
                )
            )
            continue
        if price is None:
            warnings.add(
                "MISSING_PRICE",
                "warning",
                f"No price saved for {g.symbol}; held shares are not counted.",
                "rsu_grant",
                g.id,
            )
            items.append(
                NetWorthItem(
                    **base_item,
                    native_amount=None,
                    native_currency=g.award_currency,
                    amount=None,
                    liquid=True,
                    goal_eligible=True,
                    as_of=None,
                    stale=True,
                    excluded_reason="missing_price",
                )
            )
            continue
        native = g.held_shares * price.price
        stale = price.as_of is None or (inp.as_of - price.as_of).days > inp.price_stale_after_days
        converted = to_reporting(native, price.currency, "rsu_grant", g.id)
        if converted is None:
            items.append(
                NetWorthItem(
                    **base_item,
                    native_amount=q_money(native),
                    native_currency=price.currency,
                    amount=None,
                    liquid=True,
                    goal_eligible=True,
                    as_of=price.as_of,
                    stale=stale,
                    excluded_reason="fx_rate_missing",
                )
            )
            continue
        amt = q_money(converted)
        gross += amt
        liquid_assets += amt
        goal += amt
        by_country[g.country] += amt
        by_class["rsu_vested"] += amt
        by_ccy_native[price.currency] += q_money(native)
        by_ccy_rep[price.currency] += amt
        items.append(
            NetWorthItem(
                **base_item,
                native_amount=q_money(native),
                native_currency=price.currency,
                amount=amt,
                liquid=True,
                goal_eligible=True,
                as_of=price.as_of,
                stale=stale,
            )
        )

    for q in used.values():
        if q.as_of is None or (inp.as_of - q.as_of).days > inp.fx_stale_after_days:
            warnings.add(
                "FX_RATE_STALE",
                "warning",
                f"The {q.base}/{q.quote} rate is older than {inp.fx_stale_after_days} days.",
                "fx_rate",
                f"{q.base}/{q.quote}",
            )

    return NetWorthResult(
        currency=rc,
        as_of=inp.as_of,
        gross_assets=q_money(gross),
        liabilities=q_money(liabilities),
        net_worth=q_money(gross - liabilities),
        liquid_net_worth=q_money(liquid_assets - unsecured_liabilities),
        goal_eligible=q_money(goal),
        unvested_equity_excluded=q_money(unvested_excluded),
        by_country=[Bucket(key=k, amount=q_money(v)) for k, v in sorted(by_country.items())],
        by_currency=[
            CurrencyBucket(key=k, native_amount=q_money(by_ccy_native[k]), amount=q_money(by_ccy_rep[k]))
            for k in sorted(by_ccy_rep)
        ],
        by_class=[Bucket(key=k, amount=q_money(v)) for k, v in sorted(by_class.items())],
        fx=sorted(used.values(), key=lambda q: (q.base, q.quote)),
        items=items,
        warnings=warnings.items,
    )
