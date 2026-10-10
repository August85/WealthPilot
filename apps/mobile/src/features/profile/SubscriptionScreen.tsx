import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { Entitlement } from '@wealthpilot/contracts';

import { QueryView } from '@/components/app';
import { Pill } from '@/components/finance';
import { Button, Card, Icon, Row, Screen, Stack, Text } from '@/components/primitives';
import { analytics } from '@/lib/analytics';
import { env } from '@/lib/env';
import { useMe } from '@/lib/hooks';
import { useTheme } from '@/theme/ThemeProvider';

interface Tier {
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

const REASON_TEXT: Record<string, string> = {
  plan_limit: 'You’ve reached a limit on your current plan.',
};

/** S23 Subscription: plans, current entitlement and (when configured) store purchase. */
export default function SubscriptionScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const me = useMe();
  const t = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const storeKey = Platform.OS === 'ios' ? env.revenueCatIosKey : Platform.OS === 'android' ? env.revenueCatAndroidKey : null;

  useEffect(() => {
    analytics.track('paywall_viewed', { reason: reason ? 'plan_limit' : 'browse' });
  }, [reason]);

  const purchase = (tier: Tier) => {
    // Entitlements are granted server-side from the RevenueCat webhook. Until store products and an SDK key
    // exist, purchasing is not available in the app.
    setNotice(
      storeKey
        ? `In-app purchase of ${tier.name} is coming soon.`
        : `In-app purchase is coming soon. ${tier.name} isn’t available to buy in this build yet.`,
    );
  };

  return (
    <Screen testID="subscription-screen">
      <Text variant="title">Subscription</Text>
      {reason ? (
        <Card tone="warning" testID="limit-reason">
          <Row>
            <Icon name="lock-closed-outline" color={t.colors.warning} />
            <Text style={{ flex: 1 }}>{REASON_TEXT[reason] ?? `You’ve reached a plan limit: ${reason}`}</Text>
          </Row>
        </Card>
      ) : null}
      <QueryView query={me} loadingLabel="Loading plan">
        {(m) => (
          <Stack gap={12}>
            <Card>
              <Text variant="label">Current plan</Text>
              <Text variant="heading" testID="current-plan">
                {TIERS.find((x) => x.id === m.entitlement)?.name ?? m.entitlement}
              </Text>
              <Text variant="caption" tone="muted">
                Limits: accounts {m.limits.accounts ?? 'unlimited'} · goals {m.limits.goals ?? 'unlimited'} · scenarios{' '}
                {m.limits.scenarios ?? 'unlimited'}
              </Text>
            </Card>
            {TIERS.map((tier) => {
              const current = tier.id === m.entitlement;
              return (
                <Card key={tier.id} testID={`tier-${tier.id}`} tone={current ? 'info' : 'default'}>
                  <Row>
                    <Text variant="heading" style={{ flex: 1 }}>
                      {tier.name}
                    </Text>
                    {current ? <Pill text="Current" icon="checkmark-circle-outline" /> : null}
                  </Row>
                  <Text variant="bodyStrong" tabular>
                    {tier.price}
                  </Text>
                  {tier.id !== 'free' ? (
                    <Text variant="caption" tone="muted">
                      Proposed price
                    </Text>
                  ) : null}
                  {tier.features.map((f) => (
                    <Row key={f} gap={6}>
                      <Icon name="checkmark" color={t.colors.success} />
                      <Text style={{ flex: 1 }}>{f}</Text>
                    </Row>
                  ))}
                  {!current && tier.id !== 'free' ? (
                    <Button label={`Choose ${tier.name}`} variant="secondary" onPress={() => purchase(tier)} testID={`buy-${tier.id}`} />
                  ) : null}
                </Card>
              );
            })}
            {notice ? (
              <Text tone="muted" accessibilityLiveRegion="polite" testID="purchase-notice">
                {notice}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              WealthPilot never sells identifiable financial data and does not take payment for product placement.
            </Text>
          </Stack>
        )}
      </QueryView>
    </Screen>
  );
}
