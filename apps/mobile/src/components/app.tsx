import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { errorMessage } from '../lib/hooks';
import { useIsOnline } from '../lib/network';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, ErrorState, Icon, LoadingState, Row, Stack, Text, type ButtonProps } from './primitives';

/** Shown on every screen while offline: cached data is read-only. */
export function OfflineBanner() {
  const online = useIsOnline();
  const t = useTheme();
  if (online) return null;
  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: t.colors.warningBg, borderColor: t.colors.warning }]}>
      <Icon name="cloud-offline-outline" color={t.colors.warning} />
      <Text variant="label" style={[styles.flex, { color: t.colors.warning }]}>
        Offline — showing saved data, read-only. Changes are disabled until you reconnect.
      </Text>
    </View>
  );
}

/** A primary action that is automatically disabled offline (no queued financial writes). */
export function MutationButton(props: ButtonProps) {
  const online = useIsOnline();
  return (
    <Button
      {...props}
      disabled={props.disabled || !online}
      accessibilityHint={!online ? 'Unavailable offline' : props.accessibilityHint}
      label={!online ? `${props.label} (offline)` : props.label}
    />
  );
}

/** Version-conflict resolve prompt (409 VERSION_CONFLICT). Never last-write-wins. */
export function ConflictDialog() {
  const conflict = useUiStore((s) => s.conflict);
  const dismiss = useUiStore((s) => s.dismissConflict);
  const t = useTheme();
  if (!conflict) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={[styles.backdrop]}>
        <View
          testID="conflict-dialog"
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.dialog, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Stack gap={12}>
            <Row gap={8}>
              <Icon name="git-compare-outline" color={t.colors.warning} />
              <Text variant="heading" style={styles.flex}>
                This changed somewhere else
              </Text>
            </Row>
            <Text>
              {`${capitalize(conflict.entity)} was updated on another device or session after you opened it. Your changes were not saved, and nothing was overwritten.`}
            </Text>
            {conflict.detail ? (
              <Text variant="caption" tone="muted">
                {conflict.detail}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              Load the latest version, review it, then re-apply your edit if it still makes sense.
            </Text>
            <Button
              testID="conflict-reload"
              label="Load latest version"
              icon="refresh"
              onPress={async () => {
                dismiss();
                await conflict.onReload();
              }}
            />
            <Button testID="conflict-keep" label="Keep my edits on screen" variant="secondary" onPress={dismiss} />
          </Stack>
        </View>
      </View>
    </Modal>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render helper for a query: loading, error (with retry) or the content. Cached data shows even when refetch fails. */
export function QueryView<T>({
  query,
  children,
  loadingLabel,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError ? (
          <Text variant="caption" tone="warning" accessibilityRole="alert">
            ⚠ Showing saved data. Refresh failed: {errorMessage(query.error)}
          </Text>
        ) : null}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  return <LoadingState label={loadingLabel} />;
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Card tone="danger" accessibilityLabel={`Error: ${errorMessage(error)}`}>
      <Text tone="danger" accessibilityRole="alert">
        ⚠ {errorMessage(error)}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(13,27,42,0.6)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 16, padding: 20, borderWidth: 1, maxWidth: 520, width: '100%', alignSelf: 'center' },
});
