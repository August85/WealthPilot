/* Contract-shaped fixtures for render tests. All money values are decimal strings, as on the wire. */
import type {
  Comparison,
  FxRate,
  Goal,
  HomeAssumptions,
  Me,
  NetWorth,
  RunMetrics,
  RunResult,
  Scenario,
  ScenarioAssumptions,
  ScenarioVersion,
  SimulationRun,
} from '@wealthpilot/contracts';

export const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  household: '00000000-0000-4000-8000-000000000002',
  acctUs: '00000000-0000-4000-8000-000000000010',
  acctFd: '00000000-0000-4000-8000-000000000011',
  goal: '00000000-0000-4000-8000-000000000020',
  scenarioA: '00000000-0000-4000-8000-000000000030',
  scenarioB: '00000000-0000-4000-8000-000000000031',
  versionA: '00000000-0000-4000-8000-000000000040',
  versionB: '00000000-0000-4000-8000-000000000041',
  runA: '00000000-0000-4000-8000-000000000050',
  runB: '00000000-0000-4000-8000-000000000051',
  newAccount: '00000000-0000-4000-8000-000000000099',
};

export const me: Me = {
  id: ids.user,
  email: 'test@example.com',
  display_name: 'Test User',
  locale: 'en-US',
  timezone: 'America/Los_Angeles',
  reporting_currency: 'USD',
  home_country: 'US',
  onboarding_completed: true,
  household_id: ids.household,
  entitlement: 'free',
  disclaimer_accepted_at: '2026-10-01T00:00:00Z',
  limits: { accounts: 5, goals: 1, scenarios: 1 },
};

const fxRate: FxRate = {
  base: 'USD',
  quote: 'INR',
  rate: '85.000000',
  as_of: '2026-10-10',
  provider: 'user',
  kind: 'user',
  stale: false,
  license_reference: null,
};

export function netWorth(currency: 'USD' | 'INR'): NetWorth {
  const usd = currency === 'USD';
  return {
    currency,
    as_of: '2026-10-10',
    gross_assets: usd ? '20000.00' : '1700000.00',
    liabilities: '0.00',
    net_worth: usd ? '20000.00' : '1700000.00',
    liquid_net_worth: usd ? '10000.00' : '850000.00',
    goal_eligible: usd ? '10000.00' : '850000.00',
    unvested_equity_excluded: usd ? '45000.00' : '3825000.00',
    by_country: [
      { key: 'US', amount: usd ? '10000.00' : '850000.00' },
      { key: 'IN', amount: usd ? '10000.00' : '850000.00' },
    ],
    by_currency: [
      { key: 'USD', native_amount: '10000.00', amount: usd ? '10000.00' : '850000.00' },
      { key: 'INR', native_amount: '850000.00', amount: usd ? '10000.00' : '850000.00' },
    ],
    by_class: [
      { key: 'savings', amount: usd ? '10000.00' : '850000.00' },
      { key: 'fixed_deposit', amount: usd ? '10000.00' : '850000.00' },
    ],
    fx: [fxRate],
    items: [
      {
        ref_type: 'account',
        ref_id: ids.acctUs,
        name: 'US savings',
        kind: 'asset',
        type: 'savings',
        country: 'US',
        native_amount: '10000.00',
        native_currency: 'USD',
        amount: usd ? '10000.00' : '850000.00',
        ownership_pct: '100',
        liquid: true,
        goal_eligible: true,
        as_of: '2026-10-01',
        verification_status: 'verified',
        stale: false,
      },
      {
        ref_type: 'account',
        ref_id: ids.acctFd,
        name: 'SBI FD',
        kind: 'asset',
        type: 'fixed_deposit',
        country: 'IN',
        native_amount: '850000.00',
        native_currency: 'INR',
        amount: usd ? '10000.00' : '850000.00',
        ownership_pct: '100',
        liquid: false,
        goal_eligible: false,
        as_of: '2026-07-01',
        verification_status: 'estimated',
        stale: true,
      },
    ],
    warnings: [],
  };
}

