import { NOTIFICATION_TYPES, type NotificationPreference, type NotificationType } from '@wealthpilot/contracts';

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, { title: string; helper: string }> = {
  vest_reminder: { title: 'RSU vest reminders', helper: 'A heads-up before a vest date. No amounts are shown.' },
  stale_balance: { title: 'Stale balance reminders', helper: 'When a balance hasn’t been updated for a while.' },
  goal_milestone: { title: 'Goal milestones', helper: 'When a goal passes a funding milestone.' },
};

/** Merge server preferences with every known type so all toggles render (all opt-in, default off). */
export function normalizePreferences(items: NotificationPreference[]): NotificationPreference[] {
  return NOTIFICATION_TYPES.map(
    (type) => items.find((p) => p.type === type && p.channel === 'push') ?? { type, channel: 'push', enabled: false },
  );
}
