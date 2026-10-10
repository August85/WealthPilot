# WealthPilot API contract (v1)

This is the shared contract between `services/api` (FastAPI) and the clients (`apps/mobile`, later `apps/web`).
The FastAPI app generates the authoritative OpenAPI document at `/v1/openapi.json`; this file is the
human-readable design it must implement. Requirement IDs refer to `spec.md` §5.

## Conventions

- Base path `/v1`. JSON only. `snake_case` field names.
- **Money and quantities are decimal strings** (`"1234.56"`, `"12.3456"`), never JSON numbers. Currency is ISO 4217 (`"USD"`, `"INR"`).
- Date-only fields are `YYYY-MM-DD` (no timezone conversion). Timestamps are ISO 8601 UTC (`2026-10-10T20:00:00Z`).
- IDs are UUID strings.
- Errors are RFC 7807 problem documents: `{"type","title","status","detail","code","request_id","errors"?: [{"loc","msg"}]}`.
  Every response carries `X-Request-ID`.
- Resources outside the caller's household return **404** (never 403) so existence is not leaked (AC-004).
- List endpoints: `?limit=50&cursor=...` → `{"items": [...], "next_cursor": string|null}`.
- Mutating `POST`s accept an optional `Idempotency-Key` header; a repeat with the same key and body returns the original response.
- Optimistic concurrency: mutable resources carry `version` (int). `PATCH` bodies may include `version`; a mismatch returns 409 `code=VERSION_CONFLICT`.
- Auth: `Authorization: Bearer <OIDC access/session JWT>`. The API verifies signature via the provider JWKS, `iss`, `aud` (if configured), `exp`.
  The user is identified by `sub` (`auth_subject`). First authenticated call auto-provisions the `User` row.
  **Dev mode only** (`WP_AUTH_MODE=dev`): `Bearer dev:<subject>:<email>` is accepted. Never enabled in production.
- Free-tier limits (spec §12) are enforced server-side and return 402 `code=PLAN_LIMIT` with `detail` naming the limit.

## Enums

| Name | Values |
|---|---|
| `Country` | `US`, `IN`, `OTHER` |
| `AccountKind` | `asset`, `liability` |
| `AssetType` | `cash`, `checking`, `savings`, `brokerage`, `retirement_401k`, `ira_traditional`, `ira_roth`, `hsa`, `epf`, `ppf`, `fixed_deposit`, `mutual_fund`, `real_estate`, `custom_asset` |
| `LiabilityType` | `mortgage`, `home_loan_india`, `auto_loan`, `student_loan`, `personal_loan`, `credit_card`, `other_liability` |
| `Accessibility` | `liquid`, `restricted`, `illiquid` |
| `VerificationStatus` | `estimated`, `verified` |
| `ValuationSource` | `manual`, `import`, `computed` |
| `EpfAccessStatus` | `unknown`, `restricted`, `user_verified_accessible` |
| `FdCompounding` | `monthly`, `quarterly`, `half_yearly`, `annually`, `at_maturity` |
| `VestStatus` | `scheduled`, `vested`, `cancelled` |
| `DispositionKind` | `sell_to_cover`, `sale` |
| `RsuStrategy` | `hold`, `sell_on_vest`, `sell_fraction` |
| `GoalType` | `home_purchase`, `retirement`, `education`, `emergency_fund`, `custom` |
| `ScenarioPreset` | `baseline`, `conservative`, `optimistic`, `custom` |
| `RunStatus` | `queued`, `running`, `completed`, `failed` |
| `Severity` | `info`, `warning`, `critical` |
| `Entitlement` | `free`, `plus`, `pro` |

Default accessibility by type: cash/checking/savings/brokerage/mutual_fund → `liquid`; retirement_401k/ira_*/hsa/epf/ppf/fixed_deposit → `restricted`; real_estate/custom_asset → `illiquid`. Users may override with an audit note (`accessibility_override_note`).
Default `goal_eligible`: true only for `liquid` assets.

## Identity, onboarding, profile (FR-ID-*)

`GET /me` →
```json
{"id":"uuid","email":"a@b.com","display_name":"AK","locale":"en-US","timezone":"America/Los_Angeles",
 "reporting_currency":"USD","home_country":"US","onboarding_completed":true,"household_id":"uuid",
 "entitlement":"free","disclaimer_accepted_at":"2026-10-10T20:00:00Z",
 "limits":{"accounts":5,"goals":1,"scenarios":1}}
```
`limits` values are `null` for unlimited.

