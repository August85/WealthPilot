import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH, type ThemeColors, type TypographyVariant } from '../theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type Tone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'onPrimary' | 'link';

export function toneColor(colors: ThemeColors, tone: Tone): string {
  switch (tone) {
    case 'muted':
      return colors.textMuted;
    case 'primary':
      return colors.primary;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'onPrimary':
      return colors.onPrimary;
    case 'link':
      return colors.link;
    default:
      return colors.text;
  }
}

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: Tone;
  /** Tabular numerals for balances so digits align. */
  tabular?: boolean;
  center?: boolean;
}

export function Text({ variant = 'body', tone = 'default', tabular, center, style, ...rest }: TextProps) {
  const t = useTheme();
  const isHeading = variant === 'display' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : rest.accessibilityRole}
      maxFontSizeMultiplier={2.5}
      {...rest}
      style={[
        t.typography[variant],
        { color: toneColor(t.colors, tone) },
        tabular && styles.tabular,
        center && styles.center,
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  edges,
  contentStyle,
  testID,
  header,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
  header?: ReactNode;
}) {
  const t = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.screenContent, { padding: t.spacing.lg }, contentStyle]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { padding: t.spacing.lg, flex: 1 }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView
      testID={testID}
      edges={edges ?? ['left', 'right']}
      style={[styles.flex, { backgroundColor: t.colors.background }]}>
      {header}
      {body}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  tone,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'warning' | 'danger' | 'info' | 'success';
  accessibilityLabel?: string;
  testID?: string;
}) {
  const t = useTheme();
  const bg =
    tone === 'warning'
      ? t.colors.warningBg
      : tone === 'danger'
        ? t.colors.dangerBg
        : tone === 'info'
          ? t.colors.infoBg
          : tone === 'success'
            ? t.colors.successBg
            : t.colors.surface;
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        { backgroundColor: bg, borderColor: t.colors.border, borderRadius: t.radius.lg, padding: t.spacing.lg },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Row({
  children,
  style,
  gap = 8,
  wrap,
  ...rest
}: ViewProps & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
  wrap?: boolean;
}) {
  return (
    <View {...rest} style={[styles.row, { gap }, wrap && styles.wrap, style]}>
      {children}
    </View>
  );
}

export function Stack({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border }} />;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Row style={styles.sectionHeader}>
      <Text variant="heading" style={styles.flex}>
        {title}
      </Text>
      {action}
    </Row>
  );
}

export function Icon({ name, size = 20, color, label }: { name: IconName; size?: number; color?: string; label?: string }) {
  const t = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? t.colors.text}
      accessibilityLabel={label}
      accessible={!!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    />
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  accessibilityHint,
  accessibilityLabel,
  testID,
  style,
  compact,
}: ButtonProps) {
  const t = useTheme();
  const isDisabled = disabled || loading;
  const bg =
    variant === 'primary' ? t.colors.primary : variant === 'danger' ? t.colors.danger : 'transparent';
  const fg =
    variant === 'primary'
      ? t.colors.onPrimary
      : variant === 'danger'
        ? t.scheme === 'dark'
          ? t.colors.background
          : t.colors.onPrimary
        : t.colors.link;
  const border = variant === 'secondary' ? t.colors.primary : 'transparent';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, borderColor: border, borderRadius: t.radius.md },
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <RNText style={[t.typography.bodyStrong, { color: fg }]} maxFontSizeMultiplier={2}>
        {label}
      </RNText>
    </Pressable>
  );
}

export function LinkRow({
  title,
  subtitle,
  icon,
  onPress,
  right,
  testID,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  onPress?: () => void;
  right?: ReactNode;
  testID?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
      {icon ? <Icon name={icon} size={22} color={t.colors.primary} /> : null}
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress ? <Icon name="chevron-forward" size={18} color={t.colors.textMuted} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.centerBox} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={t.colors.primary} />
      <Text tone="muted">{label}…</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="danger" accessibilityLabel={`Error: ${message}`}>
      <Row>
        <Icon name="alert-circle" color={undefined} />
        <Text variant="bodyStrong" tone="danger" style={styles.flex}>
          {message}
        </Text>
      </Row>
      {onRetry ? <Button label="Try again" variant="ghost" onPress={onRetry} compact /> : null}
    </Card>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  icon = 'sparkles-outline',
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  const t = useTheme();
  return (
    <Card>
      <Stack gap={8} style={styles.centerItems}>
        <Icon name={icon} size={32} color={t.colors.primary} />
        <Text variant="heading" center>
          {title}
        </Text>
        {body ? (
          <Text tone="muted" center>
            {body}
          </Text>
        ) : null}
        {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      </Stack>
    </Card>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={onPress ? { selected: !!selected } : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? t.colors.primary : t.colors.surfaceAlt,
          borderColor: selected ? t.colors.primary : t.colors.border,
        },
      ]}>
      {selected ? <Ionicons name="checkmark" size={16} color={t.colors.onPrimary} /> : null}
      {icon && !selected ? <Ionicons name={icon} size={16} color={t.colors.text} /> : null}
      <RNText
        maxFontSizeMultiplier={2}
        style={[t.typography.label, { color: selected ? t.colors.onPrimary : t.colors.text }]}>
        {label}
      </RNText>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] } as TextStyle,
  center: { textAlign: 'center' },
  centerItems: { alignItems: 'center' },
  screenContent: { gap: 16, paddingBottom: 48 },
  card: { borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  sectionHeader: { marginTop: 8 },
  button: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonCompact: { alignSelf: 'flex-start' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH + 8, paddingVertical: 8 },
  centerBox: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: MIN_TOUCH,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
