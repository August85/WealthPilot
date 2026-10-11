import { HELP_SECTIONS as SECTIONS } from '@wealthpilot/shared';

import { Card, Screen, Stack, Text } from '@/components/primitives';

/** S24 Help and disclosures. Reachable signed in or out. */
export default function HelpScreen() {
  return (
    <Screen testID="help-screen">
      <Text variant="title">Help & disclosures</Text>
      <Stack gap={12}>
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <Text variant="heading" accessibilityRole="header">
              {s.title}
            </Text>
            {s.body.map((p) => (
              <Text key={p}>{p}</Text>
            ))}
          </Card>
        ))}
      </Stack>
    </Screen>
  );
}
