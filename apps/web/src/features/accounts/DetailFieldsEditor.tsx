'use client';

import { detailFieldsFor } from '@wealthpilot/shared';
import type { FieldPath, FieldValues } from 'react-hook-form';

import { ChoiceField, DateField, MoneyField, NumberField, PercentField, SwitchField, TextField, type FormControl } from '@/components/form';

/** Renders the contract's type-specific `details` fields (same definitions as mobile), bound to `details.<key>`. */
export function DetailFieldsEditor<T extends FieldValues>({
  control,
  type,
  currency,
}: {
  control: FormControl<T>;
  type: string;
  currency: string;
}) {
  const fields = detailFieldsFor(type);
  if (fields.length === 0) return <p className="text-sm text-muted-foreground">No extra details for this type.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const name = `details.${f.key}` as FieldPath<T>;
        const label = f.required ? `${f.label} *` : f.label;
        switch (f.kind) {
          case 'money':
            return <MoneyField key={f.key} control={control} name={name} label={label} helper={f.helper} currency={currency} />;
          case 'percent':
            return <PercentField key={f.key} control={control} name={name} label={label} helper={f.helper} />;
          case 'date':
            return <DateField key={f.key} control={control} name={name} label={label} helper={f.helper} />;
          case 'choice':
            return (
              <ChoiceField key={f.key} control={control} name={name} label={label} helper={f.helper} options={f.options ?? []} className="sm:col-span-2" />
            );
          case 'bool':
            return (
              <div key={f.key} className="sm:col-span-2">
                <SwitchField control={control} name={name} label={f.label} helper={f.helper} />
              </div>
            );
          case 'int':
          case 'decimal':
            return <NumberField key={f.key} control={control} name={name} label={label} helper={f.helper} />;
          default:
            return <TextField key={f.key} control={control} name={name} label={label} helper={f.helper} multiline className="sm:col-span-2" />;
        }
      })}
    </div>
  );
}
