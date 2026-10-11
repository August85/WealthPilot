'use client';

import { ASSUMPTION_SECTIONS, WITHDRAWAL_LABELS, type AssumptionsForm, type SectionKey } from '@wealthpilot/shared';
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Controller, useWatch, type FieldPath } from 'react-hook-form';

import { ChoiceField, DateField, MoneyField, NumberField, PercentField, SwitchField, type FormControl } from '@/components/form';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Path = FieldPath<AssumptionsForm>;

function currencyAt(values: Record<string, unknown> | undefined, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const [a, b] = path.split('.');
  if (!a || !b) return undefined;
  const section = values?.[a] as Record<string, unknown> | undefined;
  const v = section?.[b];
  return typeof v === 'string' ? v : undefined;
}

/** Every ScenarioAssumptions field, grouped in collapsible sections (S16). Nullable sections have an on/off switch. */
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
  const values = useWatch({ control, name: 'values' }) as Record<string, unknown> | undefined;
  const allOpen = list.every((s) => open.has(s.key));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((s) => s.key)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>
      {list.map((s) => {
        const isOpen = open.has(s.key);
        const sectionOn = !s.nullable || !!enabled?.[s.key as keyof AssumptionsForm['enabled']];
        const panelId = `assumptions-${s.key}`;
        return (
          <section key={s.key} data-testid={`assumption-section-${s.key}`} className="rounded-xl border bg-card shadow-card">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                data-testid={`assumption-toggle-${s.key}`}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring">
                <span className="flex-1 font-semibold">{s.title}</span>
                {s.nullable ? (
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', sectionOn ? 'border-success/40 text-success' : 'border-dashed text-muted-foreground')}>
                    {sectionOn ? 'Modelled' : 'Off'}
                  </span>
                ) : null}
                <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
            </h3>
            {isOpen ? (
              <div id={panelId} className="flex flex-col gap-4 border-t px-5 py-4">
                {s.description ? <p className="text-sm text-muted-foreground">{s.description}</p> : null}
                {s.nullable ? (
                  <SwitchField control={control} name={`enabled.${s.key}` as Path} label={`Model ${s.title.toLowerCase()}`} testId={`enable-${s.key}`} />
                ) : null}
                {sectionOn ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {s.fields.map((f) => {
                      const name = `values.${f.path}` as Path;
                      switch (f.kind) {
                        case 'percent':
                          return <PercentField key={f.path} control={control} name={name} label={f.label} helper={f.helper} />;
                        case 'money':
                          return (
                            <MoneyField key={f.path} control={control} name={name} label={f.label} helper={f.helper} currency={currencyAt(values, f.currencyPath)} />
                          );
                        case 'date':
                          return <DateField key={f.path} control={control} name={name} label={f.label} helper={f.helper} />;
                        case 'choice':
                          return (
                            <ChoiceField key={f.path} control={control} name={name} label={f.label} options={f.options ?? []} helper={f.helper} className="sm:col-span-2" />
                          );
                        case 'bool':
                          return (
                            <div key={f.path} className="sm:col-span-2">
                              <SwitchField control={control} name={name} label={f.label} helper={f.helper} />
                            </div>
                          );
                        default:
                          return (
                            <NumberField
                              key={f.path}
                              control={control}
                              name={name}
                              label={f.label}
                              helper={f.helper ?? (f.kind === 'nullableInt' ? 'Leave empty if unknown' : undefined)}
                            />
                          );
                      }
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not modelled in this scenario.</p>
                )}
                {s.key === 'retirement' ? <WithdrawalOrder control={control} /> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
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
          const a = next[i];
          const b = next[j];
          if (a === undefined || b === undefined) return;
          next[i] = b;
          next[j] = a;
          field.onChange(next);
        };
        return (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Withdrawal order</legend>
            <ol className="flex flex-col divide-y rounded-lg border">
              {order.map((b, i) => {
                const label = WITHDRAWAL_LABELS[b] ?? b;
                return (
                  <li key={b} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="w-5 text-muted-foreground tabular">{i + 1}.</span>
                    <span className="flex-1">{label}</span>
                    <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label} earlier`}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label} later`}>
                      <ArrowDown aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ol>
          </fieldset>
        );
      }}
    />
  );
}