`PATCH /me` body: any of `display_name, locale, timezone, reporting_currency, home_country`.

`POST /me/onboarding` (idempotent; creates the household + owner membership + residency periods):
```json
{"home_country":"US","reporting_currency":"USD","household_name":"Our household",
 "disclaimer_accepted":true,
 "tax_residency":[{"jurisdiction":"US","residency_type":"resident","from_date":"2020-01-01","to_date":null}]}
```
`disclaimer_accepted` must be `true` (422 otherwise). Returns `/me` shape.

`GET /me/tax-residency` → `{"items":[TaxResidencyPeriod]}`; `PUT /me/tax-residency` replaces the list.
`TaxResidencyPeriod`: `{id, jurisdiction: Country, residency_type: "resident"|"non_resident"|"rnor"|"nri"|"other", from_date, to_date|null, verified_by_user: bool}`.

`GET /me/security-events` → paged `AuditEvent` `{id, action, entity_type, entity_id, created_at, metadata}` (metadata redacted; no amounts).

`POST /privacy/delete-request` body `{"confirm":"DELETE"}` → 202 `{"status":"scheduled","erase_after":"date"}`. Revokes sessions (server-side token denylist by `sub`+`iat`), disables notifications, soft-deletes, queues erasure (FR-ID-004, AC-008).

`GET /households/{id}` → `{id, display_name, default_currency, owner_user_id, members:[{user_id, role:"owner"|"editor"|"viewer", status}]}`.
`PATCH /households/{id}` → `display_name, default_currency`. (Invites are post-MVP; `POST /households/{id}/invites` returns 501.)

## Accounts and valuations (FR-AS-*)

`Account`:
```json
{"id":"uuid","household_id":"uuid","owner_id":"uuid","kind":"asset","type":"fixed_deposit",
 "name":"HDFC FD","country":"IN","currency":"INR",
 "accessibility":"restricted","accessibility_override_note":null,
 "goal_eligible":false,"include_in_net_worth":true,"ownership_pct":"100",
 "details":{},"archived":false,"version":1,
 "latest_valuation":Valuation|null,"stale":false,
 "created_at":"...","updated_at":"..."}
```
`type` is an `AssetType` when `kind=asset` and a `LiabilityType` when `kind=liability`.
`stale` = latest valuation older than 45 days (or none).

`details` by type (all fields optional unless noted; decimals as strings):
- `retirement_401k`: `pretax_balance`, `roth_balance` (FR-RET-002: kept distinct; account valuation = sum), `employee_contribution_annual`, `employee_roth_pct`, `employer_match_rate` (e.g. "0.5"), `employer_match_up_to_pct_of_salary` (e.g. "0.06"), `contribution_limit_annual` (user-entered, no hardcoded IRS limits), `access_age` (default "59.5", editable), `early_withdrawal_penalty_pct`.
- `ira_traditional`/`ira_roth`/`hsa`: `annual_contribution`, `access_age`.
- `epf`: `employee_component`, `employer_component`, `monthly_employee_contribution`, `monthly_employer_contribution`, `interest_rate_annual`, `access_status: EpfAccessStatus` (default `unknown`), `notes`.
- `ppf`: `annual_contribution`, `interest_rate_annual`, `maturity_date`.
- `fixed_deposit`: `principal` (required), `start_date` (required), `maturity_date` (required), `interest_rate_annual` (required), `compounding: FdCompounding` (required), `tds_rate`.
- `brokerage`/`mutual_fund`: `expected_return_annual`, `holdings: [{symbol, quantity, cost_basis}]` (informational).
- `real_estate`: `is_primary_residence`, `rental_income_monthly`, `appreciation_annual`.
- liabilities: `interest_rate_annual`, `monthly_payment`, `term_months_remaining`.

Endpoints:
- `GET /accounts?kind=&country=&include_archived=false` → `{"items":[Account]}` (not paged; households are small).
- `POST /accounts` body: `kind, type, name, country, currency, accessibility?, accessibility_override_note?, goal_eligible?, include_in_net_worth?, ownership_pct?, details?, initial_valuation?: {amount, as_of, verification_status, note?}` → 201 `Account`.
- `GET /accounts/{id}`, `PATCH /accounts/{id}` (any create field except `kind`, plus `archived`, `version`), `DELETE /accounts/{id}` (soft delete).
- `POST /accounts/{id}/valuations` body `{amount, as_of, verification_status, source?="manual", note?, supersedes_id?}` → 201 `Valuation`. Append-only (FR-AS-006). `amount` must be ≥ 0 (liabilities are positive amounts owed; negative → 422 `code=NEGATIVE_AMOUNT`).
- `GET /accounts/{id}/valuations` → `{"items":[Valuation]}` newest first; superseded rows have `superseded_by`.

