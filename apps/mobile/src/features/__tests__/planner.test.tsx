import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { comparison, homeScenario, ids, me, run, runResult } from '@/test/fixtures';
import { renderWithApi, type MockRoute } from '@/test/mockApi';

import HomePlannerScreen from '../plan/HomePlannerScreen';
import CompareScreen from '../scenarios/CompareScreen';

const plannerRoutes: MockRoute[] = [
  { path: '/me', body: me },
  { path: '/scenarios', body: { items: [homeScenario] } },
  { path: `/scenarios/${ids.scenarioA}`, body: homeScenario },
  { path: `/scenarios/${ids.scenarioA}/versions`, body: { items: [homeScenario.active_version] } },
  { path: `/runs/${ids.runA}`, body: run(ids.runA, ids.versionA) },
  { path: `/runs/${ids.runA}/results`, body: runResult },
  { method: 'POST', path: `/scenario-versions/${ids.versionA}/runs`, status: 202, body: { ...run(ids.runB, ids.versionA), status: 'queued' } },
];

function expectForecastLabels(card: ReturnType<typeof screen.getByTestId>) {
  const labels = within(card).getByTestId('forecast-labels');
  expect(within(labels).getByText(/^As of Oct 10, 2026/)).toBeTruthy();
  expect(within(labels).getByText('Scenario: Buy in 2028')).toBeTruthy();
  expect(within(labels).getByText(/^Assumptions: v2/)).toBeTruthy();
  expect(within(labels).getByText('Illustrative')).toBeTruthy();
}

describe('HomePlannerScreen', () => {
  it('shows inputs, P&I vs all-in, cash to close and stress tests with forecast labels', async () => {
    await renderWithApi(<HomePlannerScreen />, plannerRoutes);

    // Never claims mortgage approval.
    expect(screen.getByTestId('no-approval-note')).toHaveTextContent(/not a mortgage pre-approval/);

    const inputs = await screen.findByTestId('home-inputs');
    expect(within(inputs).getByText('$1,200,000.00')).toBeTruthy();
    // Client preview uses decimal math: 960,000 at 6.5% for 30 years.
    expect(within(inputs).getByTestId('pi-preview')).toHaveTextContent('$6,067.85');

    // P&I and all-in are both shown and are distinct.
    expect(await screen.findByTestId('home-pi')).toHaveTextContent('$6,067.85');
    expect(screen.getByTestId('home-all-in')).toHaveTextContent('$9,117.85');
    expect(screen.getByTestId('cash-to-close')).toHaveTextContent('$269,000.00');

    expectForecastLabels(screen.getByTestId('home-monthly'));
    expectForecastLabels(screen.getByTestId('home-cash'));

    expect(screen.getByText('Rate +1pp')).toBeTruthy();
    expect(screen.getByText(/RSU price is your own estimate/)).toBeTruthy();
    expect(screen.queryByText(/you are (pre-)?approved|you qualify|approved for/i)).toBeNull();
  });

  it('runs the active version via POST with an Idempotency-Key', async () => {
    const { calls } = await renderWithApi(<HomePlannerScreen />, plannerRoutes);
    await fireEvent.press(await screen.findByTestId('planner-run'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ seed: null });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
  });

  it('offers to create a scenario when none exist', async () => {
    await renderWithApi(<HomePlannerScreen />, [{ path: '/scenarios', body: { items: [] } }, ...plannerRoutes]);
    expect(await screen.findByText('Plan a home purchase')).toBeTruthy();
  });
});

describe('CompareScreen', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ runs: `${ids.runA},${ids.runB}` });
  });
  afterEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
  });

  it('renders side-by-side metrics, labelled charts and data tables', async () => {
    const { calls } = await renderWithApi(<CompareScreen />, [
      { path: '/me', body: me },
      { method: 'POST', path: '/comparisons', body: comparison },
      { path: `/runs/${ids.runA}/results`, body: runResult },
      { path: `/runs/${ids.runB}/results`, body: { ...runResult, run_id: ids.runB } },
    ]);

    const table = await screen.findByTestId('compare-table');
    expect(within(table).getByText('Baseline v2')).toBeTruthy();
    expect(within(table).getByText('Conservative v1')).toBeTruthy();
    expect(within(table).getByText('$2,500,000.00')).toBeTruthy();
    expect(within(table).getByText('$1,900,000.00')).toBeTruthy();

    const post = calls.find((c) => c.path === '/comparisons')!;
    expect(post.body).toEqual({ run_ids: [ids.runA, ids.runB] });

    expect(screen.getByTestId(`labels-${ids.runA}`)).toBeTruthy();
    expect(screen.getAllByText('Illustrative').length).toBeGreaterThanOrEqual(3);

    // Every chart can be switched to an accessible data table.
    await fireEvent.press(screen.getByTestId('compare-net-worth-toggle'));
    const nwTable = await screen.findByTestId('compare-net-worth-table');
    expect(within(nwTable).getByText('2027')).toBeTruthy();
    expect(within(nwTable).getByText('$70,000.00')).toBeTruthy();
  });

  it('explains how to pick scenarios when fewer than two runs are selected', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    const { client } = await renderWithApi(<CompareScreen />, [{ path: '/me', body: me }]);
    expect(screen.getByText(/Select two to four scenarios/)).toBeTruthy();
    await waitFor(() => expect(client.getQueryData(['me'])).toBeDefined());
  });
});
