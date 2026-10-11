import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { qk } from '@/lib/query';
import { useUiStore } from '@/lib/store';
import { comparison, goals, homeScenario, ids, me, netWorth, run, runResult } from '@/test/fixtures';
import { renderWithApi, type MockRoute } from '@/test/mockApi';
import { nav } from '@/test/setup';

import { AddAccountPage } from '../accounts/AddAccountPage';
import { OverviewPage } from '../overview/OverviewPage';
import { HomePlannerPage } from '../plan/HomePlannerPage';
import { ComparePage } from '../scenarios/ComparePage';

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('OverviewPage', () => {
  const routes: MockRoute[] = [
    { path: '/me', body: me },
    { path: '/net-worth', body: (c) => netWorth(c.query.currency === 'INR' ? 'INR' : 'USD') },
    { path: '/net-worth/history', body: { items: [] } },
    { path: '/goals', body: { items: goals } },
    { path: '/rsu/calendar', body: { items: [], warnings: [] } },
  ];

  it('renders net worth, country split, freshness and goals from the API', async () => {
    renderWithApi(<OverviewPage />, routes);
    const card = await screen.findByTestId('net-worth-card');
    expect(within(card).getByText('$20,000.00')).toBeInTheDocument();
    expect(screen.getByTestId('liquid-net-worth')).toBeInTheDocument();
    // Stale is conveyed in words (and an icon), not by colour alone.
    expect(screen.getByTestId('stale-count')).toHaveTextContent('1 stale');
    expect(within(screen.getByTestId('country-split')).getByText(/₹8,50,000\.00/)).toBeInTheDocument();
    expect(within(screen.getByTestId('data-freshness')).getByText('SBI FD')).toBeInTheDocument();
    const bar = await screen.findByRole('progressbar', { name: 'Bay Area home funded' });
    expect(bar).toHaveAttribute('aria-valuetext', expect.stringMatching(/^5% funded/));
  });

  it('switching currency re-queries net worth and never writes or mutates cached data', async () => {
    const { calls, client } = renderWithApi(<OverviewPage />, routes);
    await screen.findByTestId('net-worth-card');
    const usdBefore = structuredClone(client.getQueryData(qk.netWorth('USD')));
    const goalsBefore = structuredClone(client.getQueryData(qk.goals));

    fireEvent.click(screen.getByTestId('currency-toggle-INR'));
    await waitFor(() => expect(within(screen.getByTestId('net-worth-card')).getByText('₹17,00,000.00')).toBeInTheDocument());
    expect(calls.some((c) => c.path === '/net-worth' && c.query.currency === 'INR')).toBe(true);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(client.getQueryData(qk.netWorth('USD'))).toEqual(usdBefore);
    expect(client.getQueryData(qk.goals)).toEqual(goalsBefore);
    expect(useUiStore.getState().displayCurrency).toBe('INR');

    fireEvent.click(screen.getByTestId('currency-toggle-USD'));
    await waitFor(() => expect(within(screen.getByTestId('net-worth-card')).getByText('$20,000.00')).toBeInTheDocument());
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('shows an empty state when there are no accounts', async () => {
    renderWithApi(<OverviewPage />, [{ path: '/net-worth', body: { ...netWorth('USD'), items: [] } }, ...routes]);
    expect(await screen.findByText('Start with your accounts')).toBeInTheDocument();
  });
});

describe('AddAccountPage', () => {
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

  it('offers asset and liability templates', () => {
    renderWithApi(<AddAccountPage />, routes);
    expect(screen.getByTestId('template-fixed_deposit')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kind-liability'));
    expect(screen.getByTestId('template-mortgage')).toBeInTheDocument();
    expect(screen.queryByTestId('template-fixed_deposit')).not.toBeInTheDocument();
  });

  it('validates before calling the API', async () => {
    const { calls } = renderWithApi(<AddAccountPage />, routes);
    fireEvent.click(screen.getByTestId('template-fixed_deposit'));
    type('field-amount', '-100');
    fireEvent.click(screen.getByTestId('save-account'));
    expect(await screen.findByText(/no minus sign|never negative/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('submits a contract body with decimal strings, fractions and an Idempotency-Key', async () => {
    const { calls } = renderWithApi(<AddAccountPage />, routes);
    fireEvent.click(screen.getByTestId('template-fixed_deposit'));
    type('field-name', 'SBI FD');
    type('field-details.principal', '8,00,000');
    type('field-details.start_date', '2025-10-01');
    type('field-details.maturity_date', '2027-10-01');
    type('field-details.interest_rate_annual', '7.1');
    type('field-amount', '8,50,000.50');
    type('field-as_of', '2026-10-01');
    fireEvent.click(screen.getByTestId('choice-verification_status-verified'));
    fireEvent.click(screen.getByTestId('save-account'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.path).toBe('/accounts');
    expect(post?.headers['Idempotency-Key']).toBe('idem-key');
    expect(post?.body).toMatchObject({
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
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith(`/accounts/${ids.newAccount}`));
  });
});

describe('HomePlannerPage', () => {
  const routes: MockRoute[] = [
    { path: '/me', body: me },
    { path: '/scenarios', body: { items: [homeScenario] } },
    { path: `/scenarios/${ids.scenarioA}`, body: homeScenario },
    { path: `/scenarios/${ids.scenarioA}/versions`, body: { items: [homeScenario.active_version] } },
    { path: `/runs/${ids.runA}`, body: run(ids.runA, ids.versionA) },
    { path: `/runs/${ids.runA}/results`, body: runResult },
    { method: 'POST', path: `/scenario-versions/${ids.versionA}/runs`, status: 202, body: { ...run(ids.runB, ids.versionA), status: 'queued' } },
  ];

  it('shows inputs, P&I vs all-in, cash to close and stress tests with forecast labels', async () => {
    renderWithApi(<HomePlannerPage />, routes);
    expect(screen.getByTestId('no-approval-note')).toHaveTextContent(/not a mortgage pre-approval/);
    const inputs = await screen.findByTestId('home-inputs');
    expect(within(inputs).getByTestId('pi-preview')).toHaveTextContent('$6,067.85');
    expect(await screen.findByTestId('home-pi')).toHaveTextContent('$6,067.85');
    expect(screen.getByTestId('home-all-in')).toHaveTextContent('$9,117.85');
    expect(screen.getByTestId('cash-to-close')).toHaveTextContent('$269,000.00');
    const labels = screen.getAllByTestId('forecast-labels');
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(within(l).getByText(/As of Oct 10, 2026/)).toBeInTheDocument();
      expect(within(l).getByText('Scenario: Buy in 2028')).toBeInTheDocument();
      expect(within(l).getByText(/Assumptions: v2/)).toBeInTheDocument();
      expect(within(l).getByText('Illustrative')).toBeInTheDocument();
    }
    expect(screen.getAllByText('Rate +1pp').length).toBeGreaterThan(0);
    expect(screen.getByText(/RSU price is your own estimate/)).toBeInTheDocument();
    expect(screen.queryByText(/you are (pre-)?approved|you qualify|approved for/i)).not.toBeInTheDocument();
  });

  it('runs the active version via POST with an Idempotency-Key', async () => {
    const { calls } = renderWithApi(<HomePlannerPage />, routes);
    fireEvent.click(await screen.findByTestId('planner-run'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ seed: null });
    expect(post?.headers['Idempotency-Key']).toBe('idem-key');
  });
});

describe('ComparePage', () => {
  it('renders side-by-side metrics, labelled charts and data tables', async () => {
    nav.search = new URLSearchParams(`runs=${ids.runA},${ids.runB}`);
    const { calls } = renderWithApi(<ComparePage />, [
      { path: '/me', body: me },
      { path: '/scenarios', body: { items: [homeScenario] } },
      { method: 'POST', path: '/comparisons', body: comparison },
      { path: `/runs/${ids.runA}/results`, body: runResult },
      { path: `/runs/${ids.runB}/results`, body: { ...runResult, run_id: ids.runB } },
    ]);
    const table = await screen.findByTestId('compare-table');
    expect(within(table).getByText('Baseline v2')).toBeInTheDocument();
    expect(within(table).getByText('Conservative v1')).toBeInTheDocument();
    expect(within(table).getByText('$2,500,000.00')).toBeInTheDocument();
    expect(within(table).getByText('$1,900,000.00')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/comparisons')?.body).toEqual({ run_ids: [ids.runA, ids.runB] });
    expect(screen.getByTestId(`labels-${ids.runA}`)).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('compare-net-worth-toggle'));
    const nwTable = await screen.findByTestId('compare-net-worth-table');
    expect(within(nwTable).getByText('2027')).toBeInTheDocument();
    expect(within(nwTable).getByText('$70,000.00')).toBeInTheDocument();
  });

  it('explains how to pick scenarios when fewer than two runs are selected', async () => {
    renderWithApi(<ComparePage />, [{ path: '/me', body: me }, { path: '/scenarios', body: { items: [] } }]);
    expect(await screen.findByText(/Select two to four/)).toBeInTheDocument();
  });
});
