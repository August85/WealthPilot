/** Moved to `@wealthpilot/shared` (money.ts) so the web app uses identical logic. */
export {
  groupDigits,
  groupingFor,
  currencySymbol,
  formatNumber,
  formatMoney,
  formatMoneyCompact,
  moneyAccessibilityLabel,
  parseMoneyInput,
} from '@wealthpilot/shared';
export type {
  SupportedCurrency,
  FormatMoneyOptions,
  CompactMoney,
} from '@wealthpilot/shared';
