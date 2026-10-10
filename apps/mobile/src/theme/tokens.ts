/**
 * Design tokens (spec §17). Brand palette:
 *   navy #0D1B2A · slate #243447 · ivory #F8FAFC · teal #0D9488 · amber #D97706 · red #B91C1C
 *
 * Text colors are chosen to meet WCAG 2.2 AA (≥ 4.5:1) against their surfaces. Where a brand hue is
 * too light for body text on a light surface (teal 3.7:1, amber 3.2:1 on white), a darker shade of the
 * same hue is used for text and the brand hue is kept for large graphics (≥ 3:1).
 */

export const palette = {
  navy: '#0D1B2A',
  slate: '#243447',
  ivory: '#F8FAFC',
  teal: '#0D9488',
  amber: '#D97706',
  red: '#B91C1C',
  // Accessible shades derived from the brand hues
  tealDark: '#0F766E', // 5.5:1 on white
  tealLight: '#5EEAD4', // 10:1 on navy
  amberDark: '#92400E', // 7.1:1 on white
  amberLight: '#FBBF24', // 10:1 on navy
  redLight: '#FCA5A5', // 8.7:1 on navy
  slate600: '#475569', // 7.6:1 on ivory
  slate300: '#CBD5E1',
  slate200: '#E2E8F0',
  slate100: '#F1F5F9',
  white: '#FFFFFF',
  violet: '#6D28D9',
  violetLight: '#C4B5FD',
  sky: '#0369A1',
  skyLight: '#7DD3FC',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  /** Text/icon color on `primary` backgrounds. */
  onPrimary: string;
  link: string;
  accent: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  /** Unverified/estimated figures. */
  estimated: string;
  /** Stale figures. */
  stale: string;
  chart: string[];
  tabBar: string;
  focus: string;
}

export const lightColors: ThemeColors = {
  background: palette.ivory,
  surface: palette.white,
  surfaceAlt: palette.slate100,
  border: palette.slate300,
  text: palette.navy,
  textMuted: palette.slate600,
  primary: palette.tealDark,
  onPrimary: palette.white,
  link: palette.tealDark,
  accent: palette.teal,
  success: palette.tealDark,
  successBg: '#CCFBF1',
  warning: palette.amberDark,
  warningBg: '#FEF3C7',
  danger: palette.red,
  dangerBg: '#FEE2E2',
  info: palette.slate,
  infoBg: palette.slate100,
  estimated: palette.amberDark,
  stale: palette.amberDark,
  chart: [palette.teal, palette.slate, palette.amber, palette.violet, palette.sky],
  tabBar: palette.white,
  focus: palette.sky,
};

export const darkColors: ThemeColors = {
  background: palette.navy,
  surface: palette.slate,
  surfaceAlt: '#1A2838',
  border: '#3B4D63',
  text: palette.ivory,
  textMuted: palette.slate300,
  primary: palette.tealLight,
  onPrimary: palette.navy,
  link: palette.tealLight,
  accent: palette.teal,
  success: palette.tealLight,
  successBg: '#134E4A',
  warning: palette.amberLight,
  warningBg: '#422006',
  danger: palette.redLight,
  dangerBg: '#450A0A',
  info: palette.slate300,
  infoBg: '#1A2838',
  estimated: palette.amberLight,
  stale: palette.amberLight,
  chart: [palette.tealLight, palette.slate300, palette.amberLight, palette.violetLight, palette.skyLight],
  tabBar: palette.navy,
  focus: palette.skyLight,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** Type scale. Sizes are base sizes; the OS font scale (Dynamic Type) multiplies them. Nothing below 13. */
export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
};

export type TypographyVariant = keyof typeof typography;

/** Minimum touch target (WCAG 2.5.8 / platform guidance). */
export const MIN_TOUCH = 44;