export const goals: Goal[] = [
  {
    id: ids.goal,
    type: 'home_purchase',
    name: 'Bay Area home',
    target_date: '2028-06-01',
    target_amount: '200000.00',
    currency: 'USD',
    priority: 1,
    scenario_id: null,
    details: {},
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    progress: { funded_amount: '10000.00', pct: '0.05', as_of: '2026-10-10', scenario_run_id: null },
  },
];

export const homeAssumptions: HomeAssumptions = {
  enabled: true,
  target_price: '1200000.00',
  currency: 'USD',
  purchase_date: '2028-06-01',
  down_payment_pct: '0.20',
  closing_cost_pct: '0.02',
  prepaid_costs: '5000.00',
  credits: '0.00',
  mortgage_rate_annual: '0.0650',
  term_years: 30,
  property_tax_rate_annual: '0.0120',
  insurance_annual: '2400.00',
  hoa_monthly: '300.00',
  pmi_rate_annual: '0.0050',
  maintenance_pct_annual: '0.0100',
  utilities_monthly: '350.00',
  emergency_reserve: '50000.00',
  funding_sources: { us_cash: true, brokerage: true, rsu_proceeds: true, india_liquid: false },
};

export const assumptions: ScenarioAssumptions = {
  base_date: '2026-10-10',
  reporting_currency: 'USD',
  horizon_years: 50,
  household: { current_age: 35, retirement_age: 60, life_expectancy: 90 },
  income: {
    salary_annual: '200000.00',
    bonus_annual: '20000.00',
    currency: 'USD',
    salary_growth_annual: '0.03',
    effective_tax_rate: '0.30',
    living_expenses_monthly: '6000.00',
    expense_currency: 'USD',
  },
  returns: { us_portfolio_annual: '0.06', india_portfolio_annual: '0.08', cash_annual: '0.02', real_estate_annual: '0.03' },
  inflation: { us_annual: '0.025', india_annual: '0.05' },
  fx: { usd_inr_start: '85.000000', inr_depreciation_annual: '0.02', transfer_cost_pct: '0.005' },
  rsu: {
    price_now: '150.00',
    price_growth_annual: '0.05',
    strategy: 'sell_on_vest',
    sell_fraction: '1',
    withholding_rate: '0.22',
    additional_tax_rate: '0.15',
    annual_refresh_value: '0.00',
  },
  retirement_401k: null,
  epf: null,
  retirement: {
    location: 'US',
    spending_monthly_today: '7000.00',
    healthcare_monthly_today: '800.00',
    healthcare_inflation_annual: '0.05',
    social_security_monthly_today: '2500.00',
    social_security_start_age: 67,
    withdrawal_order: ['taxable', 'india', 'tax_deferred', 'roth'],
    withdrawal_tax_rate: '0.15',
  },
  home: homeAssumptions,
};

function version(id: string, scenarioId: string, number: number): ScenarioVersion {
  return {
    id,
    scenario_id: scenarioId,
    number,
    assumptions,
    snapshot: { as_of: '2026-10-10', accounts: [], rsu_grants: [], prices: {}, fx: {} },
    input_hash: 'hash',
    model_version: 'engine-1.0.0',
    rulepack_version: 'rules-2026.1',
    notes: null,
    created_at: '2026-10-10T00:00:00Z',
  };
}

export function run(id: string, versionId: string): SimulationRun {
  return {
    id,
    scenario_version_id: versionId,
    status: 'completed',
    seed: null,
    model_version: 'engine-1.0.0',
    created_at: '2026-10-10T00:00:00Z',
    started_at: '2026-10-10T00:00:01Z',
    completed_at: '2026-10-10T00:00:02Z',
    error: null,
  };
}

export const homeScenario: Scenario = {
  id: ids.scenarioA,
  name: 'Buy in 2028',
  kind: 'home',
  preset: 'baseline',
  goal_id: ids.goal,
  parent_id: null,
  archived: false,
  active_version: version(ids.versionA, ids.scenarioA, 2),
  latest_run: run(ids.runA, ids.versionA),
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
  version: 1,
};

