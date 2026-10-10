import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, radius, spacing, typography, type ThemeColors } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export function buildTheme(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    typography,
  };
}

const ThemeContext = createContext<Theme>(buildTheme('light'));

export function ThemeProvider({ children, scheme }: { children: ReactNode; scheme?: 'light' | 'dark' }) {
  const system = useColorScheme();
  const resolved: 'light' | 'dark' = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => buildTheme(resolved), [resolved]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
