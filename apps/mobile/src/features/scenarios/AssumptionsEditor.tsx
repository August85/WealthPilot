import { useState } from 'react';
import { Controller, useWatch, type FieldPath } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChoiceField, DateField, MoneyField, PercentField, SwitchField, TextField, type FormControl } from '@/components/form';
import { Card, Icon, Row, Stack, Text } from '@/components/primitives';
import { MIN_TOUCH } from '@/theme/tokens';

import { ASSUMPTION_SECTIONS, WITHDRAWAL_LABELS, type AssumptionsForm, type SectionKey } from './assumptionFields';

type Path = FieldPath<AssumptionsForm>;

/** Every ScenarioAssumptions field, grouped in collapsible sections (S16). */
export function AssumptionsEditor({
  control,
  sections,
  initiallyOpen,
}: {
  control: FormControl<AssumptionsForm>;
  sections?: SectionKey[];
  initiallyOpen?: SectionKey[];
}) {
  const list = ASSUMPTION_SECTIONS.filter((s) => !sections || sections.includes(s.key));
  const [open, setOpen] = useState<Set<SectionKey>>(new Set(initiallyOpen ?? []));
  const enabled = useWatch({ control, name: 'enabled' });
  const values = useWatch({ control, name: 'values' }) as Record<string, Record<string, unknown>> | undefined;

  return (
    <Stack gap={10}>
      {list.map((s) => {
        const isOpen = open.has(s.key);
        const sectionOn = !s.nullable || enabled?.[s.key as keyof AssumptionsForm['enabled']];
        return (
          <Card key={s.key} testID={`assumption-section-${s.key}`}>
            <Pressable
              onPress={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  return next;
                })
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${s.title} assumptions`}
              style={styles.header}>
              <Text variant="heading" style={styles.flex}>
                {s.title}
              </Text>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} />
            </Pressable>
            {isOpen ? (
              <Stack gap={12}>
                {s.description ? (
                  <Text variant="caption" tone="muted">
                    {s.description}
                  </Text>
                ) : null}
                {s.nullable ? (
                  <SwitchField
                    control={control}
                    name={`enabled.${s.key}` as Path}
                    label={`Model ${s.title.toLowerCase()}`}
                    testID={`enable-${s.key}`}
                  />
                ) : null}
                {sectionOn
                  ? s.fields.map((f) => {
                      const name = `values.${f.path}` as Path;
                      const curPath = f.currencyPath?.split('.');
                      const currency = curPath
                        ? String((values?.[curPath[0]!] as Record<string, unknown> | undefined)?.[curPath[1]!] ?? '')
                        : undefined;
                      switch (f.kind) {
                        case 'percent':
                          return <PercentField key={f.path} control={control} name={name} label={f.label} helper={f.helper} />;
                        case 'money':
                          return (
                            <MoneyField key={f.path} control={control} name={name} label={f.label} helper={f.helper} currency={currency} />
                          );
                        case 'date':
                          return <DateField key={f.path} control={control} name={name} label={f.label} helper={f.helper} />;
                        case 'choice':
                          return <ChoiceField key={f.path} control={control} name={name} label={f.label} options={f.options ?? []} helper={f.helper} />;
                        case 'bool':
                          return <SwitchField key={f.path} control={control} name={name} label={f.label} helper={f.helper} />;
                        default:
                          return (
                            <TextField
                              key={f.path}
                              control={control}
                              name={name}
                              label={f.label}
                              helper={f.helper ?? (f.kind === 'nullableInt' ? 'Leave empty if unknown' : undefined)}
                              keyboardType={f.kind === 'int' || f.kind === 'nullableInt' ? 'number-pad' : 'decimal-pad'}
                            />
                          );
                      }
                    })
                  : null}
                {s.key === 'retirement' ? <WithdrawalOrder control={control} /> : null}
              </Stack>
            ) : null}
          </Card>
        );
      })}
    </Stack>
  );
}

function WithdrawalOrder({ control }: { control: FormControl<AssumptionsForm> }) {
  return (
    <Controller
      control={control}
      name="withdrawal_order"
      render={({ field }) => {
        const order = (field.value as string[]) ?? [];
        const move = (i: number, d: -1 | 1) => {
          const next = [...order];
          const j = i + d;
          if (j < 0 || j >= next.length) return;
          [next[i], next[j]] = [next[j]!, next[i]!];
          field.onChange(next);
        };
        return (
          <View>
            <Text variant="label">Withdrawal order</Text>
            {order.map((b, i) => (
              <Row key={b} gap={8} style={styles.orderRow}>
                <Text tabular>{i + 1}.</Text>
                <Text style={styles.flex}>{WITHDRAWAL_LABELS[b] ?? b}</Text>
                <Pressable
                  onPress={() => move(i, -1)}
                  disabled={i === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${WITHDRAWAL_LABELS[b] ?? b} earlier`}
                  style={styles.orderBtn}>
                  <Icon name="arrow-up" />
                </Pressable>
                <Pressable
                  onPress={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${WITHDRAWAL_LABELS[b] ?? b} later`}
                  style={styles.orderBtn}>
                  <Icon name="arrow-down" />
                </Pressable>
              </Row>
            ))}
          </View>
        );
      }}
    />
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  orderRow: { minHeight: MIN_TOUCH },
  orderBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