`Valuation`: `{id, account_id, amount, currency, as_of, source, verification_status, note, supersedes_id, superseded_by, created_at}`.

## Market data: FX and prices

`FxRate`: `{base, quote, rate, as_of, provider, kind: "user"|"reference", stale: bool, license_reference: string|null}`.
- `GET /fx/rates?base=USD&quote=INR` → the latest **user** rate for the pair (inverse derived if only the reverse exists), or 404 `code=FX_RATE_MISSING`. `stale` when older than 7 days.
- `POST /fx/rates` body `{base, quote, rate, as_of}` → 201 user rate.
- `GET /fx/reference?base=USD&quote=INR` → latest **reference** rate (free ECB-based feed via frankfurter.app, cached ≤ 24h, `provider:"frankfurter.app (ECB reference)"`, `license_reference:null`). Shown as a suggestion only; never used in calculations unless the user saves it as their rate. If the feed is down, returns the cached value with `stale:true`, or 503 `code=FX_FEED_UNAVAILABLE`.

`PriceQuote`: `{symbol, price, currency, as_of, provider:"manual", stale}` (stale > 7 days).
- `GET /prices?symbol=GOOG` → latest; `POST /prices` body `{symbol, price, currency, as_of}`.

## RSUs (FR-RSU-*)

`RsuGrant`:
```json
{"id":"uuid","employer_name":"Acme","symbol":"ACME","grant_date":"2025-03-15","granted_shares":"400",
 "award_currency":"USD","grant_price":"150.00","held_in_account_id":null,
 "default_withholding_rate":"0.37","status":"active","version":1,
 "vests":[RsuVest],
 "totals":{"scheduled":"400","vested":"100","withheld":"30","sold":"0","held":"70","unvested":"300"}}
```
`held_in_account_id`: the brokerage account where held shares sit. **Double-count rule (FR-AS-005):** if set, that account's valuation is assumed to already include the held shares and RSU held value is NOT added to net worth separately (a `RSU_HELD_IN_BROKERAGE` info warning explains this). If null, held shares × latest price are added as a liquid asset.

`RsuVest`: `{id, grant_id, vest_date, scheduled_shares, status: VestStatus, vested_shares|null, vest_fmv|null, withheld_shares|null, source_event_id|null, dispositions:[RsuDisposition]}`.
`RsuDisposition`: `{id, vest_id, date, kind: DispositionKind, shares, price, fees}`.

- `GET /rsu/grants`, `GET /rsu/grants/{id}`, `PATCH /rsu/grants/{id}`, `DELETE /rsu/grants/{id}`.
- `POST /rsu/grants` body: grant fields + optional `schedule: {start_date, cliff_months, frequency_months, total_months}` that generates equal vest events (shares split evenly, remainder on the last vest; cliff vest gets the accrued amount).
- `POST /rsu/grants/{id}/vests` body `{vest_date, scheduled_shares, source_event_id?}`; duplicate `(grant_id, vest_date, source_event_id)` → 409 `code=DUPLICATE_VEST` (FR-RSU-006).
- `PATCH /rsu/vests/{id}` body `{status, vested_shares, vest_fmv, withheld_shares, version?}` (record an actual vest). Validation: `withheld_shares ≤ vested_shares`; quantities ≥ 0.
- `DELETE /rsu/vests/{id}`.
- `POST /rsu/vests/{id}/dispositions` body `{date, kind, shares, price, fees?}`. Total sold + withheld ≤ vested → else 422 `code=SHARE_CONSERVATION`.
- `GET /rsu/calendar?from=&to=` → `{"items":[{vest_id, grant_id, employer_name, symbol, vest_date, shares, status, estimated_gross_value|null, currency}], "warnings":[Warning]}` (estimated value only if a price exists; `MISSING_PRICE` warning otherwise).

## Net worth and insights (FR-AS-004, §6.1)

