import React, { createContext, useContext } from 'react';
import { lightTheme, themes, type Theme, type ThemeName } from './themes';

const ThemeContext = createContext<Theme>(lightTheme);

// The app root is the light tone. Wrap a part in tone="dark" (black lower part, dark cards, maps)
// and everything inside it reads the dark colors.
export function ThemeProvider({
  children,
  tone = 'light',
}: {
  children: React.ReactNode;
  tone?: ThemeName;
}) {
  return (
    <ThemeContext.Provider value={themes[tone]}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
