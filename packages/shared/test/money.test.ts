import { describe, expect, it } from 'vitest';

import { mortgagePayment, percentToFraction, fractionToPercent, sumDec } from '../src/decimal';
import {
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  groupDigits,
  moneyAccessibilityLabel,
  parseMoneyInput,
} from '../src/money';

describe('formatMoney', () => {
  it('formats USD with western grouping', () => {
    expect(formatMoney('1234567.89', 'USD')).toBe('$1,234,567.89');
    expect(formatMoney('0', 'USD')).toBe('$0.00');
    expect(formatMoney('999', 'USD')).toBe('$999.00');
    expect(formatMoney('1000', 'USD')).toBe('$1,000.00');
  });

  it('formats INR with Indian grouping', () => {
    expect(formatMoney('1234567.89', 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney('100000', 'INR')).toBe('₹1,00,000.00');
    expect(formatMoney('10000000', 'INR')).toBe('₹1,00,00,000.00');
    expect(formatMoney('999', 'INR')).toBe('₹999.00');
    expect(formatMoney('1000', 'INR')).toBe('₹1,000.00');
  });

  it('handles negatives, signs and rounding without floats', () => {
    expect(formatMoney('-5', 'USD')).toBe('-$5.00');
    expect(formatMoney('-1234567.891', 'INR')).toBe('-₹12,34,567.89');
    expect(formatMoney('10', 'USD', { signed: true })).toBe('+$10.00');
    expect(formatMoney('-0.001', 'USD')).toBe('$0.00');
    // 0.1 + 0.2 style float issues must not appear; huge values stay exact.
    expect(formatMoney('0.305', 'USD')).toBe('$0.31');
    expect(formatMoney('123456789012345678.99', 'USD')).toBe('$123,456,789,012,345,678.99');
  });

  it('never fabricates a value for missing input', () => {
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'INR')).toBe('—');
    expect(formatMoney('abc', 'USD')).toBe('—');
  });
});

describe('groupDigits / formatNumber', () => {
  it('groups digits', () => {
    expect(groupDigits('1234567', 'western')).toBe('1,234,567');
    expect(groupDigits('1234567', 'indian')).toBe('12,34,567');
    expect(groupDigits('123', 'indian')).toBe('123');
    expect(formatNumber('1234.5', { decimals: 1 })).toBe('1,234.5');
  });
});

describe('formatMoneyCompact (approximate short forms)', () => {
  it('uses lakh and crore for INR, always flagged approximate', () => {
    const lakh = formatMoneyCompact('1234567.89', 'INR')!;
    expect(lakh.text).toBe('₹12.35 L');
    expect(lakh.approximate).toBe(true);
    expect(lakh.spoken).toBe('approximately 12.35 lakh Indian rupees');

    const crore = formatMoneyCompact('12345678', 'INR')!;
    expect(crore.text).toBe('₹1.23 Cr');
    expect(crore.spoken).toContain('crore');

    expect(formatMoneyCompact('100000', 'INR')!.text).toBe('₹1 L');
    expect(formatMoneyCompact('-2500000', 'INR')!.text).toBe('-₹25 L');
  });

  it('uses K/M/B for USD', () => {
    expect(formatMoneyCompact('1234567.89', 'USD')!.text).toBe('$1.23M');
    expect(formatMoneyCompact('45000', 'USD')!.text).toBe('$45K');
    expect(formatMoneyCompact('2500000000', 'USD')!.text).toBe('$2.5B');
    expect(formatMoneyCompact('999.6', 'USD')!.text).toBe('$1,000');
  });

  it('returns null for missing values', () => {
    expect(formatMoneyCompact(null, 'USD')).toBeNull();
  });
});

describe('accessibility labels and input parsing', () => {
  it('reads amounts with the currency name', () => {
    expect(moneyAccessibilityLabel('1234567.89', 'USD')).toBe('1,234,567.89 US dollars');
    expect(moneyAccessibilityLabel('-5', 'INR')).toBe('minus 5.00 Indian rupees');
    expect(moneyAccessibilityLabel('1', 'USD')).toBe('1.00 US dollar');
    expect(moneyAccessibilityLabel(null, 'USD')).toBe('Not available');
  });

  it('parses user input into decimal strings', () => {
    expect(parseMoneyInput('1,23,456.70')).toBe('123456.7');
    expect(parseMoneyInput('$1,234')).toBe('1234');
    expect(parseMoneyInput('₹ 5')).toBe('5');
    expect(parseMoneyInput('12abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
  });
});

describe('decimal helpers', () => {
  it('sums exactly', () => {
    expect(sumDec(['0.1', '0.2']).toFixed()).toBe('0.3');
  });

  it('converts percent <-> fraction as strings', () => {
    expect(percentToFraction('6.5')).toBe('0.065');
    expect(fractionToPercent('0.065')).toBe('6.5');
  });

  it('computes a standard amortizing payment', () => {
    // $960,000 at 6.5% for 30 years ≈ $6,067.85/month
    expect(mortgagePayment('960000', '0.065', 30).toFixed(2)).toBe('6067.85');
    expect(mortgagePayment('120000', '0', 10).toFixed(2)).toBe('1000.00');
  });
});