`GET /net-worth?currency=USD&as_of=YYYY-MM-DD` →
```json
{"currency":"USD","as_of":"2026-10-10",
 "gross_assets":"20000.00","liabilities":"0.00","net_worth":"20000.00",
 "liquid_net_worth":"10000.00","goal_eligible":"10000.00","unvested_equity_excluded":"45000.00",
 "by_country":[{"key":"US","amount":"10000.00"},{"key":"IN","amount":"10000.00"}],
 "by_currency":[{"key":"INR","native_amount":"850000.00","amount":"10000.00"}],
 "by_class":[{"key":"fixed_deposit","amount":"10000.00"}],
 "fx":[FxRate],
 "items":[{"ref_type":"account"|"rsu_grant","ref_id":"uuid","name":"...","kind":"asset","type":"...","country":"IN",
           "native_amount":"850000.00","native_currency":"INR","amount":"10000.00","ownership_pct":"100",
           "liquid":false,"goal_eligible":false,"as_of":"2026-10-01","verification_status":"verified","stale":false}],
 "warnings":[Warning]}
```
All amounts in the reporting currency are ownership-weighted. Missing FX for a needed pair → item excluded with `FX_RATE_MISSING` critical warning (never silently converted). AC-001: USD 10,000 + INR 850,000 at 85 → gross 20,000.00.

`Warning`: `{code, severity, message, ref_type?, ref_id?}`. Codes used across the API include `FX_RATE_MISSING`, `FX_RATE_STALE`, `STALE_BALANCE`, `UNVERIFIED_BALANCE`, `UNVESTED_EQUITY_EXCLUDED`, `RSU_HELD_IN_BROKERAGE`, `MISSING_PRICE`, `EPF_ACCESS_UNVERIFIED`, `RETIREMENT_ACCESS_ASSUMED`, `CONCENTRATION_EMPLOYER_STOCK`, `HOME_FUNDING_GAP`, `RETIREMENT_DEFICIT`, `UNDER_WITHHOLDING`, `NEGATIVE_BALANCE`, `ILLUSTRATIVE_TAX`.

`GET /net-worth/history?currency=USD&months=12` → `{"items":[{"as_of":"2026-09-30","net_worth":"...","liquid_net_worth":"..."}]}` (month-end, using valuations effective at each date and the FX rate effective then; months with no data omitted).

`GET /insights?currency=USD` → `{"items":[{"code","severity","title","body","value"?,"refs":[{"ref_type","ref_id"}]}]}`. Deterministic only (spec §10.3): employer-stock concentration % of net worth, INR exposure % and the reporting-currency impact of a 10% INR move, stale/unverified balances, unverified EPF access, upcoming vests in 30 days, liquid vs restricted share.

## Goals

`Goal`: `{id, type: GoalType, name, target_date, target_amount, currency, priority (1..5), scenario_id|null, details, version, created_at}`.
`GET /goals`, `POST /goals`, `GET/PATCH/DELETE /goals/{id}`. `GET /goals` items include `progress: {funded_amount, pct, as_of, scenario_run_id|null}` computed from goal-eligible funds (or the latest run of the linked scenario).

## Scenarios, versions, runs (FR-SCN-*, §6)

`Scenario`: `{id, name, kind: "home"|"retirement"|"general", preset: ScenarioPreset, goal_id|null, parent_id|null, archived, active_version: ScenarioVersion|null, latest_run: RunSummary|null, created_at, updated_at, version}`.
- `GET /scenarios?include_archived=false`, `POST /scenarios` body `{name, kind, preset, goal_id?, assumptions?}` (if `assumptions` omitted, server creates version 1 from `GET /scenarios/defaults`), `GET/PATCH /scenarios/{id}` (rename, archive, goal link), `POST /scenarios/{id}/clone` body `{name}`.
- `GET /scenarios/defaults?preset=baseline&kind=home` → `ScenarioAssumptions` prefilled from the user's data (latest FX, salary-ish fields empty if unknown) with preset adjustments: conservative = returns −2pp, inflation +1pp, INR depreciation +1pp, RSU price growth −10pp, mortgage rate +1pp; optimistic = returns +1pp, RSU price growth +5pp, INR depreciation −1pp.
- `POST /scenarios/{id}/versions` body `{assumptions: ScenarioAssumptions, notes?}` → 201 `ScenarioVersion` and sets it active. The server captures a `HouseholdSnapshot` at this moment. Versions are immutable.
- `GET /scenarios/{id}/versions` → `{"items":[ScenarioVersion]}`.

