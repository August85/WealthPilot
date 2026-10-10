# wealthpilot_calc

Pure-Python calculation engine for WealthPilot (spec §6, §8.3). No I/O, no database, no network and no
current-date lookups: every date comes from the inputs. Money uses `decimal.Decimal` under a module-level
context (`CALC_CONTEXT`, 40 significant digits); rounding (ROUND_HALF_EVEN) happens only at output
boundaries — 2 dp for money, 8 dp for rates and share quantities.

```bash
uv sync
uv run pytest --cov=wealthpilot_calc
```

## Conventions (documented and tested)

- **Monthly simulation, end-of-month timing.** Month `m` (1..N) ends at `base_date + m months`. Within each
  month: (1) opening balances grow at the monthly-equivalent rate `(1+annual)^(1/12) − 1`; (2) RSU vests dated
  in `(month_start, month_end]` settle; (3) fixed deposits maturing in the month pay out; (4) income, taxes,
  contributions, expenses, housing and debt payments are booked at month end (contributions earn nothing in
  the month they are made); (5) surpluses are deposited and shortfalls withdrawn in the user's withdrawal
  order; (6) the home purchase is checked.
- **Salary growth and inflation step annually** on each anniversary of `base_date`; the INR/USD path and
  investment growth compound monthly.
- **Mortgage** uses `r = APR/12` (spec §6.2); PMI is charged on the original loan amount only while the loan
  balance is above 80% of the purchase price.
- **Taxes are illustrative user-entered rates** (`rulepack_version = "none-1"`); nothing in this package is a
  tax rule.
- **RSU withholding is never subtracted twice:** the withheld (sold-to-cover) shares are removed from the
  share count, and sale proceeds are computed only on the remaining shares.
- **Liquid net worth** = liquid assets − liabilities that are not secured by real estate (mortgage and
  India home loans are netted against the illiquid property, not against liquid funds). Engineering
  default pending product review.
