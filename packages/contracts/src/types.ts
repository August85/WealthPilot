/**
 * Resource and response shapes from docs/api-contract.md (v1).
 *
 * Conventions:
 * - `DecimalString` fields are money/quantities/rates serialized as strings. Never parse them into JS numbers for math.
 * - `IsoDate` is `YYYY-MM-DD` (no timezone); `IsoDateTime` is ISO 8601 UTC.
 * - Hand-written for now; will be regenerated from `/v1/openapi.json`.
 */
import type {
  Accessibility,
  AccountKind,
  AccountType,
  Country,
  CurrencyCode,
  DevicePlatform,
  DispositionKind,
  EpfAccessStatus,
  Entitlement,
  ExportFormat,
  ExportScope,
  ExportStatus,
  FdCompounding,
  FxRateKind,
  GoalType,
  MemberRole,
  NetWorthRefType,
  NotificationChannel,
  NotificationType,
  ReportingCurrency,
  ResidencyType,
  RetirementLocation,
  RsuGrantStatus,
  RsuStrategy,
  RunStatus,
  ScenarioKind,
  ScenarioPreset,
  Severity,
  ValuationSource,
  VerificationStatus,
  VestStatus,
  WarningCode,
  WithdrawalBucket,
} from './enums';

export type DecimalString = string;
export type IsoDate = string;
export type IsoDateTime = string;
export type Uuid = string;

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface ListResponse<T> {
  items: T[];
  /** Present on paged endpoints (`?limit=&cursor=`). */
  next_cursor?: string | null;
}

export interface PageParams {
  limit?: number;
  cursor?: string;
}

export interface Warning {
  code: WarningCode;
  severity: Severity;
  message: string;
  ref_type?: string;
  ref_id?: Uuid;
}

export interface ProblemFieldError {
  loc: (string | number)[];
  msg: string;
}

/** RFC 7807 problem document. */
export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  request_id?: string;
  errors?: ProblemFieldError[];
}

// ---------------------------------------------------------------------------
// Identity, onboarding, profile
// ---------------------------------------------------------------------------

export interface PlanLimits {
  /** null = unlimited */
  accounts: number | null;
  goals: number | null;
  scenarios: number | null;
}

export interface Me {
  id: Uuid;
  email: string;
  display_name: string | null;
  locale: string;
  timezone: string;
  reporting_currency: ReportingCurrency;
  home_country: Country | null;
  onboarding_completed: boolean;
  household_id: Uuid | null;
  entitlement: Entitlement;
  disclaimer_accepted_at: IsoDateTime | null;
  limits: PlanLimits;
}

export interface MeUpdate {
  display_name?: string;
  locale?: string;
  timezone?: string;
  reporting_currency?: ReportingCurrency;
  home_country?: Country;
}

export interface TaxResidencyPeriodInput {
  jurisdiction: Country;
  residency_type: ResidencyType;
  from_date: IsoDate;
  to_date: IsoDate | null;
  verified_by_user?: boolean;
}

export interface TaxResidencyPeriod extends TaxResidencyPeriodInput {
  id: Uuid;
  verified_by_user: boolean;
}

export interface OnboardingRequest {
  home_country: Country;
  reporting_currency: ReportingCurrency;
  household_name: string;
  disclaimer_accepted: true;
  tax_residency: TaxResidencyPeriodInput[];
}

export interface AuditEvent {
  id: Uuid;
  action: string;
  entity_type: string | null;
  entity_id: Uuid | null;
  created_at: IsoDateTime;
  metadata: Record<string, unknown>;
}

export interface DeleteRequest {
  confirm: 'DELETE';
}

export interface DeleteRequestResponse {
  status: 'scheduled';
  erase_after: IsoDate;
}

export interface HouseholdMember {
  user_id: Uuid;
  role: MemberRole;
  status: string;
}

export interface Household {
  id: Uuid;
  display_name: string;
  default_currency: ReportingCurrency;
  owner_user_id: Uuid;
  members: HouseholdMember[];
}

export interface HouseholdUpdate {
  display_name?: string;
  default_currency?: ReportingCurrency;
}

// ---------------------------------------------------------------------------
// Accounts and valuations
// ---------------------------------------------------------------------------