export const metrics: RunMetrics = {
  net_worth_now: '20000.00',
  liquid_net_worth_now: '10000.00',
  net_worth_at_retirement: '2500000.00',
  retirement_balance_at_retirement: '1800000.00',
  ending_balance_at_life_expectancy: '400000.00',
  first_deficit_age: null,
  years_in_deficit: 0,
  home_cash_needed: '345000.00',
  home_cash_available_at_purchase: '300000.00',
  home_funding_gap: '45000.00',
  home_earliest_feasible_date: '2029-01-01',
  home_pi_monthly: '6067.85',
  home_all_in_monthly: '8317.85',
  rsu_net_proceeds_to_purchase: '120000.00',
};

export const runResult: RunResult = {
  run_id: ids.runA,
  status: 'completed',
  model_version: 'engine-1.0.0',
  rulepack_version: 'rules-2026.1',
  currency: 'USD',
  base_date: '2026-10-10',
  input_hash: 'hash',
  checksum: 'sum',
  metrics,
  yearly: [2026, 2027, 2028].map((year, i) => ({
    year,
    age: 35 + i,
    net_worth: String(20000 + i * 50000) + '.00',
    liquid: String(10000 + i * 40000) + '.00',
    us_assets: '10000.00',
    india_assets: '10000.00',
    retirement_balance: '0.00',
    income: '220000.00',
    expenses: '72000.00',
    savings: '50000.00',
    rsu_net_proceeds: '60000.00',
    withdrawals: '0.00',
    deficit: '0.00',
    housing_cost: '0.00',
    usd_inr: '85.000000',
  })),
  home: {
    purchase_date: '2028-06-01',
    price: '1200000.00',
    down_payment: '240000.00',
    loan_principal: '960000.00',
    closing_costs: '24000.00',
    prepaid_costs: '5000.00',
    credits: '0.00',
    cash_to_close: '269000.00',
    emergency_reserve: '50000.00',
    total_cash_needed: '319000.00',
    pi_monthly: '6067.85',
    all_in_monthly: {
      principal_interest: '6067.85',
      property_tax: '1200.00',
      insurance: '200.00',
      hoa: '300.00',
      pmi: '0.00',
      maintenance: '1000.00',
      utilities: '350.00',
      total: '9117.85',
    },
    funding_timeline: [
      { month: '2027-06-01', available: '150000.00', required: '319000.00' },
      { month: '2028-06-01', available: '274000.00', required: '319000.00' },
    ],
    stress: [
      { label: 'Rate +1pp', pi_monthly: '6688.29', all_in_monthly: '9738.29', funding_gap: '45000.00' },
      { label: 'RSU price −30%', pi_monthly: '6067.85', all_in_monthly: '9117.85', funding_gap: '81000.00' },
    ],
  },
  sensitivity: [],
  explanations: [],
  warnings: [{ code: 'MISSING_PRICE', severity: 'warning', message: 'RSU price is your own estimate.' }],
};

export const comparison: Comparison = {
  runs: [
    { run_id: ids.runA, scenario_id: ids.scenarioA, scenario_name: 'Baseline', version_number: 2, metrics },
    {
      run_id: ids.runB,
      scenario_id: ids.scenarioB,
      scenario_name: 'Conservative',
      version_number: 1,
      metrics: { ...metrics, net_worth_at_retirement: '1900000.00', home_funding_gap: '90000.00' },
    },
  ],
  series: {
    net_worth: [
      { year: 2026, values: { [ids.runA]: '20000.00', [ids.runB]: '20000.00' } },
      { year: 2027, values: { [ids.runA]: '70000.00', [ids.runB]: '60000.00' } },
    ],
    liquid_net_worth: [
      { year: 2026, values: { [ids.runA]: '10000.00', [ids.runB]: '10000.00' } },
      { year: 2027, values: { [ids.runA]: '50000.00', [ids.runB]: '45000.00' } },
    ],
    retirement_balance: [
      { year: 2026, values: { [ids.runA]: '0.00', [ids.runB]: '0.00' } },
      { year: 2027, values: { [ids.runA]: '20000.00', [ids.runB]: '18000.00' } },
    ],
  },
};
