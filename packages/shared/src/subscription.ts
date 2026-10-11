import type { Entitlement } from '@wealthpilot/contracts';

export interface Tier {
  id: Entitlement;
  name: string;
  price: string;
  features: string[];
}

/** Spec §12. Prices are proposed hypotheses and shown as such. */
export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    features: ['Up to 5 accounts', 'Manual tracking and basic net worth', '1 goal', '1 scenario', 'Standard exports (PDF watermarked)'],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$7.99/month or $69/year',
    features: ['Unlimited accounts', 'RSU and EPF modules', 'Unlimited goals', 'Up to 10 saved scenarios', 'Detailed reports', 'Reminders'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$14.99/month or $129/year',
    features: [
      'Unlimited scenarios and comparisons',
      'Advanced retirement and housing stress tests',
      'Household sharing',
      'Expanded exports',
    ],
  },
];

export const PLAN_LABELS: Record<Entitlement, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