`ScenarioVersion`: `{id, scenario_id, number, assumptions, snapshot: HouseholdSnapshot, input_hash:"sha256:...", model_version, rulepack_version, notes, created_at}`.

`ScenarioAssumptions` (every value is a user/assumption input; nothing is a market fact):
```json
{
 "base_date":"2026-10-01","reporting_currency":"USD","horizon_years":40,
 "household":{"current_age":41,"retirement_age":60,"life_expectancy":92},
 "income":{"salary_annual":"270000","bonus_annual":"40000","currency":"USD","salary_growth_annual":"0.03",
           "effective_tax_rate":"0.32","living_expenses_monthly":"9000","expense_currency":"USD"},
 "returns":{"us_portfolio_annual":"0.06","india_portfolio_annual":"0.08","cash_annual":"0.02","real_estate_annual":"0.03"},
 "inflation":{"us_annual":"0.025","india_annual":"0.05"},
 "fx":{"usd_inr_start":"85.00","inr_depreciation_annual":"0.02","transfer_cost_pct":"0.01"},
 "rsu":{"price_now":"180.00","price_growth_annual":"0.05","strategy":"sell_on_vest","sell_fraction":"0.5",
        "withholding_rate":"0.37","additional_tax_rate":"0.05","annual_refresh_value":"0"},
 "retirement_401k":{"employee_contribution_annual":"24000","employer_match_rate":"0.5",
        "match_up_to_pct_of_salary":"0.06","contribution_limit_annual":"24000","access_age":"59.5"},
 "epf":{"interest_rate_annual":"0.0825","monthly_contribution":"0","accessible_from_age":null},
 "retirement":{"location":"US","spending_monthly_today":"8000","healthcare_monthly_today":"1200",
        "healthcare_inflation_annual":"0.05","social_security_monthly_today":"0","social_security_start_age":67,
        "withdrawal_order":["taxable","india","tax_deferred","roth"],"withdrawal_tax_rate":"0.15"},
 "home":{"enabled":true,"target_price":"1300000","currency":"USD","purchase_date":"2030-10-01",
        "down_payment_pct":"0.20","closing_cost_pct":"0.03","prepaid_costs":"0","credits":"0",
        "mortgage_rate_annual":"0.0625","term_years":30,
        "property_tax_rate_annual":"0.011","insurance_annual":"2400","hoa_monthly":"0",
        "pmi_rate_annual":"0.006","maintenance_pct_annual":"0.01","utilities_monthly":"400",
        "emergency_reserve":"40000",
        "funding_sources":{"us_cash":true,"brokerage":true,"rsu_proceeds":true,"india_liquid":false}}
}
```
`home` may be `null`/`enabled:false`; `retirement_401k`, `epf` may be `null`. `utilities_monthly` is shown in all-in cost (spec §6.2). PMI applies only while down payment < 20%.

`HouseholdSnapshot` (captured server-side, also what the calc engine receives):
```json
{"as_of":"2026-10-01",
 "accounts":[{"id","name","kind","type","country","currency","amount","accessibility","goal_eligible","ownership_pct","details","verification_status","valuation_as_of"}],
 "rsu_grants":[{"id","symbol","award_currency","held_in_account_id","default_withholding_rate",
                "held_shares","vests":[{"vest_date","scheduled_shares","status"}]}],
 "prices":{"ACME":{"price","currency","as_of"}},
 "fx":{"USD/INR":{"rate","as_of","kind"}}}
```

- `POST /scenario-versions/{id}/runs` body `{"seed": null}` → 202 `SimulationRun` (`{id, scenario_version_id, status, seed, model_version, created_at, started_at, completed_at, error}`). Runs execute on a Postgres-backed queue worker; in tests/dev they may execute inline (`WP_INLINE_JOBS=1`). Re-running an identical version returns a result with an identical `checksum` (AC-005).
- `GET /runs/{id}` → `SimulationRun` (+ `checksum` when completed).
- `GET /runs/{id}/results` → `RunResult` (404 until completed; 409 `code=RUN_NOT_COMPLETE` while running).
- `POST /comparisons` body `{"run_ids":[...≤4]}` → `{"runs":[{run_id, scenario_id, scenario_name, version_number, metrics}], "series":{"net_worth":[{"year":2027,"values":{"<run_id>":"..."}}], "liquid_net_worth":[...], "retirement_balance":[...]}}` (FR-SCN-003).

