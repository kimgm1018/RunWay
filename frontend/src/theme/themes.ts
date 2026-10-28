import { palette } from './tokens';

export type ThemeName = 'dark' | 'light';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  // Lighter mint for secondary bars (2.1 러닝 분석).
  accentSoft: string;
  danger: string;
  dangerSurface: string;
  dangerBorder: string;
  onDanger: string;
  category: string;
  inputBackground: string;
  inputBorder: string;
  scrim: string;
  tabBar: string;
  tabBarBorder: string;
  tabActive: string;
  tabIconActive: string;
  tabInactive: string;
  statusBar: 'light-content' | 'dark-content';
};

export type Theme = { name: ThemeName; colors: ThemeColors };

// Dark follows 2.1 홈 and 6.0 그룹; light follows 2.1La 홈 라이트 and 7.1 커뮤니티.
export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    background: palette.night,
    surface: 'rgba(22,24,31,0.62)',
    surfaceRaised: palette.card,
    surfaceMuted: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    text: palette.white,
    textSecondary: 'rgba(255,255,255,0.7)',
    textTertiary: 'rgba(255,255,255,0.55)',
    textDisabled: 'rgba(255,255,255,0.4)',
    accent: palette.mint,
    accentPressed: palette.mintPressed,
    onAccent: palette.ink,
    accentText: palette.mint,
    accentSoft: 'rgba(167,246,236,0.45)',
    danger: palette.coral,
    dangerSurface: 'rgba(255,158,138,0.12)',
    dangerBorder: 'rgba(255,158,138,0.5)',
    onDanger: palette.ink,
    category: palette.lavender,
    inputBackground: 'rgba(255,255,255,0.08)',
    inputBorder: 'rgba(255,255,255,0.28)',
    scrim: 'rgba(5,6,8,0.72)',
    tabBar: 'rgba(20,22,29,0.92)',
    tabBarBorder: 'rgba(255,255,255,0.14)',
    tabActive: 'rgba(255,255,255,0.14)',
    tabIconActive: palette.mint,
    tabInactive: 'rgba(255,255,255,0.78)',
    statusBar: 'light-content',
  },
};

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: palette.paper,
    surface: 'rgba(255,255,255,0.9)',
    surfaceRaised: palette.white,
    surfaceMuted: palette.lavenderGray,
    border: palette.lineSoft,
    borderStrong: palette.line,
    text: palette.ink,
    textSecondary: 'rgba(22,40,72,0.8)',
    textTertiary: palette.sub,
    textDisabled: palette.pale,
    accent: palette.mint,
    accentPressed: palette.mintPressed,
    onAccent: palette.ink,
    accentText: palette.mintText,
    accentSoft: 'rgba(79,208,191,0.35)',
    danger: palette.coralStrong,
    dangerSurface: 'rgba(255,138,115,0.12)',
    dangerBorder: 'rgba(255,138,115,0.5)',
    onDanger: palette.ink,
    category: palette.periwinkle,
    inputBackground: palette.white,
    inputBorder: palette.line,
    scrim: 'rgba(25,28,39,0.45)',
    tabBar: 'rgba(20,22,29,0.92)',
    tabBarBorder: 'rgba(255,255,255,0.14)',
    tabActive: 'rgba(255,255,255,0.14)',
    tabIconActive: palette.mint,
    tabInactive: 'rgba(255,255,255,0.78)',
    statusBar: 'dark-content',
  },
};

export const themes: Record<ThemeName, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};