export interface Retirement401kDetails {
  pretax_balance?: DecimalString;
  roth_balance?: DecimalString;
  employee_contribution_annual?: DecimalString;
  employee_roth_pct?: DecimalString;
  employer_match_rate?: DecimalString;
  employer_match_up_to_pct_of_salary?: DecimalString;
  contribution_limit_annual?: DecimalString;
  access_age?: DecimalString;
  early_withdrawal_penalty_pct?: DecimalString;
}

export interface IraHsaDetails {
  annual_contribution?: DecimalString;
  access_age?: DecimalString;
}

export interface EpfDetails {
  employee_component?: DecimalString;
  employer_component?: DecimalString;
  monthly_employee_contribution?: DecimalString;
  monthly_employer_contribution?: DecimalString;
  interest_rate_annual?: DecimalString;
  access_status?: EpfAccessStatus;
  notes?: string;
}

export interface PpfDetails {
  annual_contribution?: DecimalString;
  interest_rate_annual?: DecimalString;
  maturity_date?: IsoDate;
}

export interface FixedDepositDetails {
  principal: DecimalString;
  start_date: IsoDate;
  maturity_date: IsoDate;
  interest_rate_annual: DecimalString;
  compounding: FdCompounding;
  tds_rate?: DecimalString;
}

export interface Holding {
  symbol: string;
  quantity: DecimalString;
  cost_basis?: DecimalString;
}

export interface InvestmentDetails {
  expected_return_annual?: DecimalString;
  holdings?: Holding[];
}

export interface RealEstateDetails {
  is_primary_residence?: boolean;
  rental_income_monthly?: DecimalString;
  appreciation_annual?: DecimalString;
}

export interface LiabilityDetails {
  interest_rate_annual?: DecimalString;
  monthly_payment?: DecimalString;
  term_months_remaining?: number;
}

export type AccountDetails =
  | Retirement401kDetails
  | IraHsaDetails
  | EpfDetails
  | PpfDetails
  | FixedDepositDetails
  | InvestmentDetails
  | RealEstateDetails
  | LiabilityDetails
  | Record<string, unknown>;

export interface Valuation {
  id: Uuid;
  account_id: Uuid;
  amount: DecimalString;
  currency: CurrencyCode;
  as_of: IsoDate;
  source: ValuationSource;
  verification_status: VerificationStatus;
  note: string | null;
  supersedes_id: Uuid | null;
  superseded_by: Uuid | null;
  created_at: IsoDateTime;
}

export interface Account {
  id: Uuid;
  household_id: Uuid;
  owner_id: Uuid;
  kind: AccountKind;
  type: AccountType;
  name: string;
  country: Country;
  currency: CurrencyCode;
  accessibility: Accessibility;
  accessibility_override_note: string | null;
  goal_eligible: boolean;
  include_in_net_worth: boolean;
  ownership_pct: DecimalString;
  details: AccountDetails;
  archived: boolean;
  version: number;
  latest_valuation: Valuation | null;
  stale: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface InitialValuationInput {
  amount: DecimalString;
  as_of: IsoDate;
  verification_status: VerificationStatus;
  note?: string;
}

export interface AccountCreate {
  kind: AccountKind;
  type: AccountType;
  name: string;
  country: Country;
  currency: CurrencyCode;
  accessibility?: Accessibility;
  accessibility_override_note?: string | null;
  goal_eligible?: boolean;
  include_in_net_worth?: boolean;
  ownership_pct?: DecimalString;
  details?: AccountDetails;
  initial_valuation?: InitialValuationInput;
}

export type AccountUpdate = Partial<Omit<AccountCreate, 'kind' | 'initial_valuation'>> & {
  archived?: boolean;
  version?: number;
};

export interface AccountListParams {
  kind?: AccountKind;
  country?: Country;
  include_archived?: boolean;
}

export interface ValuationCreate {
  amount: DecimalString;
  as_of: IsoDate;
  verification_status: VerificationStatus;
  source?: ValuationSource;
  note?: string;
  supersedes_id?: Uuid;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export interface FxRate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalString;
  as_of: IsoDate;
  provider: string;
  kind: FxRateKind;
  stale: boolean;
  license_reference: string | null;
}

export interface FxPairParams {
  base: CurrencyCode;
  quote: CurrencyCode;
}

export interface FxRateCreate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: DecimalString;
  as_of: IsoDate;
}

