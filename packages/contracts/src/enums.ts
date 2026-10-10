/**
 * Enums from docs/api-contract.md ("Enums" table and inline unions).
 * Each enum is a readonly tuple (usable at runtime, e.g. in pickers and Zod) plus a string-literal union type.
 */

export const COUNTRIES = ['US', 'IN', 'OTHER'] as const;
export type Country = (typeof COUNTRIES)[number];

export const CURRENCIES = ['USD', 'INR'] as const;
/** ISO 4217 code. The app plans in USD and INR; other codes may appear from the API. */
export type CurrencyCode = (typeof CURRENCIES)[number] | (string & {});
export type ReportingCurrency = (typeof CURRENCIES)[number];

export const ACCOUNT_KINDS = ['asset', 'liability'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ASSET_TYPES = [
  'cash',
  'checking',
  'savings',
  'brokerage',
  'retirement_401k',
  'ira_traditional',
  'ira_roth',
  'hsa',
  'epf',
  'ppf',
  'fixed_deposit',
  'mutual_fund',
  'real_estate',
  'custom_asset',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const LIABILITY_TYPES = [
  'mortgage',
  'home_loan_india',
  'auto_loan',
  'student_loan',
  'personal_loan',
  'credit_card',
  'other_liability',
] as const;
export type LiabilityType = (typeof LIABILITY_TYPES)[number];

export type AccountType = AssetType | LiabilityType;

export const ACCESSIBILITIES = ['liquid', 'restricted', 'illiquid'] as const;
export type Accessibility = (typeof ACCESSIBILITIES)[number];

export const VERIFICATION_STATUSES = ['estimated', 'verified'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VALUATION_SOURCES = ['manual', 'import', 'computed'] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];

export const EPF_ACCESS_STATUSES = ['unknown', 'restricted', 'user_verified_accessible'] as const;
export type EpfAccessStatus = (typeof EPF_ACCESS_STATUSES)[number];

export const FD_COMPOUNDINGS = ['monthly', 'quarterly', 'half_yearly', 'annually', 'at_maturity'] as const;
export type FdCompounding = (typeof FD_COMPOUNDINGS)[number];

export const VEST_STATUSES = ['scheduled', 'vested', 'cancelled'] as const;
export type VestStatus = (typeof VEST_STATUSES)[number];

export const DISPOSITION_KINDS = ['sell_to_cover', 'sale'] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

export const RSU_STRATEGIES = ['hold', 'sell_on_vest', 'sell_fraction'] as const;
export type RsuStrategy = (typeof RSU_STRATEGIES)[number];

export const GOAL_TYPES = ['home_purchase', 'retirement', 'education', 'emergency_fund', 'custom'] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const SCENARIO_PRESETS = ['baseline', 'conservative', 'optimistic', 'custom'] as const;
export type ScenarioPreset = (typeof SCENARIO_PRESETS)[number];

export const SCENARIO_KINDS = ['home', 'retirement', 'general'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ENTITLEMENTS = ['free', 'plus', 'pro'] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

export const RESIDENCY_TYPES = ['resident', 'non_resident', 'rnor', 'nri', 'other'] as const;
export type ResidencyType = (typeof RESIDENCY_TYPES)[number];

export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const FX_RATE_KINDS = ['user', 'reference'] as const;
export type FxRateKind = (typeof FX_RATE_KINDS)[number];

export const EXPORT_FORMATS = ['csv', 'json', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_SCOPES = ['balances', 'assumptions', 'run'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_STATUSES = ['queued', 'completed', 'failed'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const NOTIFICATION_TYPES = ['vest_reminder', 'stale_balance', 'goal_milestone'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** The contract only shows "active"; other server values are tolerated. */
export type RsuGrantStatus = 'active' | (string & {});

export const WITHDRAWAL_BUCKETS = ['taxable', 'india', 'tax_deferred', 'roth'] as const;
export type WithdrawalBucket = (typeof WITHDRAWAL_BUCKETS)[number];

export const RETIREMENT_LOCATIONS = ['US', 'IN'] as const;
export type RetirementLocation = (typeof RETIREMENT_LOCATIONS)[number];

export const REF_TYPES = ['account', 'rsu_grant'] as const;
export type NetWorthRefType = (typeof REF_TYPES)[number];

/** Warning codes used across the API. Unknown codes are tolerated (`string & {}`). */
export const WARNING_CODES = [
  'FX_RATE_MISSING',
  'FX_RATE_STALE',
  'STALE_BALANCE',
  'UNVERIFIED_BALANCE',
  'UNVESTED_EQUITY_EXCLUDED',
  'RSU_HELD_IN_BROKERAGE',
  'MISSING_PRICE',
  'EPF_ACCESS_UNVERIFIED',
  'RETIREMENT_ACCESS_ASSUMED',
  'CONCENTRATION_EMPLOYER_STOCK',
  'HOME_FUNDING_GAP',
  'RETIREMENT_DEFICIT',
  'UNDER_WITHHOLDING',
  'NEGATIVE_BALANCE',
  'ILLUSTRATIVE_TAX',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number] | (string & {});

/** Problem `code` values the clients branch on. */
export const ERROR_CODES = [
  'VERSION_CONFLICT',
  'PLAN_LIMIT',
  'NEGATIVE_AMOUNT',
  'FX_RATE_MISSING',
  'FX_FEED_UNAVAILABLE',
  'DUPLICATE_VEST',
  'SHARE_CONSERVATION',
  'RUN_NOT_COMPLETE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

/** Default accessibility by asset type (contract "Default accessibility by type"). */
export const DEFAULT_ACCESSIBILITY: Record<AssetType, Accessibility> = {
  cash: 'liquid',
  checking: 'liquid',
  savings: 'liquid',
  brokerage: 'liquid',
  mutual_fund: 'liquid',
  retirement_401k: 'restricted',
  ira_traditional: 'restricted',
  ira_roth: 'restricted',
  hsa: 'restricted',
  epf: 'restricted',
  ppf: 'restricted',
  fixed_deposit: 'restricted',
  real_estate: 'illiquid',
  custom_asset: 'illiquid',
};

export function isAssetType(t: string): t is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(t);
}

export function isLiabilityType(t: string): t is LiabilityType {
  return (LIABILITY_TYPES as readonly string[]).includes(t);
}
