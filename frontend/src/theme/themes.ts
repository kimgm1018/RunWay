import { k1 } from './tokens';

// The app has one screen look (K1). A tone picks the colors for where a view sits on it:
// 'light' for the light upper part and white cards, 'dark' for the black lower part, dark cards and maps.
export type ThemeName = 'dark' | 'light';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  // See-through fill for round buttons and chips sitting right on the K1 background.
  glass: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  // Emphasis is a brightness swap (black on light, white on dark), not a hue.
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  // Secondary bars next to an accent bar (2.1 러닝 분석).
  accentSoft: string;
  danger: string;
  dangerSurface: string;
  dangerBorder: string;
  onDanger: string;
  category: string;
  inputBackground: string;
  inputBorder: string;
  // The light rim of the 1.x pill fields (DESIGN.md 2-5).
  inputEdge: string;
  scrim: string;
  tabBar: string;
  tabBarBorder: string;
  tabActive: string;
  tabIconActive: string;
  tabInactive: string;
  statusBar: 'light-content' | 'dark-content';
};

export type Theme = { name: ThemeName; colors: ThemeColors };

// The tab bar is the same light pill in both tones (DESIGN.md 2-6).
const tabColors = {
  tabBar: k1.ice,
  tabBarBorder: 'rgba(2,5,14,0.08)',
  tabActive: k1.night,
  tabIconActive: k1.ice,
  tabInactive: 'rgba(2,5,14,0.55)',
};

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: k1.top,
    surface: 'rgba(255,255,255,0.86)',
    surfaceRaised: '#FFFFFF',
    surfaceMuted: 'rgba(2,5,14,0.07)',
    glass: 'rgba(255,255,255,0.5)',
    border: 'rgba(2,5,14,0.12)',
    borderStrong: 'rgba(2,5,14,0.24)',
    text: k1.night,
    textSecondary: 'rgba(2,5,14,0.6)',
    textTertiary: 'rgba(2,5,14,0.42)',
    textDisabled: 'rgba(2,5,14,0.3)',
    accent: k1.night,
    accentPressed: k1.deep,
    onAccent: k1.ice,
    accentText: k1.night,
    accentSoft: 'rgba(2,5,14,0.28)',
    danger: k1.coralText,
    dangerSurface: 'rgba(196,100,75,0.12)',
    dangerBorder: 'rgba(196,100,75,0.5)',
    onDanger: '#FFFFFF',
    category: k1.mid,
    inputBackground: 'rgba(255,255,255,0.62)',
    inputBorder: 'rgba(2,5,14,0.16)',
    inputEdge: 'rgba(255,255,255,0.7)',
    scrim: 'rgba(2,5,14,0.5)',
    ...tabColors,
    statusBar: 'dark-content',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: k1.night,
    surface: 'rgba(37,54,73,0.55)',
    surfaceRaised: '#0A111D',
    surfaceMuted: 'rgba(232,238,244,0.1)',
    glass: 'rgba(232,238,244,0.1)',
    border: 'rgba(232,238,244,0.16)',
    borderStrong: 'rgba(232,238,244,0.32)',
    text: k1.ice,
    textSecondary: 'rgba(232,238,244,0.62)',
    textTertiary: 'rgba(232,238,244,0.42)',
    textDisabled: 'rgba(232,238,244,0.3)',
    accent: k1.ice,
    accentPressed: k1.top,
    onAccent: k1.night,
    accentText: k1.ice,
    accentSoft: 'rgba(232,238,244,0.35)',
    danger: k1.coral,
    dangerSurface: 'rgba(226,135,111,0.14)',
    dangerBorder: 'rgba(226,135,111,0.6)',
    onDanger: '#FFFFFF',
    category: k1.mid,
    inputBackground: 'rgba(232,238,244,0.08)',
    inputBorder: 'rgba(232,238,244,0.22)',
    inputEdge: 'rgba(232,238,244,0.22)',
    scrim: 'rgba(2,5,14,0.6)',
    ...tabColors,
    statusBar: 'light-content',
  },
};

export const themes: Record<ThemeName, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};