export interface PriceQuote {
  symbol: string;
  price: DecimalString;
  currency: CurrencyCode;
  as_of: IsoDate;
  provider: 'manual' | (string & {});
  stale: boolean;
}

export interface PriceCreate {
  symbol: string;
  price: DecimalString;
  currency: CurrencyCode;
  as_of: IsoDate;
}

// ---------------------------------------------------------------------------
// RSUs
// ---------------------------------------------------------------------------

export interface RsuDisposition {
  id: Uuid;
  vest_id: Uuid;
  date: IsoDate;
  kind: DispositionKind;
  shares: DecimalString;
  price: DecimalString;
  fees: DecimalString;
}

export interface RsuVest {
  id: Uuid;
  grant_id: Uuid;
  vest_date: IsoDate;
  scheduled_shares: DecimalString;
  status: VestStatus;
  vested_shares: DecimalString | null;
  vest_fmv: DecimalString | null;
  withheld_shares: DecimalString | null;
  source_event_id: string | null;
  dispositions: RsuDisposition[];
  /** Present on mutable vests for optimistic concurrency. */
  version?: number;
}

export interface RsuGrantTotals {
  scheduled: DecimalString;
  vested: DecimalString;
  withheld: DecimalString;
  sold: DecimalString;
  held: DecimalString;
  unvested: DecimalString;
}

export interface RsuGrant {
  id: Uuid;
  employer_name: string;
  symbol: string;
  grant_date: IsoDate;
  granted_shares: DecimalString;
  award_currency: CurrencyCode;
  grant_price: DecimalString | null;
  held_in_account_id: Uuid | null;
  default_withholding_rate: DecimalString;
  status: RsuGrantStatus;
  version: number;
  vests: RsuVest[];
  totals: RsuGrantTotals;
}

export interface VestScheduleInput {
  start_date: IsoDate;
  cliff_months: number;
  frequency_months: number;
  total_months: number;
}

export interface RsuGrantCreate {
  employer_name: string;
  symbol: string;
  grant_date: IsoDate;
  granted_shares: DecimalString;
  award_currency: CurrencyCode;
  grant_price?: DecimalString | null;
  held_in_account_id?: Uuid | null;
  default_withholding_rate?: DecimalString;
  schedule?: VestScheduleInput;
}

export type RsuGrantUpdate = Partial<Omit<RsuGrantCreate, 'schedule'>> & {
  status?: RsuGrantStatus;
  version?: number;
};

export interface RsuVestCreate {
  vest_date: IsoDate;
  scheduled_shares: DecimalString;
  source_event_id?: string;
}

export interface RsuVestUpdate {
  status: VestStatus;
  vested_shares: DecimalString | null;
  vest_fmv: DecimalString | null;
  withheld_shares: DecimalString | null;
  version?: number;
}

export interface RsuDispositionCreate {
  date: IsoDate;
  kind: DispositionKind;
  shares: DecimalString;
  price: DecimalString;
  fees?: DecimalString;
}

export interface VestCalendarItem {
  vest_id: Uuid;
  grant_id: Uuid;
  employer_name: string;
  symbol: string;
  vest_date: IsoDate;
  shares: DecimalString;
  status: VestStatus;
  estimated_gross_value: DecimalString | null;
  currency: CurrencyCode;
}

export interface VestCalendarResponse {
  items: VestCalendarItem[];
  warnings: Warning[];
}

export interface VestCalendarParams {
  from?: IsoDate;
  to?: IsoDate;
}

// ---------------------------------------------------------------------------
// Net worth and insights
// ---------------------------------------------------------------------------

export interface KeyAmount {
  key: string;
  amount: DecimalString;
}

export interface CurrencyBreakdown extends KeyAmount {
  native_amount: DecimalString;
}

export interface NetWorthItem {
  ref_type: NetWorthRefType;
  ref_id: Uuid;
  name: string;
  kind: AccountKind;
  type: string;
  country: Country;
  native_amount: DecimalString;
  native_currency: CurrencyCode;
  amount: DecimalString;
  ownership_pct: DecimalString;
  liquid: boolean;
  goal_eligible: boolean;
  as_of: IsoDate | null;
  verification_status: VerificationStatus;
  stale: boolean;
}

