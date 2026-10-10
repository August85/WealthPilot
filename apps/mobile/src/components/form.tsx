/**
 * React Hook Form bound inputs. Values are kept as strings (decimal strings for money) so nothing is
 * coerced through JS numbers.
 */
import type { ReactNode } from 'react';
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { StyleSheet, Switch, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH } from '../theme/tokens';
import { Chip, Row, Text } from './primitives';

export type FormControl<T extends FieldValues> = Control<T, any, any>;

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

function FieldShell({
  label,
  helper,
  error,
  children,
  nativeID,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: ReactNode;
  nativeID: string;
}) {
  return (
    <View style={s.field}>
      <Text variant="label" nativeID={nativeID}>
        {label}
      </Text>
      {children}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          ⚠ {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="muted">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export function PlainTextInput({
  value,
  onChangeText,
  onBlur,
  placeholder,
  keyboardType,
  labelId,
  label,
  invalid,
  testID,
  secureTextEntry,
  autoCapitalize,
  multiline,
  prefix,
  editable = true,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  labelId?: string;
  label: string;
  invalid?: boolean;
  testID?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  prefix?: string;
  editable?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        s.inputWrap,
        {
          borderColor: invalid ? t.colors.danger : t.colors.border,
          backgroundColor: editable ? t.colors.surface : t.colors.surfaceAlt,
          borderRadius: t.radius.md,
        },
      ]}>
      {prefix ? (
        <Text tone="muted" tabular>
          {prefix}
        </Text>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        aria-invalid={invalid}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        editable={editable}
        maxFontSizeMultiplier={2}
        style={[s.input, t.typography.body, { color: t.colors.text, fontVariant: ['tabular-nums'] }]}
      />
    </View>
  );
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  helper,
  placeholder,
  keyboardType,
  testID,
  autoCapitalize,
  multiline,
  prefix,
  secureTextEntry,
  editable,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  helper?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  prefix?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
}) {
  const id = `lbl-${String(name)}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell label={label} helper={helper} error={fieldState.error?.message} nativeID={id}>
          <PlainTextInput
            testID={testID ?? `field-${String(name)}`}
            label={label}
            labelId={id}
            value={field.value == null ? '' : String(field.value)}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            keyboardType={keyboardType}
            invalid={!!fieldState.error}
            autoCapitalize={autoCapitalize}
            multiline={multiline}
            prefix={prefix}
            secureTextEntry={secureTextEntry}
            editable={editable}
          />
        </FieldShell>
      )}
    />
  );
}

/** Money input: decimal string, keyboard with decimal point, currency symbol prefix. */
export function MoneyField<T extends FieldValues>(
  props: Omit<Parameters<typeof TextField<T>>[0], 'keyboardType' | 'prefix'> & { currency?: string },
) {
  const prefix = props.currency === 'INR' ? '₹' : props.currency === 'USD' ? '$' : props.currency;
  return <TextField {...props} keyboardType="decimal-pad" prefix={prefix} placeholder={props.placeholder ?? '0.00'} />;
}

/** Percentage input. Stored as the user typed (e.g. "6.25"); convert with percentToFraction on submit. */
export function PercentField<T extends FieldValues>(props: Omit<Parameters<typeof TextField<T>>[0], 'keyboardType'>) {
  return <TextField {...props} keyboardType="decimal-pad" placeholder={props.placeholder ?? '0'} prefix="%" />;
}

/** Date-only input (YYYY-MM-DD); a plain text field works the same on iOS, Android and web. */
export function DateField<T extends FieldValues>(props: Omit<Parameters<typeof TextField<T>>[0], 'keyboardType'>) {
  return (
    <TextField
      {...props}
      keyboardType="numbers-and-punctuation"
      placeholder={props.placeholder ?? 'YYYY-MM-DD'}
      helper={props.helper ?? 'Format YYYY-MM-DD'}
      autoCapitalize="none"
    />
  );
}

export function ChoiceField<T extends FieldValues, V extends string = string>({
  control,
  name,
  label,
  options,
  helper,
  testID,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  options: Option<V>[];
  helper?: string;
  testID?: string;
}) {
  const id = `lbl-${String(name)}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell label={label} helper={helper} error={fieldState.error?.message} nativeID={id}>
          <Row wrap gap={8} style={s.choices}>
            {options.map((o) => (
              <Chip
                key={o.value}
                testID={testID ? `${testID}-${o.value}` : `choice-${String(name)}-${o.value}`}
                label={o.label}
                accessibilityLabel={`${label}: ${o.label}`}
                selected={field.value === o.value}
                onPress={() => field.onChange(o.value)}
              />
            ))}
          </Row>
        </FieldShell>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  control,
  name,
  label,
  helper,
  testID,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  helper?: string;
  testID?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SwitchRow
          label={label}
          helper={helper}
          value={!!field.value}
          onValueChange={field.onChange}
          testID={testID ?? `switch-${String(name)}`}
        />
      )}
    />
  );
}

export function SwitchRow({
  label,
  helper,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  label: string;
  helper?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Row style={s.switchRow} gap={12}>
      <View style={s.flex}>
        <Text variant="bodyStrong">{label}</Text>
        {helper ? (
          <Text variant="caption" tone="muted">
            {helper}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityHint={helper}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled: !!disabled }}
        trackColor={{ true: t.colors.primary, false: t.colors.border }}
      />
    </Row>
  );
}

const s = StyleSheet.create({
  field: { gap: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    paddingHorizontal: 12,
    gap: 6,
    minHeight: MIN_TOUCH,
  },
  input: { flex: 1, paddingVertical: 10 },
  choices: { marginTop: 2 },
  switchRow: { minHeight: MIN_TOUCH, paddingVertical: 4 },
  flex: { flex: 1 },
});
