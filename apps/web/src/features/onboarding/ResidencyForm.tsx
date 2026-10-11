'use client';

import { COUNTRIES, RESIDENCY_TYPES } from '@wealthpilot/contracts';
import { COUNTRY_LABELS, RESIDENCY_LABELS, emptyPeriod, type ResidencyFormInput } from '@wealthpilot/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';

import { ChoiceField, DateField, SwitchField, type FormControl } from '@/components/form';
import { Button } from '@/components/ui/button';

/** Tax residency periods (S03 onboarding and the settings residency editor). Empty "to" = ongoing. */
export function ResidencyPeriodsEditor({ control }: { control: FormControl<ResidencyFormInput> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'tax_residency' });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f, i) => (
        <fieldset key={f.id} data-testid={`residency-period-${i}`} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <legend className="font-semibold">Period {i + 1}</legend>
            {fields.length > 1 ? (
              <Button variant="ghost" size="sm" aria-label={`Remove period ${i + 1}`} onClick={() => remove(i)}>
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <ChoiceField
            control={control}
            name={`tax_residency.${i}.jurisdiction`}
            label="Jurisdiction"
            options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] }))}
            testId={`choice-tax_residency.${i}.jurisdiction`}
          />
          <ChoiceField
            control={control}
            name={`tax_residency.${i}.residency_type`}
            label="Residency status (your assumption)"
            options={RESIDENCY_TYPES.map((r) => ({ value: r, label: RESIDENCY_LABELS[r] }))}
            testId={`choice-tax_residency.${i}.residency_type`}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name={`tax_residency.${i}.from_date`} label="From" />
            <DateField control={control} name={`tax_residency.${i}.to_date`} label="To (leave empty if ongoing)" />
          </div>
          <SwitchField
            control={control}
            name={`tax_residency.${i}.verified_by_user`}
            label="I have confirmed this status"
            helper="WealthPilot does not determine tax residency. Confirm with a professional."
          />
        </fieldset>
      ))}
      <Button variant="outline" className="w-fit" onClick={() => append(emptyPeriod())}>
        <Plus aria-hidden /> Add another period
      </Button>
    </div>
  );
}