export interface NetWorth {
  currency: ReportingCurrency;
  as_of: IsoDate;
  gross_assets: DecimalString;
  liabilities: DecimalString;
  net_worth: DecimalString;
  liquid_net_worth: DecimalString;
  goal_eligible: DecimalString;
  unvested_equity_excluded: DecimalString;
  by_country: KeyAmount[];
  by_currency: CurrencyBreakdown[];
  by_class: KeyAmount[];
  fx: FxRate[];
  items: NetWorthItem[];
  warnings: Warning[];
}

export interface NetWorthParams {
  currency: ReportingCurrency;
  as_of?: IsoDate;
}

export interface NetWorthHistoryPoint {
  as_of: IsoDate;
  net_worth: DecimalString;
  liquid_net_worth: DecimalString;
}

export interface NetWorthHistoryParams {
  currency: ReportingCurrency;
  months?: number;
}

export interface InsightRef {
  ref_type: string;
  ref_id: Uuid;
}

export interface Insight {
  code: string;
  severity: Severity;
  title: string;
  body: string;
  value?: DecimalString | string | null;
  refs: InsightRef[];
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalProgress {
  funded_amount: DecimalString;
  pct: DecimalString;
  as_of: IsoDate;
  scenario_run_id: Uuid | null;
}

export interface Goal {
  id: Uuid;
  type: GoalType;
  name: string;
  target_date: IsoDate;
  target_amount: DecimalString;
  currency: CurrencyCode;
  priority: number;
  scenario_id: Uuid | null;
  details: Record<string, unknown>;
  version: number;
  created_at: IsoDateTime;
  /** Included on `GET /goals` items. */
  progress?: GoalProgress;
}

export interface GoalCreate {
  type: GoalType;
  name: string;
  target_date: IsoDate;
  target_amount: DecimalString;
  currency: CurrencyCode;
  priority: number;
  scenario_id?: Uuid | null;
  details?: Record<string, unknown>;
}

export type GoalUpdate = Partial<GoalCreate> & { version?: number };

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ScenarioAssumptions {
  base_date: IsoDate;
  reporting_currency: ReportingCurrency;
  horizon_years: number;
  household: {
    current_age: number;
    retirement_age: number;
    life_expectancy: number;
  };
  income: {
    salary_annual: DecimalString;
    bonus_annual: DecimalString;
    currency: CurrencyCode;
    salary_growth_annual: DecimalString;
    effective_tax_rate: DecimalString;
    living_expenses_monthly: DecimalString;
    expense_currency: CurrencyCode;
  };
  returns: {
    us_portfolio_annual: DecimalString;
    india_portfolio_annual: DecimalString;
    cash_annual: DecimalString;
    real_estate_annual: DecimalString;
  };
  inflation: {
    us_annual: DecimalString;
    india_annual: DecimalString;
  };
  fx: {
    usd_inr_start: DecimalString;
    inr_depreciation_annual: DecimalString;
    transfer_cost_pct: DecimalString;
  };
  rsu: {
    price_now: DecimalString;
    price_growth_annual: DecimalString;
    strategy: RsuStrategy;
    sell_fraction: DecimalString;
    withholding_rate: DecimalString;
    additional_tax_rate: DecimalString;
    annual_refresh_value: DecimalString;
  } | null;
  retirement_401k: {
    employee_contribution_annual: DecimalString;
    employer_match_rate: DecimalString;
    match_up_to_pct_of_salary: DecimalString;
    contribution_limit_annual: DecimalString;
    access_age: DecimalString;
  } | null;
  epf: {
    interest_rate_annual: DecimalString;
    monthly_contribution: DecimalString;
    accessible_from_age: number | null;
  } | null;
  retirement: {
    location: RetirementLocation;
    spending_monthly_today: DecimalString;
    healthcare_monthly_today: DecimalString;
    healthcare_inflation_annual: DecimalString;
    social_security_monthly_today: DecimalString;
    social_security_start_age: number | null;
    withdrawal_order: WithdrawalBucket[];
    withdrawal_tax_rate: DecimalString;
  };
  home: HomeAssumptions | null;
}

export interface HomeFundingSources {
  us_cash: boolean;
  brokerage: boolean;
  rsu_proceeds: boolean;
  india_liquid: boolean;
}

export interface HomeAssumptions {
  enabled: boolean;
  target_price: DecimalString;
  currency: CurrencyCode;
  purchase_date: IsoDate;
  down_payment_pct: DecimalString;
  closing_cost_pct: DecimalString;
  prepaid_costs: DecimalString;
  credits: DecimalString;
  mortgage_rate_annual: DecimalString;
  term_years: number;
  property_tax_rate_annual: DecimalString;
  insurance_annual: DecimalString;
  hoa_monthly: DecimalString;
  pmi_rate_annual: DecimalString;
  maintenance_pct_annual: DecimalString;
  utilities_monthly: DecimalString;
  emergency_reserve: DecimalString;
  funding_sources: HomeFundingSources;
}

export interface SnapshotAccount {
  id: Uuid;
  name: string;
  kind: AccountKind;
  type: AccountType;
  country: Country;
  currency: CurrencyCode;
  amount: DecimalString;
  accessibility: Accessibility;
  goal_eligible: boolean;
  ownership_pct: DecimalString;
  details: AccountDetails;
  verification_status: VerificationStatus;
  valuation_as_of: IsoDate | null;
}

export interface SnapshotRsuGrant {
  id: Uuid;
  symbol: string;
  award_currency: CurrencyCode;
  held_in_account_id: Uuid | null;
  default_withholding_rate: DecimalString;
  held_shares: DecimalString;
  vests: { vest_date: IsoDate; scheduled_shares: DecimalString; status: VestStatus }[];
}

export interface HouseholdSnapshot {
  as_of: IsoDate;
  accounts: SnapshotAccount[];
  rsu_grants: SnapshotRsuGrant[];
  prices: Record<string, { price: DecimalString; currency: CurrencyCode; as_of: IsoDate }>;
  fx: Record<string, { rate: DecimalString; as_of: IsoDate; kind: FxRateKind }>;
}

export interface ScenarioVersion {
  id: Uuid;
  scenario_id: Uuid;
  number: number;
  assumptions: ScenarioAssumptions;
  snapshot: HouseholdSnapshot;
  input_hash: string;
  model_version: string;
  rulepack_version: string;
  notes: string | null;
  created_at: IsoDateTime;
}

export interface SimulationRun {
  id: Uuid;
  scenario_version_id: Uuid;
  status: RunStatus;
  seed: number | null;
  model_version: string;
  created_at: IsoDateTime;
  started_at: IsoDateTime | null;
  completed_at: IsoDateTime | null;
  error: string | null;
  checksum?: string | null;
}

/** `latest_run` on a Scenario. The contract names it RunSummary; it carries the SimulationRun fields. */
export type RunSummary = SimulationRun;

export interface Scenario {
  id: Uuid;
  name: string;
  kind: ScenarioKind;
  preset: ScenarioPreset;
  goal_id: Uuid | null;
  parent_id: Uuid | null;
  archived: boolean;
  active_version: ScenarioVersion | null;
  latest_run: RunSummary | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  version: number;
}

export interface ScenarioCreate {
  name: string;
  kind: ScenarioKind;
  preset: ScenarioPreset;
  goal_id?: Uuid | null;
  assumptions?: ScenarioAssumptions;
}

export interface ScenarioUpdate {
  name?: string;
  archived?: boolean;
  goal_id?: Uuid | null;
  version?: number;
}

export interface ScenarioCloneRequest {
  name: string;
}

export interface ScenarioDefaultsParams {
  preset: ScenarioPreset;
  kind: ScenarioKind;
}

export interface ScenarioVersionCreate {
  assumptions: ScenarioAssumptions;
  notes?: string;
}

export interface RunCreate {
  seed: number | null;
}

export interface RunMetrics {
  net_worth_now: DecimalString;
  liquid_net_worth_now: DecimalString;
  net_worth_at_retirement: DecimalString;
  retirement_balance_at_retirement: DecimalString;
  ending_balance_at_life_expectancy: DecimalString;
  first_deficit_age: number | null;
  years_in_deficit: number;
  home_cash_needed: DecimalString | null;
  home_cash_available_at_purchase: DecimalString | null;
  home_funding_gap: DecimalString | null;
  home_earliest_feasible_date: IsoDate | null;
  home_pi_monthly: DecimalString | null;
  home_all_in_monthly: DecimalString | null;
  rsu_net_proceeds_to_purchase: DecimalString | null;
}

export interface YearlyRow {
  year: number;
  age: number;
  net_worth: DecimalString;
  liquid: DecimalString;
  us_assets: DecimalString;
  india_assets: DecimalString;
  retirement_balance: DecimalString;
  income: DecimalString;
  expenses: DecimalString;
  savings: DecimalString;
  rsu_net_proceeds: DecimalString;
  withdrawals: DecimalString;
  deficit: DecimalString;
  housing_cost: DecimalString;
  usd_inr: DecimalString;
}

export interface AllInMonthly {
  principal_interest: DecimalString;
  property_tax: DecimalString;
  insurance: DecimalString;
  hoa: DecimalString;
  pmi: DecimalString;
  maintenance: DecimalString;
  utilities: DecimalString;
  total: DecimalString;
}

export interface FundingTimelinePoint {
  month: IsoDate;
  available: DecimalString;
  required: DecimalString;
}

export interface HomeStressRow {
  label: string;
  pi_monthly: DecimalString;
  all_in_monthly: DecimalString;
  funding_gap: DecimalString;
}

export interface HomeResult {
  purchase_date: IsoDate;
  price: DecimalString;
  down_payment: DecimalString;
  loan_principal: DecimalString;
  closing_costs: DecimalString;
  prepaid_costs: DecimalString;
  credits: DecimalString;
  cash_to_close: DecimalString;
  emergency_reserve: DecimalString;
  total_cash_needed: DecimalString;
  pi_monthly: DecimalString;
  all_in_monthly: AllInMonthly;
  funding_timeline: FundingTimelinePoint[];
  stress: HomeStressRow[];
}

export interface SensitivityRow {
  variable: string;
  label: string;
  metric: string;
  low_input: DecimalString;
  high_input: DecimalString;
  low_result: DecimalString;
  base_result: DecimalString;
  high_result: DecimalString;
}

export interface Explanation {
  metric: string;
  formula: string;
  inputs: Record<string, DecimalString | string>;
  result: DecimalString | string;
}

export interface RunResult {
  run_id: Uuid;
  status: RunStatus;
  model_version: string;
  rulepack_version: string;
  currency: ReportingCurrency;
  base_date: IsoDate;
  input_hash: string;
  checksum: string;
  metrics: RunMetrics;
  yearly: YearlyRow[];
  home: HomeResult | null;
  sensitivity: SensitivityRow[];
  explanations: Explanation[];
  warnings: Warning[];
}

export interface ComparisonRequest {
  run_ids: Uuid[];
}

export interface ComparisonRun {
  run_id: Uuid;
  scenario_id: Uuid;
  scenario_name: string;
  version_number: number;
  metrics: RunMetrics;
}

export interface ComparisonSeriesPoint {
  year: number;
  values: Record<Uuid, DecimalString>;
}

export interface Comparison {
  runs: ComparisonRun[];
  series: {
    net_worth: ComparisonSeriesPoint[];
    liquid_net_worth: ComparisonSeriesPoint[];
    retirement_balance: ComparisonSeriesPoint[];
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export interface ExportCreate {
  format: ExportFormat;
  scope: ExportScope;
  run_id?: Uuid;
}

export interface ExportJob {
  id: Uuid;
  format: ExportFormat;
  scope: ExportScope;
  run_id: Uuid | null;
  status: ExportStatus;
  download_url: string | null;
  expires_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationPreference {
  type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationPreferencesUpdate {
  items: NotificationPreference[];
}

export interface DeviceRegistration {
  expo_push_token: string;
  platform: DevicePlatform;
}

export interface InboxNotification {
  id: Uuid;
  type: NotificationType | (string & {});
  title: string;
  body: string;
  created_at: IsoDateTime;
  read_at: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthStatus {
  status: 'ok' | (string & {});
}
