"""Monthly household simulation used by :func:`wealthpilot_calc.scenario.run_scenario`.

Timing convention (END OF MONTH, see README): month ``m`` (1..N) ends on ``base_date + m months``.
Within a month, in order:

1. opening balances grow (monthly-equivalent of the annual rate; EPF per its accrual convention; FDs per
   their own compounding; RSU shares re-priced; liabilities accrue interest at ``rate/12``);
2. RSU vests dated in ``(base+(m−1) months, base+m months]`` settle per strategy;
3. fixed deposits maturing in the month pay out net of illustrative TDS;
4. income, taxes, 401(k)/EPF contributions, living/retirement spending, healthcare, housing and debt
   payments are booked (per currency);
5. a deficit in one currency is first covered by a surplus in the other (minus transfer cost), then by
   withdrawals in the user's withdrawal order (only from accessible buckets; tax-deferred withdrawals are
   grossed up for the user's withdrawal tax rate and any early-withdrawal penalty); anything left unmet is
   a recorded *deficit* (balances never go negative); surpluses are deposited;
6. the home purchase is checked (target month or, if unaffordable then, the first affordable month).

Salary, bonus, spending and housing running costs step up on each anniversary of ``base_date``; investment
growth, the INR/USD path and RSU prices compound monthly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from .epf import EpfState, epf_access_warnings, epf_step
from .fd import fd_value_at
from .fields import RETIREMENT_TYPES, SECURED_LIABILITY_TYPES
from .models import HouseholdSnapshot, ScenarioAssumptions, WarningSink
from .money import (
    HUNDRED,
    ONE,
    TWELVE,
    ZERO,
    add_months,
    monthly_rate_from_annual,
    months_until_ceil,
    to_decimal,
)
from .mortgage import cash_to_close, monthly_pmi, mortgage_payment
from .retirement_401k import contributions_401k
from .rsu import forecast_vest_cash

CLASS_ORDER = ("taxable", "india", "tax_deferred", "roth")
HOME_SOURCE_ORDER = ("us_cash", "rsu_proceeds", "brokerage", "india_liquid")


def _d(value: object, default: Decimal | None = None) -> Decimal | None:
    if value is None or value == "":
        return default
    try:
        return to_decimal(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


@dataclass
class SimBucket:
    id: str
    name: str
    currency: str
    country: str
    balance: Decimal = ZERO
    monthly_rate: Decimal = ZERO
    liquid: bool = False
    illiquid: bool = False
    retirement: bool = False
    wclass: str | None = None
    access_age: Decimal | None = None
    access_month: int | None = None
    never_accessible: bool = False
    early_allowed: bool = False
    early_penalty: Decimal = ZERO
    home_source: str | None = None
    # special kinds
    epf: EpfState | None = None
    epf_rate: Decimal = ZERO
    epf_convention: str = "annual_credit"
    epf_contribution: Decimal = ZERO
    symbol: str | None = None
    shares: Decimal = ZERO
    fd: dict | None = None

    def value(self, sim: Simulation, m: int) -> Decimal:
        if self.epf is not None:
            return self.epf.value
        if self.symbol is not None:
            return self.shares * sim.price(self.symbol, m)
        return self.balance

    def withdraw(self, sim: Simulation, m: int, amount: Decimal) -> None:
        if self.epf is not None:
            from_balance = min(amount, self.epf.balance)
            self.epf.balance -= from_balance
            self.epf.uncredited_interest = max(ZERO, self.epf.uncredited_interest - (amount - from_balance))
        elif self.symbol is not None:
            p = sim.price(self.symbol, m)
            self.shares = max(ZERO, self.shares - (amount / p if p > 0 else self.shares))
        else:
            self.balance = max(ZERO, self.balance - amount)


@dataclass
class SimLiability:
    id: str
    name: str
    type: str
    currency: str
    balance: Decimal
    monthly_rate: Decimal
    payment: Decimal
    secured: bool


@dataclass
class HomeTrack:
    price: Decimal
    currency: str
    down: Decimal
    principal: Decimal
    closing: Decimal
    cash_to_close: Decimal
    required: Decimal
    target_month: int
    pi: Decimal
    rate: Decimal
    purchased_month: int | None = None
    earliest_feasible_month: int | None = None
    available_at_target: Decimal | None = None
    timeline: list[tuple[int, Decimal]] = field(default_factory=list)
    mortgage: SimLiability | None = None


@dataclass
class MonthPoint:
    net_worth: Decimal
    liquid: Decimal
    us_assets: Decimal
    india_assets: Decimal
    retirement: Decimal
    investable: Decimal
    assets: Decimal
    liabilities: Decimal
    usd_inr: Decimal


@dataclass
class MonthFlows:
    income: Decimal = ZERO
    expenses: Decimal = ZERO
    savings: Decimal = ZERO
    rsu_net: Decimal = ZERO
    withdrawals: Decimal = ZERO
    deficit: Decimal = ZERO
    housing: Decimal = ZERO


@dataclass
class SimOverrides:
    savings_multiplier: Decimal = ONE
    rsu_price_factor: Decimal = ONE
    stop_month: int | None = None


class Simulation:
    def __init__(
        self,
        a: ScenarioAssumptions,
        s: HouseholdSnapshot,
        warnings: WarningSink,
        overrides: SimOverrides | None = None,
    ) -> None:
        self.a = a
        self.s = s
        self.w = warnings
        self.o = overrides or SimOverrides()
        self.N = a.horizon_years * 12
        self.rep = a.reporting_currency
        self.fx_factor = ONE + monthly_rate_from_annual(a.fx.inr_depreciation_annual)
        self._fx_cache: dict[int, Decimal] = {}
        self._price_cache: dict[tuple[str, int], Decimal] = {}
        self.buckets: list[SimBucket] = []
        self.liabilities: list[SimLiability] = []
        self.prices0: dict[str, Decimal] = {}
        self.price_factor = ONE
        self.vests: dict[int, list[tuple[str, Decimal, str]]] = {}
        self.m_ret = (a.household.retirement_age - a.household.current_age) * 12
        self.m_le = (a.household.life_expectancy - a.household.current_age) * 12
        self.points: list[MonthPoint] = []
        self.flows: list[MonthFlows] = []
        self.home: HomeTrack | None = None
        self.rsu_net_to_target = ZERO
        self.cost = a.fx.transfer_cost_pct
        self._special: dict[str, SimBucket] = {}
        self._setup()

    # ------------------------------------------------------------------ helpers
    def fx(self, m: int) -> Decimal:
        r = self._fx_cache.get(m)
        if r is None:
            r = self.a.fx.usd_inr_start * self.fx_factor**m
            self._fx_cache[m] = r
        return r

    def conv(self, amount: Decimal, frm: str, to: str, m: int) -> Decimal:
        if frm == to or amount == 0:
            return amount
        if frm == "USD" and to == "INR":
            return amount * self.fx(m)
        if frm == "INR" and to == "USD":
            return amount / self.fx(m)
        raise ValueError(f"unsupported conversion {frm}->{to}")

    def transfer(self, amount: Decimal, frm: str, to: str, m: int) -> Decimal:
        """Convert with the user's transfer cost applied to cross-currency moves."""
        if frm == to:
            return amount
        return self.conv(amount, frm, to, m) * (ONE - self.cost)

    def price(self, symbol: str, m: int) -> Decimal:
        key = (symbol, m)
        p = self._price_cache.get(key)
        if p is None:
            p0 = self.prices0.get(symbol, ZERO)
            p = p0 * self.price_factor**m
            self._price_cache[key] = p
        return p

    def date_at(self, m: int) -> date:
        return add_months(self.a.base_date, m)

    def age_at(self, m: int) -> Decimal:
        return Decimal(self.a.household.current_age) + Decimal(m) / TWELVE

    def working(self, m: int) -> bool:
        return m <= self.m_ret

    @staticmethod
    def year_index(m: int) -> int:
        return (m - 1) // 12 if m > 0 else 0

    def _rate(self, annual: Decimal) -> Decimal:
        return monthly_rate_from_annual(annual)

    def _growth_for(self, ccy: str, investment: bool) -> Decimal:
        r = self.a.returns
        if investment:
            return self._rate(r.us_portfolio_annual if ccy != "INR" else r.india_portfolio_annual)
        if ccy == "INR":
            return self._rate(r.india_cash_annual if r.india_cash_annual is not None else r.cash_annual)
        return self._rate(r.cash_annual)

    # ------------------------------------------------------------------ setup
    def _setup(self) -> None:
        a, s = self.a, self.s
        k401 = a.retirement_401k
        epf_contrib_assigned = False
        any_epf = False
        for acc in s.accounts:
            if not acc.include_in_net_worth:
                continue
            if acc.amount is None:
                self.w.add(
                    "STALE_BALANCE",
                    "warning",
                    "Account has no balance; it is excluded from the projection.",
                    "account",
                    acc.id,
                )
                continue
            amount = acc.amount * acc.ownership_pct / HUNDRED
            ccy = acc.currency
            if ccy not in ("USD", "INR"):
                rate = None
                if f"{ccy}/USD" in s.fx:
                    rate = s.fx[f"{ccy}/USD"].rate
                elif f"USD/{ccy}" in s.fx:
                    rate = ONE / s.fx[f"USD/{ccy}"].rate
                if rate is None:
                    self.w.add(
                        "FX_RATE_MISSING",
                        "critical",
                        f"No {ccy}/USD rate; this account is excluded from the projection.",
                        "account",
                        acc.id,
                    )
                    continue
                amount = amount * rate
                ccy = "USD"
                self.w.add(
                    "FX_HELD_CONSTANT",
                    "info",
                    "Account converted to USD at the saved rate and projected in USD.",
                    "account",
                    acc.id,
                )
            country = acc.country
            details = acc.details or {}
            if acc.kind == "liability":
                self._add_liability(acc.id, acc.name, acc.type, ccy, amount, details)
                continue
            liquid = acc.accessibility == "liquid"
            goal = acc.goal_eligible and acc.type not in RETIREMENT_TYPES
            t = acc.type
            if t in ("cash", "checking", "savings", "brokerage", "mutual_fund", "custom_asset"):
                investment = t in ("brokerage", "mutual_fund")
                rate = ZERO if t == "custom_asset" else self._growth_for(ccy, investment)
                wclass = ("india" if ccy == "INR" else "taxable") if liquid else None
                src = None
                if goal and liquid:
                    if ccy == "INR":
                        src = "india_liquid"
                    else:
                        src = "brokerage" if investment else "us_cash"
                self.buckets.append(
                    SimBucket(
                        acc.id,
                        acc.name,
                        ccy,
                        country,
                        amount,
                        rate,
                        liquid=liquid,
                        illiquid=acc.accessibility == "illiquid",
                        wclass=wclass,
                        home_source=src,
                    )
                )
            elif t == "retirement_401k":
                pre = _d(details.get("pretax_balance"))
                roth = _d(details.get("roth_balance"))
                if pre is None and roth is None:
                    pre, roth = amount, ZERO
                    self.w.add(
                        "RETIREMENT_SPLIT_ASSUMED",
                        "info",
                        "No pre-tax/Roth split entered for this 401(k); the whole balance is treated as pre-tax.",
                        "account",
                        acc.id,
                    )
                else:
                    pre = pre or ZERO
                    roth = roth or ZERO
                    tot = pre + roth
                    if tot > 0:
                        pre, roth = amount * pre / tot, amount * roth / tot
                    else:
                        pre, roth = amount, ZERO
                age = self._access_age(details, acc.id)
                rate = self._growth_for(ccy, True)
                early = bool(k401 and k401.allow_early_withdrawal)
                pen = (
                    k401.early_withdrawal_penalty_pct
                    if k401
                    else (_d(details.get("early_withdrawal_penalty_pct"), ZERO) or ZERO)
                )
                self.buckets.append(
                    SimBucket(
                        acc.id,
                        f"{acc.name} (pre-tax)",
                        ccy,
                        country,
                        pre,
                        rate,
                        liquid=liquid,
                        retirement=True,
                        wclass="tax_deferred",
                        access_age=age,
                        early_allowed=early,
                        early_penalty=pen,
                    )
                )
                self.buckets.append(
                    SimBucket(
                        acc.id + ":roth",
                        f"{acc.name} (Roth)",
                        ccy,
                        country,
                        roth,
                        rate,
                        liquid=liquid,
                        retirement=True,
                        wclass="roth",
                        access_age=age,
                        early_allowed=early,
                        early_penalty=pen,
                    )
                )
                self._special.setdefault("401k_pre", self.buckets[-2])
                self._special.setdefault("401k_roth", self.buckets[-1])
            elif t in ("ira_traditional", "ira_roth", "hsa"):
                age = self._access_age(details, acc.id)
                early = bool(k401 and k401.allow_early_withdrawal)
                pen = k401.early_withdrawal_penalty_pct if k401 else ZERO
                self.buckets.append(
                    SimBucket(
                        acc.id,
                        acc.name,
                        ccy,
                        country,
                        amount,
                        self._growth_for(ccy, True),
                        liquid=liquid,
                        retirement=True,
                        wclass="roth" if t == "ira_roth" else "tax_deferred",
                        access_age=age,
                        early_allowed=early,
                        early_penalty=pen,
                    )
                )
            elif t == "epf":
                any_epf = True
                rate = None
                if a.epf is not None:
                    rate = a.epf.interest_rate_annual
                else:
                    rate = _d(details.get("interest_rate_annual"))
                    if rate is None:
                        rate = a.returns.india_portfolio_annual
                        self.w.add(
                            "EPF_RATE_ASSUMED",
                            "info",
                            "No EPF interest rate entered; India portfolio return used.",
                            "account",
                            acc.id,
                        )
                acc_age = a.epf.accessible_from_age if a.epf is not None else None
                contrib = ZERO
                if a.epf is not None and not epf_contrib_assigned:
                    contrib = a.epf.monthly_contribution
                    epf_contrib_assigned = True
                self.buckets.append(
                    SimBucket(
                        acc.id,
                        acc.name,
                        ccy,
                        country,
                        ZERO,
                        ZERO,
                        liquid=liquid,
                        retirement=True,
                        wclass="india",
                        access_age=acc_age,
                        never_accessible=acc_age is None,
                        epf=EpfState(amount),
                        epf_rate=rate,
                        epf_convention=a.epf.accrual_convention if a.epf else "annual_credit",
                        epf_contribution=contrib,
                    )
                )
                self.w.extend(epf_access_warnings(acc_age, acc.id))
            elif t == "ppf":
                rate = _d(details.get("interest_rate_annual"), a.returns.india_portfolio_annual)
                maturity = details.get("maturity_date")
                access_month = None
                never = False
                if maturity:
                    try:
                        access_month = months_until_ceil(a.base_date, date.fromisoformat(str(maturity)))
                    except ValueError:
                        never = True
                else:
                    never = True
                if never:
                    self.w.add(
                        "ACCESS_UNKNOWN",
                        "info",
                        "No PPF maturity date entered; the projection does not withdraw from it.",
                        "account",
                        acc.id,
                    )
                self.buckets.append(
                    SimBucket(
                        acc.id,
                        acc.name,
                        ccy,
                        country,
                        amount,
                        self._rate(rate),
                        liquid=liquid,
                        retirement=True,
                        wclass="india",
                        access_month=access_month,
                        never_accessible=never,
                    )
                )
            elif t == "fixed_deposit":
                self._add_fd(acc.id, acc.name, ccy, country, amount, details, liquid, goal)
            elif t == "real_estate":
                rate = _d(details.get("appreciation_annual"), a.returns.real_estate_annual)
                self.buckets.append(SimBucket(acc.id, acc.name, ccy, country, amount, self._rate(rate), illiquid=True))
        # synthetic EPF bucket for contributions with no EPF account
        if a.epf is not None and not epf_contrib_assigned and a.epf.monthly_contribution > 0:
            any_epf = True
            self.buckets.append(
                SimBucket(
                    "projected:epf",
                    "EPF (projected contributions)",
                    "INR",
                    "IN",
                    retirement=True,
                    wclass="india",
                    access_age=a.epf.accessible_from_age,
                    never_accessible=a.epf.accessible_from_age is None,
                    epf=EpfState(ZERO),
                    epf_rate=a.epf.interest_rate_annual,
                    epf_convention=a.epf.accrual_convention,
                    epf_contribution=a.epf.monthly_contribution,
                )
            )
            self.w.extend(epf_access_warnings(a.epf.accessible_from_age))
        if any_epf and a.epf is None:
            self.w.add(
                "EPF_ACCESS_UNVERIFIED",
                "warning",
                "EPF withdrawal eligibility is not verified and no EPF assumptions were provided; EPF is "
                "never treated as accessible in this projection.",
            )
        # 401(k) contributions need buckets even without an account
        if k401 is not None and k401.employee_contribution_annual > 0:
            for key, wclass, label in (("401k_pre", "tax_deferred", "pre-tax"), ("401k_roth", "roth", "Roth")):
                if key not in self._special:
                    b = SimBucket(
                        f"projected:{key}",
                        f"401(k) {label} (projected contributions)",
                        "USD",
                        "US",
                        retirement=True,
                        wclass=wclass,
                        access_age=k401.access_age,
                        monthly_rate=self._growth_for("USD", True),
                        early_allowed=k401.allow_early_withdrawal,
                        early_penalty=k401.early_withdrawal_penalty_pct,
                    )
                    self.buckets.append(b)
                    self._special[key] = b
        self._setup_rsu()
        self._setup_home()
        if not s.accounts and not s.rsu_grants:
            self.w.add("NO_ACCOUNTS", "info", "No accounts were captured; the projection starts from zero balances.")

    def _access_age(self, details: dict, ref_id: str) -> Decimal | None:
        if self.a.retirement_401k is not None:
            return self.a.retirement_401k.access_age
        age = _d(details.get("access_age"))
        if age is None:
            self.w.add(
                "RETIREMENT_ACCESS_ASSUMED",
                "warning",
                "No access age entered for this retirement account; the projection assumes it can be "
                "withdrawn without restriction. Set an access age to model restrictions.",
                "account",
                ref_id,
            )
        return age

    def _add_liability(self, id_: str, name: str, type_: str, ccy: str, amount: Decimal, details: dict) -> None:
        rate = _d(details.get("interest_rate_annual"))
        payment = _d(details.get("monthly_payment"))
        term = details.get("term_months_remaining")
        if rate is None:
            rate = ZERO
            if payment is None:
                self.w.add(
                    "LIABILITY_TERMS_MISSING",
                    "info",
                    "No rate or payment entered for this liability; its balance is held constant.",
                    "account",
                    id_,
                )
        if payment is None:
            if term:
                payment = mortgage_payment(amount, rate, int(term))
            else:
                payment = amount * rate / TWELVE
                if rate > 0:
                    self.w.add(
                        "LIABILITY_TERMS_MISSING",
                        "info",
                        "No payment or remaining term entered; interest-only payments are assumed.",
                        "account",
                        id_,
                    )
        self.liabilities.append(
            SimLiability(id_, name, type_, ccy, amount, rate / TWELVE, payment, type_ in SECURED_LIABILITY_TYPES)
        )

    def _add_fd(
        self, id_: str, name: str, ccy: str, country: str, amount: Decimal, details: dict, liquid: bool, goal: bool
    ) -> None:
        a = self.a
        try:
            principal = to_decimal(details["principal"])
            start = date.fromisoformat(str(details["start_date"]))
            maturity = date.fromisoformat(str(details["maturity_date"]))
            rate = to_decimal(details["interest_rate_annual"])
            comp = str(details["compounding"])
            tds = _d(details.get("tds_rate"), ZERO) or ZERO
            v0 = fd_value_at(principal, start, rate, comp, a.base_date, maturity)
        except (KeyError, ValueError, TypeError):
            self.w.add(
                "FD_TERMS_MISSING",
                "warning",
                "Fixed deposit terms are incomplete; it is projected at the India portfolio return and "
                "never withdrawn.",
                "account",
                id_,
            )
            self.buckets.append(
                SimBucket(id_, name, ccy, country, amount, self._growth_for(ccy, True), liquid=liquid, wclass=None)
            )
            return
        if maturity <= a.base_date:
            self.w.add("FD_MATURED", "info", "This fixed deposit has matured; it is treated as cash.", "account", id_)
            self.buckets.append(
                SimBucket(
                    id_,
                    name,
                    ccy,
                    country,
                    amount,
                    self._growth_for(ccy, False),
                    liquid=True,
                    wclass="india" if ccy == "INR" else "taxable",
                    home_source=("india_liquid" if ccy == "INR" else "us_cash") if goal else None,
                )
            )
            return
        scale = amount / v0 if v0 > 0 else ONE
        self.buckets.append(
            SimBucket(
                id_,
                name,
                ccy,
                country,
                amount,
                ZERO,
                liquid=liquid,
                wclass=("india" if ccy == "INR" else "taxable") if liquid else None,
                home_source=("india_liquid" if ccy == "INR" else "us_cash") if (goal and liquid) else None,
                fd={
                    "principal": principal,
                    "start": start,
                    "maturity": maturity,
                    "rate": rate,
                    "comp": comp,
                    "tds": tds,
                    "scale": scale,
                    "matured": False,
                    "goal": goal,
                },
            )
        )

    def _setup_rsu(self) -> None:
        a, s = self.a, self.s
        rsu = a.rsu
        factor = self.o.rsu_price_factor
        growth = rsu.price_growth_annual if rsu else ZERO
        self.price_factor = ONE + monthly_rate_from_annual(growth)
        symbols = sorted({g.symbol for g in s.rsu_grants})
        if rsu is not None and rsu.price_now is not None and len(symbols) > 1:
            self.w.add(
                "RSU_PRICE_APPLIED_TO_ALL", "info", "The RSU price assumption is applied to every grant's symbol."
            )
        for sym in symbols:
            p0 = None
            if rsu is not None and rsu.price_now is not None:
                p0 = rsu.price_now
            elif sym in s.prices:
                p0 = s.prices[sym].price
            if p0 is None:
                self.w.add(
                    "MISSING_PRICE",
                    "warning",
                    f"No price for {sym}; its held and future shares are valued at zero in the projection.",
                    "symbol",
                    sym,
                )
                p0 = ZERO
            self.prices0[sym] = p0 * factor
        has_future = False
        for g in s.rsu_grants:
            if g.held_shares > 0:
                if g.held_in_account_id is None:
                    self._rsu_held_bucket(g.symbol).shares += g.held_shares
                else:
                    self.w.add(
                        "RSU_HELD_IN_BROKERAGE",
                        "info",
                        "Held RSU shares are assumed to be inside the linked brokerage balance and are not "
                        "added again.",
                        "rsu_grant",
                        g.id,
                    )
            for v in g.vests:
                if v.status != "scheduled":
                    continue
                if v.vest_date <= a.base_date:
                    self.w.add(
                        "VEST_NOT_RECORDED",
                        "info",
                        "A scheduled vest date has passed without a recorded vest; it is ignored.",
                        "rsu_grant",
                        g.id,
                    )
                    continue
                has_future = True
                m = months_until_ceil(a.base_date, v.vest_date)
                if rsu is None:
                    continue
                if m > self.m_ret:
                    self.w.add(
                        "RSU_VESTS_AFTER_RETIREMENT",
                        "info",
                        "Vests scheduled after the retirement date are assumed forfeited.",
                        "rsu_grant",
                        g.id,
                    )
                    continue
                self.vests.setdefault(m, []).append((g.symbol, v.scheduled_shares, g.id))
        if has_future:
            self.w.add(
                "UNVESTED_EQUITY_EXCLUDED",
                "info",
                "Unvested RSUs are excluded from current and liquid net worth; future vests enter the "
                "projection only as illustrative proceeds under your RSU assumptions."
                + ("" if rsu else " No RSU assumptions were given, so future vests are not projected."),
            )
        if rsu is not None and rsu.annual_refresh_value > 0:
            sym = symbols[0] if symbols else "REFRESH"
            if sym not in self.prices0:
                self.prices0[sym] = ONE * factor
            self._refresh_symbol = sym
        else:
            self._refresh_symbol = None

    def _rsu_held_bucket(self, symbol: str) -> SimBucket:
        key = f"rsu_held:{symbol}"
        b = self._special.get(key)
        if b is None:
            b = SimBucket(
                f"projected:{key}",
                f"{symbol} vested shares",
                "USD",
                "US",
                liquid=True,
                wclass="taxable",
                home_source="rsu_proceeds",
                symbol=symbol,
            )
            self.buckets.append(b)
            self._special[key] = b
        return b

    def _deposit_bucket(self, ccy: str, rsu: bool) -> SimBucket:
        home_pending = self.home is not None and self.home.purchased_month is None
        if home_pending:
            if rsu:
                key, name, src = "rsu_cash", "RSU proceeds (projected)", "rsu_proceeds"
                ccy = "USD"
            elif ccy == "INR":
                key, name, src = "cash_inr", "INR savings (projected)", "india_liquid"
            else:
                key, name, src = "cash_usd", "USD savings (projected)", "us_cash"
            investment = False
        else:
            if ccy == "INR" and not rsu:
                key, name, src = "invest_inr", "INR investments (projected)", "india_liquid"
            else:
                key, name, src, ccy = "invest_usd", "USD investments (projected)", "brokerage", "USD"
            investment = True
        b = self._special.get(key)
        if b is None:
            b = SimBucket(
                f"projected:{key}",
                name,
                ccy,
                "IN" if ccy == "INR" else "US",
                monthly_rate=self._growth_for(ccy, investment),
                liquid=True,
                wclass="india" if ccy == "INR" else "taxable",
                home_source=src,
            )
            self.buckets.append(b)
            self._special[key] = b
        return b

    def _setup_home(self) -> None:
        h = self.a.home
        if h is None or not h.enabled:
            return
        down = h.target_price * h.down_payment_pct
        principal = h.target_price - down
        ctc = cash_to_close(h.target_price, h.down_payment_pct, h.closing_cost_pct, h.prepaid_costs, h.credits)
        mt = months_until_ceil(self.a.base_date, h.purchase_date)
        if h.purchase_date < self.a.base_date:
            self.w.add(
                "HOME_DATE_IN_PAST",
                "warning",
                "The purchase date is before the base date; purchase is tested from the base date.",
            )
        pi = mortgage_payment(principal, h.mortgage_rate_annual, h.term_years * 12)
        self.home = HomeTrack(
            price=h.target_price,
            currency=h.currency,
            down=down,
            principal=principal,
            closing=h.target_price * h.closing_cost_pct,
            cash_to_close=ctc,
            required=ctc + h.emergency_reserve,
            target_month=mt,
            pi=pi,
            rate=h.mortgage_rate_annual,
        )
        if mt > self.N:
            self.w.add("HOME_BEYOND_HORIZON", "warning", "The purchase date is beyond the projection horizon.")

    # ------------------------------------------------------------------ run
    def run(self) -> Simulation:
        last = self.N if self.o.stop_month is None else min(self.N, self.o.stop_month)
        self.flows.append(MonthFlows())
        self._check_home(0)
        self.points.append(self._point(0))
        for m in range(1, last + 1):
            f = MonthFlows()
            needs = {"USD": ZERO, "INR": ZERO}  # positive = net inflow, negative = net outflow
            self._grow(m, needs, f)
            self._vests(m, needs, f)
            self._cashflows(m, needs, f)
            self._settle(m, needs, f)
            self.flows.append(f)
            self._check_home(m)
            self.points.append(self._point(m))
        return self

    def _grow(self, m: int, needs: dict[str, Decimal], f: MonthFlows) -> None:
        d = self.date_at(m)
        for b in self.buckets:
            if b.epf is not None:
                contrib = b.epf_contribution if self.working(m) else ZERO
                b.epf = epf_step(b.epf, b.epf_rate, contrib, b.epf_convention)
            elif b.fd is not None:
                fd = b.fd
                if fd["matured"]:
                    b.balance = b.balance * (ONE + b.monthly_rate)
                    continue
                if d >= fd["maturity"]:
                    gross = fd_value_at(
                        fd["principal"], fd["start"], fd["rate"], fd["comp"], fd["maturity"], fd["maturity"]
                    )
                    interest = gross - fd["principal"]
                    net = (gross - interest * fd["tds"]) * fd["scale"]
                    b.balance = net
                    fd["matured"] = True
                    b.monthly_rate = self._growth_for(b.currency, False)
                    b.liquid = True
                    b.wclass = "india" if b.currency == "INR" else "taxable"
                    if b.home_source is None and fd["goal"]:
                        b.home_source = "india_liquid" if b.currency == "INR" else "us_cash"
                else:
                    b.balance = (
                        fd_value_at(fd["principal"], fd["start"], fd["rate"], fd["comp"], d, fd["maturity"])
                        * fd["scale"]
                    )
            elif b.symbol is None:
                b.balance = b.balance * (ONE + b.monthly_rate)
        for lia in self.liabilities:
            if lia.balance <= 0:
                continue
            interest = lia.balance * lia.monthly_rate
            pay = min(lia.payment, lia.balance + interest)
            if lia is self._home_mortgage():
                continue  # the purchased home's mortgage is part of housing cost (_cashflows)
            lia.balance = lia.balance + interest - pay
            needs[lia.currency] -= pay
            f.expenses += self.conv(pay, lia.currency, self.rep, m)

    def _vests(self, m: int, needs: dict[str, Decimal], f: MonthFlows) -> None:
        rsu = self.a.rsu
        if rsu is None:
            return
        events = list(self.vests.get(m, []))
        if self._refresh_symbol and m >= 12 and m % 3 == 0 and self.working(m):
            p_grant = self.price(self._refresh_symbol, m - 12)
            if p_grant > 0:
                events.append((self._refresh_symbol, rsu.annual_refresh_value / Decimal(4) / p_grant, "refresh"))
        for symbol, shares, _gid in events:
            p = self.price(symbol, m)
            fc = forecast_vest_cash(
                shares=shares,
                price=p,
                strategy=rsu.strategy,
                withholding_rate=rsu.withholding_rate,
                additional_tax_rate=rsu.additional_tax_rate,
                sell_fraction=rsu.sell_fraction,
                transaction_cost_pct=rsu.transaction_cost_pct,
            )
            if fc.held_shares > 0:
                self._rsu_held_bucket(symbol).shares += fc.held_shares
            net = fc.net_cash
            if net > 0:
                self._deposit_bucket("USD", rsu=True).balance += net
            elif net < 0:
                needs["USD"] += net
            net_rep = self.conv(net, "USD", self.rep, m)
            f.rsu_net += net_rep
            if self.home is not None and m <= self.home.target_month:
                self.rsu_net_to_target += net_rep

    def _cashflows(self, m: int, needs: dict[str, Decimal], f: MonthFlows) -> None:
        a = self.a
        y = self.year_index(m)
        inc = a.income
        rep = self.rep
        inflow: dict[str, Decimal] = {"USD": ZERO, "INR": ZERO}
        outflow: dict[str, Decimal] = {"USD": ZERO, "INR": ZERO}
        infl = {"USD": a.inflation.us_annual, "INR": a.inflation.india_annual}

        def step(rate: Decimal, years: int) -> Decimal:
            return (ONE + rate) ** years

        if self.working(m):
            g = step(inc.salary_growth_annual, y)
            salary_annual = inc.salary_annual * g
            gross = (inc.salary_annual + inc.bonus_annual) * g / TWELVE
            pre = roth = match = ZERO
            k = a.retirement_401k
            if k is not None and (k.employee_contribution_annual > 0 or k.employer_match_rate > 0):
                c = contributions_401k(
                    salary_annual=salary_annual,
                    employee_contribution_annual=k.employee_contribution_annual,
                    employer_match_rate=k.employer_match_rate,
                    match_up_to_pct_of_salary=k.match_up_to_pct_of_salary,
                    contribution_limit_annual=k.contribution_limit_annual,
                    employee_roth_pct=k.employee_roth_pct,
                )
                pre, roth, match = c.employee_pretax / TWELVE, c.employee_roth / TWELVE, c.employer_match / TWELVE
                pre_b, roth_b = self._special.get("401k_pre"), self._special.get("401k_roth")
                if pre_b is not None:
                    pre_b.balance += self.conv(pre + match, inc.currency, pre_b.currency, m)
                if roth_b is not None:
                    roth_b.balance += self.conv(roth, inc.currency, roth_b.currency, m)
            tax = (gross - pre) * inc.effective_tax_rate
            inflow[inc.currency] += gross - pre - roth - tax
            f.income += self.conv(gross, inc.currency, rep, m)
            living = inc.living_expenses_monthly * step(infl[inc.expense_currency], y)
            if self.home is not None and self.home.purchased_month is not None and a.home is not None:
                rent = a.home.replaces_rent_monthly * step(infl[inc.expense_currency], y)
                living = max(ZERO, living - rent)
            outflow[inc.expense_currency] += living
            f.expenses += self.conv(living, inc.expense_currency, rep, m)
        else:
            r = a.retirement
            loc = "USD" if r.location == "US" else "INR"
            spend = r.spending_monthly_today * step(infl[loc], y)
            health = r.healthcare_monthly_today * step(r.healthcare_inflation_annual, y)
            if self.home is not None and self.home.purchased_month is not None and a.home is not None:
                rent = a.home.replaces_rent_monthly * step(infl[loc], y)
                spend = max(ZERO, spend - rent)
            outflow[loc] += spend + health
            f.expenses += self.conv(spend + health, loc, rep, m)
            ss_age = r.social_security_start_age
            if r.social_security_monthly_today > 0 and ss_age is not None and self.age_at(m) >= Decimal(ss_age):
                ss = r.social_security_monthly_today * step(a.inflation.us_annual, y)
                inflow["USD"] += ss
                f.income += self.conv(ss, "USD", rep, m)
        # housing
        if self.home is not None and self.home.purchased_month is not None and a.home is not None:
            h = a.home
            hc = self.home.currency
            years_owned = (m - self.home.purchased_month - 1) // 12
            infl_h = step(infl[hc], max(0, years_owned))
            mort = self.home.mortgage
            pi = ZERO
            pmi = ZERO
            if mort is not None and mort.balance > 0:
                interest = mort.balance * mort.monthly_rate
                pi = min(mort.payment, mort.balance + interest)
                pmi = monthly_pmi(self.home.principal, mort.balance, self.home.price, h.pmi_rate_annual)
                mort.balance = mort.balance + interest - pi
            running = (
                self.home.price * h.property_tax_rate_annual / TWELVE
                + h.insurance_annual / TWELVE
                + h.hoa_monthly
                + self.home.price * h.maintenance_pct_annual / TWELVE
                + h.utilities_monthly
            ) * infl_h
            housing = pi + pmi + running
            outflow[hc] += housing
            f.housing += self.conv(housing, hc, rep, m)
        for ccy in ("USD", "INR"):
            needs[ccy] += inflow[ccy] - outflow[ccy]

    def _settle(self, m: int, needs: dict[str, Decimal], f: MonthFlows) -> None:
        rep = self.rep
        net_rep = sum((self.conv(v, c, rep, m) for c, v in needs.items()), ZERO)
        f.savings += net_rep
        mult = self.o.savings_multiplier
        if mult != ONE:
            for c in needs:
                if needs[c] > 0:
                    needs[c] = needs[c] * mult
        # cross-currency netting
        for c, other in (("USD", "INR"), ("INR", "USD")):
            if needs[c] < 0 < needs[other]:
                want = -needs[c]
                avail_in_c = self.transfer(needs[other], other, c, m)
                use_in_c = min(want, avail_in_c)
                use_from_other = needs[other] * use_in_c / avail_in_c if avail_in_c > 0 else ZERO
                needs[c] += use_in_c
                needs[other] -= use_from_other
        for c in ("USD", "INR"):
            if needs[c] > 0:
                self._deposit_bucket(c, rsu=False).balance += needs[c]
            elif needs[c] < 0:
                unmet, withdrawn_rep = self._withdraw(m, c, -needs[c])
                f.withdrawals += withdrawn_rep
                if unmet > 0:
                    f.deficit += self.conv(unmet, c, rep, m)

    def _accessible(self, b: SimBucket, m: int) -> tuple[bool, Decimal]:
        if b.wclass is None or b.never_accessible:
            return False, ZERO
        if b.access_month is not None and m < b.access_month:
            return False, ZERO
        if b.access_age is not None and self.age_at(m) < b.access_age:
            if b.early_allowed:
                return True, b.early_penalty
            return False, ZERO
        return True, ZERO

    def _withdraw(self, m: int, ccy: str, need: Decimal) -> tuple[Decimal, Decimal]:
        order = list(self.a.retirement.withdrawal_order)
        order += [c for c in CLASS_ORDER if c not in order]
        tax_rate = self.a.retirement.withdrawal_tax_rate
        withdrawn_rep = ZERO
        for cls in order:
            if need <= 0:
                break
            for b in self.buckets:
                if need <= 0:
                    break
                if b.wclass != cls:
                    continue
                ok, penalty = self._accessible(b, m)
                if not ok:
                    continue
                val = b.value(self, m)
                if val <= 0:
                    continue
                keep = ONE - penalty - (tax_rate if cls == "tax_deferred" else ZERO)
                if keep <= 0:
                    continue
                unit = self.transfer(ONE, b.currency, ccy, m) * keep  # net received per unit withdrawn
                take = min(val, need / unit)
                b.withdraw(self, m, take)
                need -= take * unit
                withdrawn_rep += self.conv(take, b.currency, self.rep, m)
        if need < Decimal("1E-12"):
            need = ZERO
        return need, withdrawn_rep

    # ------------------------------------------------------------------ home
    def _home_mortgage(self) -> SimLiability | None:
        return self.home.mortgage if self.home is not None else None

    def _home_available(self, m: int) -> Decimal:
        h = self.home
        assert h is not None
        sources = self.a.home.funding_sources if self.a.home else None
        total = ZERO
        for b in self.buckets:
            if b.home_source is None or sources is None or not getattr(sources, b.home_source):
                continue
            v = b.value(self, m)
            if v > 0:
                total += self.transfer(v, b.currency, h.currency, m)
        return total

    def _check_home(self, m: int) -> None:
        h = self.home
        if h is None or h.purchased_month is not None:
            return
        avail = self._home_available(m)
        feasible = avail >= h.required
        if feasible and h.earliest_feasible_month is None:
            h.earliest_feasible_month = m
        h.timeline.append((m, avail))
        if m == h.target_month:
            h.available_at_target = avail
        if m >= h.target_month and feasible:
            self._purchase(m)

    def _purchase(self, m: int) -> None:
        h = self.home
        assert h is not None and self.a.home is not None
        sources = self.a.home.funding_sources
        need = h.cash_to_close
        for src in HOME_SOURCE_ORDER:
            if need <= 0:
                break
            if not getattr(sources, src):
                continue
            for b in self.buckets:
                if need <= 0:
                    break
                if b.home_source != src:
                    continue
                v = b.value(self, m)
                if v <= 0:
                    continue
                unit = self.transfer(ONE, b.currency, h.currency, m)
                take = min(v, need / unit)
                b.withdraw(self, m, take)
                need -= take * unit
        h.purchased_month = m
        country = "US" if h.currency == "USD" else "IN"
        self.buckets.append(
            SimBucket(
                "projected:home",
                "Home (projected)",
                h.currency,
                country,
                h.price,
                self._rate(self.a.returns.real_estate_annual),
                illiquid=True,
            )
        )
        if h.principal > 0:
            h.mortgage = SimLiability(
                "projected:mortgage",
                "Mortgage (projected)",
                "mortgage",
                h.currency,
                h.principal,
                h.rate / TWELVE,
                h.pi,
                True,
            )
            self.liabilities.append(h.mortgage)

    # ------------------------------------------------------------------ measurement
    def _point(self, m: int) -> MonthPoint:
        rep = self.rep
        assets = liquid = us = india = ret = investable = ZERO
        for b in self.buckets:
            v = self.conv(b.value(self, m), b.currency, rep, m)
            assets += v
            if b.liquid:
                liquid += v
            if b.country == "US":
                us += v
            elif b.country == "IN":
                india += v
            if b.retirement:
                ret += v
            if not b.illiquid:
                investable += v
        liab = unsecured = ZERO
        for lia in self.liabilities:
            v = self.conv(lia.balance, lia.currency, rep, m)
            liab += v
            if not lia.secured:
                unsecured += v
        return MonthPoint(assets - liab, liquid - unsecured, us, india, ret, investable, assets, liab, self.fx(m))
