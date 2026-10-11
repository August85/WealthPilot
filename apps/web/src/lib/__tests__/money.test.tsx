import { render, screen } from '@testing-library/react';
import { formatMoney, formatMoneyCompact, parseMoneyInput } from '@wealthpilot/shared';
import { describe, expect, it } from 'vitest';

import { Money } from '@/components/finance/Money';
import { useUiStore } from '@/lib/store';

describe('money formatting (web)', () => {
  it('uses western grouping for USD and Indian grouping for INR', () => {
    expect(formatMoney('1234567.89', 'USD')).toBe('$1,234,567.89');
    expect(formatMoney('1234567.89', 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney('10000000', 'INR')).toBe('₹1,00,00,000.00');
    expect(formatMoney('-5', 'USD')).toBe('-$5.00');
    expect(formatMoney(null, 'USD')).toBe('—');
  });

  it('parses typed amounts in either grouping into decimal strings', () => {
    expect(parseMoneyInput('8,50,000.50')).toBe('850000.5');
    expect(parseMoneyInput('$1,234')).toBe('1234');
    expect(parseMoneyInput('12abc')).toBeNull();
  });

  it('renders exact amounts by default with a spoken label for screen readers', () => {
    render(<Money value="1234567.89" currency="INR" testId="m" qualifier="estimated" />);
    expect(screen.getByTestId('m')).toHaveTextContent('₹12,34,567.89');
    expect(screen.getByTestId('m')).toHaveTextContent('estimated');
  });

  it('marks short forms as approximate and keeps the exact figure visible', () => {
    useUiStore.setState({ compactAmounts: true });
    render(<Money value="1234567.89" currency="INR" testId="m" />);
    const el = screen.getByTestId('m');
    expect(el).toHaveTextContent('≈ ₹12.35 L');
    expect(el).toHaveTextContent('₹12,34,567.89 · approximate');
    expect(formatMoneyCompact('1234567.89', 'USD')?.text).toBe('$1.23M');
  });
});
