/** S24 Help and disclosures copy, shared so mobile and web never drift. Pending legal review (DECISIONS.md). */
export const HELP_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Not advice',
    body: [
      'WealthPilot is planning software. It is not a bank, broker, investment adviser, tax preparer or lender, and nothing in the app is tax, legal or investment advice.',
      'Verify important decisions with a qualified professional in each country involved.',
    ],
  },
  {
    title: 'Forecasts are illustrative',
    body: [
      'Every projection is labelled with its “As of” date, scenario, the assumptions version used and “Illustrative”.',
      'Projections are deterministic calculations from your own assumptions. Real returns, inflation, exchange rates, salaries and tax rules will differ.',
      'Home planner results are planning estimates, not a mortgage pre-approval or a statement of what a lender will offer.',
    ],
  },
  {
    title: 'Your figures and their provenance',
    body: [
      'Balances you enter are marked “Manual” with an “as of” date. Figures you have not confirmed are marked “Unverified” with a dashed outline, and figures older than the staleness window are marked “Stale”.',
      'Each balance keeps its own currency. Switching between USD and INR only changes how totals are reported, using the FX rate shown with its source and date.',
    ],
  },
  {
    title: 'Taxes and cross-border rules',
    body: [
      'Tax residency periods are your own assumption. WealthPilot does not determine residency or treaty positions.',
      'RSU withholding, capital-gains and withdrawal tax rates in scenarios are simplified, user-editable assumptions.',
      'EPF access is treated as not accessible unless you set a verified access age.',
    ],
  },
  {
    title: 'Unvested equity',
    body: [
      'Unvested RSUs are excluded from net worth and from home funding by default. They appear separately as unvested and restricted.',
    ],
  },
  {
    title: 'Privacy',
    body: [
      'Your data is encrypted in transit and at rest. Identifiable financial data is never sold.',
      'Analytics are anonymous and never include amounts, balances, names or email addresses.',
      'You can export your data at any time and delete your account from Privacy & security.',
    ],
  },
  {
    title: 'Pricing',
    body: ['Plus and Pro prices shown in the app are proposed and may change.'],
  },
];

export const DISCLAIMER_SHORT = 'Illustrative planning only — not tax, legal or investment advice.';
export const DISCLAIMER_LONG =
  'WealthPilot is planning software. Figures are illustrative and based on your own inputs and assumptions. It is not tax, legal or investment advice; verify important decisions with a qualified professional.';