`RunResult`:
```json
{"run_id":"uuid","status":"completed","model_version":"1.0.0","rulepack_version":"none-1",
 "currency":"USD","base_date":"2026-10-01","input_hash":"sha256:...","checksum":"sha256:...",
 "metrics":{"net_worth_now":"...","liquid_net_worth_now":"...","net_worth_at_retirement":"...",
   "retirement_balance_at_retirement":"...","ending_balance_at_life_expectancy":"...",
   "first_deficit_age":null,"years_in_deficit":0,
   "home_cash_needed":"...","home_cash_available_at_purchase":"...","home_funding_gap":"...",
   "home_earliest_feasible_date":"2031-04-01"|null,
   "home_pi_monthly":"...","home_all_in_monthly":"...",
   "rsu_net_proceeds_to_purchase":"..."},
 "yearly":[{"year":2027,"age":42,"net_worth":"...","liquid":"...","us_assets":"...","india_assets":"...",
   "retirement_balance":"...","income":"...","expenses":"...","savings":"...","rsu_net_proceeds":"...",
   "withdrawals":"...","deficit":"0","housing_cost":"...","usd_inr":"..."}],
 "home":{"purchase_date":"2030-10-01","price":"...","down_payment":"...","loan_principal":"...",
   "closing_costs":"...","prepaid_costs":"...","credits":"...","cash_to_close":"...","emergency_reserve":"...",
   "total_cash_needed":"...","pi_monthly":"...",
   "all_in_monthly":{"principal_interest":"...","property_tax":"...","insurance":"...","hoa":"...","pmi":"...","maintenance":"...","utilities":"...","total":"..."},
   "funding_timeline":[{"month":"2026-11-01","available":"...","required":"..."}],
   "stress":[{"label":"Rate +1pp","pi_monthly":"...","all_in_monthly":"...","funding_gap":"..."}]},
 "sensitivity":[{"variable":"returns.us_portfolio_annual","label":"US returns ±2pp","metric":"ending_balance_at_life_expectancy",
   "low_input":"0.04","high_input":"0.08","low_result":"...","base_result":"...","high_result":"..."}],
 "explanations":[{"metric":"home_pi_monthly","formula":"P × r × (1+r)^n / ((1+r)^n − 1)","inputs":{"P":"1040000","r":"0.0052083","n":"360"},"result":"..."}],
 "warnings":[Warning]}
```

## Exports (FR-EXP-*)

- `POST /exports` body `{"format":"csv"|"json"|"pdf","scope":"balances"|"assumptions"|"run","run_id"?}` → 202 `ExportJob` `{id, format, scope, run_id, status:"queued"|"completed"|"failed", download_url|null, expires_at|null, created_at}`.
  `scope=run` requires `run_id`; PDF is only for `scope=run`. Free tier PDFs are watermarked.
- `GET /exports/{id}` → `ExportJob`; `download_url` is a short-lived signed URL (15 min) `GET /exports/{id}/download?token=...` (token auth, no bearer needed).
- PDF reports include generated date, FX source/date, data freshness, disclaimers, scenario ID, version, run ID, model version, all assumptions, all warnings (FR-EXP-002, AC-006), and use exactly the stored run results (never recompute).

## Notifications (FR-NOT-*)

- `GET /notification-preferences` → `{"items":[{"type":"vest_reminder"|"stale_balance"|"goal_milestone","channel":"push","enabled":false}]}`; `PATCH /notification-preferences` body `{"items":[...]}`. All opt-in (default false).
- `POST /devices` body `{"expo_push_token","platform":"ios"|"android"}`; `DELETE /devices/{token}`.
- Push bodies never contain amounts (FR-NOT-002), e.g. "An RSU vest is scheduled in 7 days."
- `GET /notifications` → in-app inbox `{"items":[{id,type,title,body,created_at,read_at}]}`; `POST /notifications/{id}/read`.

## Subscription (S23)

- Entitlement on `/me`. `POST /billing/revenuecat/webhook` (shared-secret header) updates `Subscription` and entitlement. Plus/Pro limits: plus = unlimited accounts/goals, 10 scenarios; pro = unlimited.

## Health

- `GET /healthz` (no auth) → `{"status":"ok"}`; `GET /readyz` checks DB.
