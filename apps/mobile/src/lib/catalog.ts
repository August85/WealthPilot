/** Human labels and guided templates for contract enums. */
import {
  DEFAULT_ACCESSIBILITY,
  isAssetType,
  type Accessibility,
  type AccountKind,
  type AccountType,
  type Country,
  type GoalType,
  type ResidencyType,
} from '@wealthpilot/contracts';

import type { IconName } from '../components/primitives';

export const COUNTRY_LABELS: Record<Country, string> = { US: 'United States', IN: 'India', OTHER: 'Other' };

export const ACCESSIBILITY_LABELS: Record<Accessibility, string> = {
  liquid: 'Liquid',
  restricted: 'Restricted',
  illiquid: 'Illiquid',
};

export const ACCESSIBILITY_HELP: Record<Accessibility, string> = {
  liquid: 'Can be spent or sold soon without penalties.',
  restricted: 'Access limited by age, lock-in or penalties (e.g. retirement accounts, EPF, FDs).',
  illiquid: 'Hard to convert to cash (e.g. property).',
};

export const RESIDENCY_LABELS: Record<ResidencyType, string> = {
  resident: 'Resident',
  non_resident: 'Non-resident',
  rnor: 'RNOR (resident but not ordinarily resident)',
  nri: 'NRI',
  other: 'Other',
};

export const GOAL_LABELS: Record<GoalType, string> = {
  home_purchase: 'Home purchase',
  retirement: 'Retirement',
  education: 'Education',
  emergency_fund: 'Emergency fund',
  custom: 'Custom',
};

export const GOAL_ICONS: Record<GoalType, IconName> = {
  home_purchase: 'home-outline',
  retirement: 'sunny-outline',
  education: 'school-outline',
  emergency_fund: 'medkit-outline',
  custom: 'flag-outline',
};

export interface AccountTemplate {
  type: AccountType;
  kind: AccountKind;
  label: string;
  description: string;
  icon: IconName;
  country: Country;
  currency: 'USD' | 'INR';
  /** Shown in S05 as guidance. */
  tip?: string;
}

export const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  { type: 'checking', kind: 'asset', label: 'Checking', description: 'US bank checking account', icon: 'card-outline', country: 'US', currency: 'USD' },
  { type: 'savings', kind: 'asset', label: 'Savings', description: 'Savings account (US or India)', icon: 'wallet-outline', country: 'US', currency: 'USD' },
  { type: 'cash', kind: 'asset', label: 'Cash', description: 'Cash or money market', icon: 'cash-outline', country: 'US', currency: 'USD' },
  { type: 'brokerage', kind: 'asset', label: 'Brokerage', description: 'Taxable investment account', icon: 'trending-up-outline', country: 'US', currency: 'USD', tip: 'If your vested RSU shares sit here, link the grant to this account to avoid double counting.' },
  { type: 'retirement_401k', kind: 'asset', label: '401(k)', description: 'Employer retirement plan — pre-tax and Roth kept separate', icon: 'briefcase-outline', country: 'US', currency: 'USD', tip: 'Contribution limits are your own inputs; WealthPilot does not hard-code IRS limits.' },
  { type: 'ira_traditional', kind: 'asset', label: 'Traditional IRA', description: 'Individual retirement account', icon: 'umbrella-outline', country: 'US', currency: 'USD' },
  { type: 'ira_roth', kind: 'asset', label: 'Roth IRA', description: 'Roth individual retirement account', icon: 'umbrella-outline', country: 'US', currency: 'USD' },
  { type: 'hsa', kind: 'asset', label: 'HSA', description: 'Health savings account', icon: 'medkit-outline', country: 'US', currency: 'USD' },
  { type: 'epf', kind: 'asset', label: 'EPF', description: 'Employees’ Provident Fund (India)', icon: 'business-outline', country: 'IN', currency: 'INR', tip: 'Withdrawal eligibility and taxability depend on your situation. Verify with a professional.' },
  { type: 'ppf', kind: 'asset', label: 'PPF', description: 'Public Provident Fund (India)', icon: 'leaf-outline', country: 'IN', currency: 'INR' },
  { type: 'fixed_deposit', kind: 'asset', label: 'Fixed deposit', description: 'Bank FD with maturity date and rate', icon: 'lock-closed-outline', country: 'IN', currency: 'INR', tip: 'Interest, compounding and TDS are your inputs, not assumed.' },
  { type: 'mutual_fund', kind: 'asset', label: 'Mutual fund', description: 'Mutual fund folio (India or US)', icon: 'pie-chart-outline', country: 'IN', currency: 'INR' },
  { type: 'real_estate', kind: 'asset', label: 'Real estate', description: 'Property you own', icon: 'home-outline', country: 'IN', currency: 'INR' },
  { type: 'custom_asset', kind: 'asset', label: 'Other asset', description: 'Anything else of value', icon: 'cube-outline', country: 'US', currency: 'USD' },
  { type: 'mortgage', kind: 'liability', label: 'Mortgage', description: 'US home loan', icon: 'home-outline', country: 'US', currency: 'USD' },
  { type: 'home_loan_india', kind: 'liability', label: 'Home loan (India)', description: 'Indian housing loan', icon: 'home-outline', country: 'IN', currency: 'INR' },
  { type: 'auto_loan', kind: 'liability', label: 'Auto loan', description: 'Car or vehicle loan', icon: 'car-outline', country: 'US', currency: 'USD' },
  { type: 'student_loan', kind: 'liability', label: 'Student loan', description: 'Education loan', icon: 'school-outline', country: 'US', currency: 'USD' },
  { type: 'personal_loan', kind: 'liability', label: 'Personal loan', description: 'Unsecured loan', icon: 'document-text-outline', country: 'US', currency: 'USD' },
  { type: 'credit_card', kind: 'liability', label: 'Credit card', description: 'Balance owed', icon: 'card-outline', country: 'US', currency: 'USD' },
  { type: 'other_liability', kind: 'liability', label: 'Other debt', description: 'Any other amount owed', icon: 'remove-circle-outline', country: 'US', currency: 'USD' },
];

export function templateFor(type: string): AccountTemplate | undefined {
  return ACCOUNT_TEMPLATES.find((t) => t.type === type);
}

export function typeLabel(type: string): string {
  if (type === 'rsu' || type === 'rsu_grant') return 'RSUs';
  return templateFor(type)?.label ?? type.replace(/_/g, ' ');
}

export function defaultAccessibility(type: AccountType): Accessibility {
  return isAssetType(type) ? DEFAULT_ACCESSIBILITY[type] : 'illiquid';
}

export function countryLabel(c: string): string {
  return COUNTRY_LABELS[c as Country] ?? c;
}
