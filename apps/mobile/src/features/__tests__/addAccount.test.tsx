import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ids, me } from '@/test/fixtures';
import { renderWithApi, type MockRoute } from '@/test/mockApi';

import AddAccountScreen from '../accounts/AddAccountScreen';

const created = (body: Record<string, unknown>) => ({
  id: ids.newAccount,
  household_id: ids.household,
  owner_id: ids.user,
  accessibility: 'restricted',
  accessibility_override_note: null,
  goal_eligible: false,
  include_in_net_worth: true,
  ownership_pct: '100',
  details: {},
  archived: false,
  version: 1,
  latest_valuation: null,
  stale: false,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  ...body,
});

const routes: MockRoute[] = [
  { path: '/me', body: me },
  { method: 'POST', path: '/accounts', status: 201, body: (c) => created(c.body as Record<string, unknown>) },
];

describe('AddAccountScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers guided templates and shows type-specific fields', async () => {
    await renderWithApi(<AddAccountScreen />, routes);
    expect(screen.getByTestId('template-fixed_deposit')).toBeTruthy();
    expect(screen.getByTestId('template-retirement_401k')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kind-liability'));
    expect(screen.getByTestId('template-mortgage')).toBeTruthy();
    expect(screen.queryByTestId('template-fixed_deposit')).toBeNull();
  });

  it('validates before calling the API', async () => {
    const { calls } = await renderWithApi(<AddAccountScreen />, routes);
    await fireEvent.press(screen.getByTestId('template-fixed_deposit'));
    await fireEvent.changeText(screen.getByTestId('field-amount'), '-100');
    await fireEvent.press(screen.getByTestId('save-account'));
    expect(await screen.findByText(/no minus sign|never negative/)).toBeTruthy();
    expect(screen.getAllByText(/is required/).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('submits a contract body with decimal strings, fractions and an Idempotency-Key', async () => {
    const { calls } = await renderWithApi(<AddAccountScreen />, routes);
    await fireEvent.press(screen.getByTestId('template-fixed_deposit'));
    await fireEvent.changeText(screen.getByTestId('field-name'), 'SBI FD');
    await fireEvent.changeText(screen.getByTestId('field-details.principal'), '8,00,000');
    await fireEvent.changeText(screen.getByTestId('field-details.start_date'), '2025-10-01');
    await fireEvent.changeText(screen.getByTestId('field-details.maturity_date'), '2027-10-01');
    await fireEvent.changeText(screen.getByTestId('field-details.interest_rate_annual'), '7.1');
    await fireEvent.changeText(screen.getByTestId('field-amount'), '8,50,000.50');
    await fireEvent.changeText(screen.getByTestId('field-as_of'), '2026-10-01');
    await fireEvent.press(screen.getByTestId('choice-verification_status-verified'));
    await fireEvent.press(screen.getByTestId('save-account'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/accounts');
    expect(post.headers['Idempotency-Key']).toBe('idem-key');
    expect(post.body).toMatchObject({
      kind: 'asset',
      type: 'fixed_deposit',
      name: 'SBI FD',
      country: 'IN',
      currency: 'INR',
      ownership_pct: '100',
      accessibility: 'restricted',
      goal_eligible: false,
      details: {
        principal: '800000',
        start_date: '2025-10-01',
        maturity_date: '2027-10-01',
        interest_rate_annual: '0.071',
        compounding: 'quarterly',
      },
      initial_valuation: { amount: '850000.5', as_of: '2026-10-01', verification_status: 'verified' },
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/accounts/${ids.newAccount}`));
  });
});
