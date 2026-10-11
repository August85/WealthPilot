import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { qk } from '@/lib/query';
import { useUiStore } from '@/store/ui';
import { goals, me, netWorth } from '@/test/fixtures';
import { renderWithApi, type MockRoute } from '@/test/mockApi';

import OverviewScreen from '../overview/OverviewScreen';

const routes: MockRoute[] = [
  { path: '/me', body: me },
  { path: '/net-worth', body: (c) => netWorth(c.query.currency === 'INR' ? 'INR' : 'USD') },
  { path: '/net-worth/history', body: { items: [] } },
  { path: '/goals', body: { items: goals } },
  { path: '/rsu/calendar', body: { items: [], warnings: [] } },
];

beforeEach(() => {
  useUiStore.getState().reset();
});

describe('OverviewScreen', () => {
  it('renders net worth, liquid, country split and freshness from the API', async () => {
    await renderWithApi(<OverviewScreen />, routes);
    const card = await screen.findByTestId('net-worth-card');
    expect(within(card).getByText('$20,000.00')).toBeTruthy();
    expect(screen.getByTestId('liquid-net-worth')).toBeTruthy();
    expect(screen.getByTestId('stale-count')).toHaveTextContent('⏱ 1 stale');
    // Native INR holdings are shown in INR with Indian grouping regardless of reporting currency.
    expect(within(screen.getByTestId('country-split')).getByText(/₹8,50,000\.00/)).toBeTruthy();
    // Stale/estimated FD is listed under data freshness with its provenance.
    expect(within(screen.getByTestId('data-freshness')).getByText('SBI FD')).toBeTruthy();
    // Goal progress pct is a percentage on the wire (5.00) and reads as 5%.
    expect(await screen.findByLabelText(/Bay Area home: 5% funded/)).toBeTruthy();
  });

  it('switching currency re-queries net worth and never writes or mutates cached data', async () => {
    const { calls, client } = await renderWithApi(<OverviewScreen />, routes);
    await screen.findByTestId('net-worth-card');
    const usdBefore = structuredClone(client.getQueryData(qk.netWorth('USD')));
    const goalsBefore = structuredClone(client.getQueryData(qk.goals));

    await fireEvent.press(screen.getByTestId('currency-toggle-INR'));

    await waitFor(() => expect(within(screen.getByTestId('net-worth-card')).getByText('₹17,00,000.00')).toBeTruthy());
    expect(calls.some((c) => c.path === '/net-worth' && c.query.currency === 'INR')).toBe(true);
    // Read-only: no POST/PATCH/PUT/DELETE was issued.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    // Cached data for the other currency and unrelated queries is untouched.
    expect(client.getQueryData(qk.netWorth('USD'))).toEqual(usdBefore);
    expect(client.getQueryData(qk.goals)).toEqual(goalsBefore);
    // Only ephemeral UI state changed.
    expect(useUiStore.getState().displayCurrency).toBe('INR');

    await fireEvent.press(screen.getByTestId('currency-toggle-USD'));
    await waitFor(() => expect(within(screen.getByTestId('net-worth-card')).getByText('$20,000.00')).toBeTruthy());
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('shows an empty state when there are no accounts', async () => {
    const empty = { ...netWorth('USD'), items: [] };
    await renderWithApi(<OverviewScreen />, [{ path: '/net-worth', body: empty }, ...routes]);
    expect(await screen.findByText('Start with your accounts')).toBeTruthy();
  });
});
