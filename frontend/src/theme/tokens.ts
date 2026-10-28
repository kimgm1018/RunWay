// Values copied from RUNWAY 프로토타입 v15. Replace values here when the RUNWAY design draft (S15P31E105-89) lands.
export const palette = {
  ink: '#191C27',
  night: '#0B0C10',
  black: '#050608',
  card: '#16181F',
  navy: '#162033',
  slate: '#2B2F3D',
  sub: '#6B7186',
  pale: '#A8ADC1',
  line: '#D1D4E1',
  lineSoft: '#E2E4EC',
  paper: '#F2F3F7',
  lavenderGray: '#EFEFF7',
  white: '#FFFFFF',
  mint: '#A7F6EC',
  mintPressed: '#8DE8DB',
  mintDeep: '#4FD0BF',
  mintText: '#14806F',
  coral: '#FF9E8A',
  coralStrong: '#FF8A73',
  coralSoft: '#FFD3C8',
  lavender: '#C9B8FF',
  periwinkle: '#C3C6F4',
  // 1.7 워치 연결: the drawn watch's metal bezel and its face glow (connected / not).
  metalLight: '#A8ADB8',
  metal: '#4A4E58',
  metalDark: '#16181D',
  faceGlow: '#123230',
  faceOff: '#24262C',
  // 2.0·2.8 music service marks.
  melon: '#00CD3C',
  spotify: '#1ED760',
} as const;

export const fontFamily = {
  regular: 'NotoSansKR-Regular',
  medium: 'NotoSansKR-Medium',
  bold: 'NotoSansKR-Bold',
  black: 'NotoSansKR-Black',
  numberRegular: 'Barlow-Regular',
  numberMedium: 'Barlow-Medium',
  numberSemiBold: 'Barlow-SemiBold',
  numberBold: 'Barlow-Bold',
} as const;

// Android picks a weight by file, so each variant names its family instead of setting fontWeight.
export const typography = {
  display: { fontFamily: fontFamily.black, fontSize: 27, lineHeight: 35 },
  title: { fontFamily: fontFamily.black, fontSize: 22, lineHeight: 29 },
  heading: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 24 },
  button: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.bold, fontSize: 14, lineHeight: 20 },
  body: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21 },
  input: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 18 },
  captionStrong: { fontFamily: fontFamily.bold, fontSize: 12, lineHeight: 18 },
  label: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 14 },
  labelStrong: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14 },
  metricHero: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 56,
    lineHeight: 56,
  },
  metricLarge: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 26,
    lineHeight: 30,
  },
  metric: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 20,
    lineHeight: 24,
  },
  metricSmall: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 13,
    lineHeight: 16,
  },
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  xxxl: 24,
  screen: 16,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 22,
  sheet: 28,
  pill: 999,
} as const;

export const size = {
  buttonLarge: 56,
  buttonMedium: 48,
  buttonSmall: 36,
  input: 52,
  iconButton: 40,
  header: 56,
  tabBar: 62,
  tabBarInset: 14,
} as const;

export type TypographyVariant = keyof typeof typography;
