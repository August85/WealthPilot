'use client';

/**
 * React Hook Form bound inputs. Values stay strings (decimal strings for money) so nothing is coerced through
 * JS numbers. Every field has a visible <label>, helper/error text wired with aria-describedby, and a stable
 * data-testid (`field-<name>`, `choice-<name>-<value>`, `switch-<name>`).
 */
import { AlertCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormControl<T extends FieldValues> = Control<T, any, any>;

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

export function FieldShell({
  id,
  label,
  helper,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-msg`} className="text-xs text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export interface PlainInputProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
  prefix?: string;
  suffix?: string;
  type?: 'text' | 'date' | 'email' | 'password';
  inputMode?: 'decimal' | 'numeric' | 'text' | 'email';
  disabled?: boolean;
  multiline?: boolean;
  autoComplete?: string;
}

export function PlainInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
  describedBy,
  testId,
  prefix,
  suffix,
  type = 'text',
  inputMode,
  disabled,
  multiline,
  autoComplete = 'off',
}: PlainInputProps) {
  if (multiline) {
    return (
      <Textarea
        id={id}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
      />
    );
  }
  return (
    <div className="relative flex items-center">
      {prefix ? (
        <span aria-hidden className="pointer-events-none absolute left-3 text-sm text-muted-foreground tabular">
          {prefix}
        </span>
      ) : null}
      <Input
        id={id}
        data-testid={testId}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        autoComplete={autoComplete}
        className={cn('tabular', prefix && 'pl-7', suffix && 'pr-8')}
      />
      {suffix ? (
        <span aria-hidden className="pointer-events-none absolute right-3 text-sm text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

interface BaseFieldProps<T extends FieldValues> {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  helper?: ReactNode;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
  className?: string;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  helper,
  placeholder,
  testId,
  disabled,
  className,
  prefix,
  suffix,
  type,
  inputMode,
  multiline,
  autoComplete,
}: BaseFieldProps<T> & Pick<PlainInputProps, 'prefix' | 'suffix' | 'type' | 'inputMode' | 'multiline' | 'autoComplete'>) {
  const id = `f-${useId().replace(/:/g, '')}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell id={id} label={label} helper={helper} error={fieldState.error?.message} className={className}>
          <PlainInput
            id={id}
            testId={testId ?? `field-${String(name)}`}
            value={field.value == null ? '' : String(field.value)}
            onChange={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            invalid={!!fieldState.error}
            describedBy={fieldState.error || helper ? `${id}-msg` : undefined}
            prefix={prefix}
            suffix={suffix}
            type={type}
            inputMode={inputMode}
            disabled={disabled}
            multiline={multiline}
            autoComplete={autoComplete}
          />
        </FieldShell>
      )}
    />
  );
}

export function currencyPrefix(currency: string | undefined): string | undefined {
  if (!currency) return undefined;
  return currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency;
}

/** Money input: decimal string; Indian (8,00,000) or western grouping is accepted and normalised on submit. */
export function MoneyField<T extends FieldValues>(props: BaseFieldProps<T> & { currency?: string }) {
  const { currency, ...rest } = props;
  return <TextField {...rest} inputMode="decimal" prefix={currencyPrefix(currency)} placeholder={props.placeholder ?? '0.00'} />;
}

/** Percentage input as the user types it ("6.25"); converted to a fraction ("0.0625") on submit. */
export function PercentField<T extends FieldValues>(props: BaseFieldProps<T>) {
  return <TextField {...props} inputMode="decimal" suffix="%" placeholder={props.placeholder ?? '0'} />;
}

export function NumberField<T extends FieldValues>(props: BaseFieldProps<T>) {
  return <TextField {...props} inputMode="decimal" />;
}

/** Date-only (YYYY-MM-DD) using the native date picker. */
export function DateField<T extends FieldValues>(props: BaseFieldProps<T>) {
  return <TextField {...props} type="date" />;
}

/**
 * A choice among a few options as a radio group of chips (arrow keys move the selection), or a native
 * select for long lists.
 */
export function ChoiceField<T extends FieldValues, V extends string = string>({
  control,
  name,
  label,
  options,
  helper,
  testId,
  className,
  variant,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  options: Option<V>[];
  helper?: ReactNode;
  testId?: string;
  className?: string;
  variant?: 'chips' | 'select';
}) {
  const id = `f-${useId().replace(/:/g, '')}`;
  const asSelect = variant === 'select' || (variant === undefined && options.length > 7);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) =>
        asSelect ? (
          <FieldShell id={id} label={label} helper={helper} error={fieldState.error?.message} className={className}>
            <NativeSelect
              id={id}
              data-testid={testId ?? `field-${String(name)}`}
              value={field.value == null ? '' : String(field.value)}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              aria-invalid={!!fieldState.error || undefined}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </FieldShell>
        ) : (
          <div className={cn('flex flex-col gap-1.5', className)}>
            <span id={`${id}-label`} className="text-sm font-medium">
              {label}
            </span>
            <ChipGroup
              labelledBy={`${id}-label`}
              value={field.value as V}
              options={options}
              onChange={field.onChange}
              testIdPrefix={testId ?? `choice-${String(name)}`}
            />
            {fieldState.error ? (
              <p role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
                <AlertCircle className="size-3.5" aria-hidden />
                {fieldState.error.message}
              </p>
            ) : helper ? (
              <p className="text-xs text-muted-foreground">{helper}</p>
            ) : null}
          </div>
        )
      }
    />
  );
}

export function ChipGroup<V extends string>({
  value,
  options,
  onChange,
  labelledBy,
  ariaLabel,
  testIdPrefix,
}: {
  value: V | null | undefined;
  options: Option<V>[];
  onChange: (v: V) => void;
  labelledBy?: string;
  ariaLabel?: string;
  testIdPrefix?: string;
}) {
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
      onKeyDown={(e) => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = options[(Math.max(0, idx) + dir + options.length) % options.length];
        if (next) {
          onChange(next.value);
          const el = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
          el?.focus();
        }
      }}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={o.value}
            tabIndex={selected || (idx === -1 && i === 0) ? 0 : -1}
            data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted',
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  helper,
  testId,
  disabled,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  helper?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SwitchRow
          label={label}
          helper={helper}
          checked={!!field.value}
          onCheckedChange={field.onChange}
          testId={testId ?? `switch-${String(name)}`}
          disabled={disabled}
        />
      )}
    />
  );
}

export function SwitchRow({
  label,
  helper,
  checked,
  onCheckedChange,
  disabled,
  testId,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = `s-${useId().replace(/:/g, '')}`;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {helper ? (
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {helper}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        data-testid={testId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={helper ? `${id}-help` : undefined}
      />
    </div>
  );
}
