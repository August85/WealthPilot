import type { FieldPath, FieldValues } from 'react-hook-form';

import { ChoiceField, DateField, MoneyField, PercentField, SwitchField, TextField, type FormControl } from '@/components/form';
import { Stack } from '@/components/primitives';

import { detailFieldsFor } from './detailFields';

/** Renders the contract's type-specific `details` fields, bound to `details.<key>` in the form. */
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
  if (fields.length === 0) return null;
  return (
    <Stack gap={12}>
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
            return <ChoiceField key={f.key} control={control} name={name} label={label} helper={f.helper} options={f.options ?? []} />;
          case 'bool':
            return <SwitchField key={f.key} control={control} name={name} label={f.label} helper={f.helper} />;
          case 'int':
          case 'decimal':
            return (
              <TextField key={f.key} control={control} name={name} label={label} helper={f.helper} keyboardType="decimal-pad" />
            );
          default:
            return <TextField key={f.key} control={control} name={name} label={label} helper={f.helper} multiline />;
        }
      })}
    </Stack>
  );
}
