/** Human labels and guided templates for contract enums (shared with the web app via `@wealthpilot/shared`). */
import {
  ACCOUNT_TEMPLATES as SHARED_TEMPLATES,
  GOAL_ICONS as SHARED_GOAL_ICONS,
  type AccountTemplate as SharedAccountTemplate,
} from '@wealthpilot/shared';
import type { GoalType } from '@wealthpilot/contracts';

import type { IconName } from '../components/primitives';

export {
  ACCESSIBILITY_HELP,
  ACCESSIBILITY_LABELS,
  COUNTRY_LABELS,
  GOAL_LABELS,
  RESIDENCY_LABELS,
  countryLabel,
  defaultAccessibility,
  typeLabel,
} from '@wealthpilot/shared';

/** Shared template with the icon typed as an Ionicons name. */
export type AccountTemplate = Omit<SharedAccountTemplate, 'icon'> & { icon: IconName };

export const ACCOUNT_TEMPLATES = SHARED_TEMPLATES as AccountTemplate[];

export const GOAL_ICONS = SHARED_GOAL_ICONS as Record<GoalType, IconName>;

export function templateFor(type: string): AccountTemplate | undefined {
  return ACCOUNT_TEMPLATES.find((t) => t.type === type);
}
