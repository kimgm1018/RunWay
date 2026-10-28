import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, themes, type Theme } from './themes';

export type ThemePreference = 'system' | 'dark' | 'light';

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreference = 'system',
}: {
  children: React.ReactNode;
  initialPreference?: ThemePreference;
}) {
  const scheme = useColorScheme();
  const [preference, setPreference] =
    useState<ThemePreference>(initialPreference);
  const value = useMemo(() => {
    // The prototype's main screens are dark, so dark is the fallback when the OS gives no answer.
    const name =
      preference === 'system'
        ? scheme === 'light'
          ? 'light'
          : 'dark'
        : preference;
    return { theme: themes[name] ?? darkTheme, preference, setPreference };
  }, [preference, scheme]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemeSettings() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useThemeSettings must be used inside ThemeProvider');
  }
  return value;
}

export function useTheme() {
  return useThemeSettings().theme;
}
