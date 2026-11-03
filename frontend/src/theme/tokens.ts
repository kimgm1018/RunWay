// New design (DESIGN.md 1-1): one K1 screen, light blue-grey at the top fading to black at the bottom.
export const k1 = {
  top: '#C1CEDB',
  light: '#B3C4D3',
  mid: '#8096AF',
  deep: '#253649',
  night: '#02050E',
  black: '#000000',
  // Text and solid buttons on the black part.
  ice: '#E8EEF4',
  coral: '#E2876F',
  // Coral text on light backgrounds and white cards.
  coralText: '#C4644B',
  // Grey fields and round buttons inside the white map sheets (DESIGN.md 2-6).
  field: '#EDF1F5',
} as const;

// 2.1 홈 cards (DESIGN.md 1-2, S15P31E105-367 핸드오프 tokens.css): sky blue accents on black, off-white,
// greige and graphite cards. No other screen uses them.
export const homePalette = {
  accent: '#3FA9F5',
  accentLight: '#B9E0FB',
  ink: '#111111',
  header: '#0B1418',
  sub: '#56646C',
  muted: '#8A8A8A',
  unit: '#6A6A6A',
  unread: '#E2553F',
  headerButton: 'rgba(255,255,255,0.55)',
  avatar: '#2A3238',
  cardBlack: '#0B0B0B',
  cardWhite: '#FFFFFF',
  cardGraphite: '#3A3A3A',
  cardGreige: ['#E8E4E0', '#DBD7D3', '#CBCAC9', '#B9BEC5'],
  greigeShade: '#A09A94',
  conditionDisc: ['#F2F9FE', '#D3EBFC', '#A6D6F8', '#8AC7F4'],
  barRest: '#E6E6E4',
  recordsPanel: ['#8F8C89', '#8C9399', '#7FADD2', '#93BFE0'],
  courseGlow: ['#2F9BF0', '#7CC6F7', '#D6ECFA', '#ECEBE8'],
  // The ↗ circle of a card that opens a screen.
  tapHintOnLight: 'rgba(17,17,17,0.06)',
  tapHintOnDark: 'rgba(255,255,255,0.12)',
  shadowLight: '0 12px 30px rgba(0,0,0,0.12)',
  shadowDark:
    'inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 30px rgba(0,0,0,0.2)',
  shadowGraphite: '0 12px 30px rgba(0,0,0,0.2)',
} as const;

// The K1 background, top to bottom (DESIGN.md 1-1): white to 35%, then one even darkening
// through the K1 blue-greys to the darkest navy, sampled every 5% so the steps do not show.
export const k1Gradient = {
  colors: [
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#FFFFFF',
    '#F6F8FA',
    '#ECF0F4',
    '#E1E8EE',
    '#D4DEE7',
    '#C7D4DF',
    '#B1C1D1',
    '#96A9BE',
    '#7A90A8',
    '#566A80',
    '#36485D',
    '#1D2C3D',
    '#0B1522',
    '#02050E',
  ],
  locations: Array.from({ length: 21 }, (_, index) => index / 20),
} as const;

// Prototype v15 colors. Screens still reading these move to the K1 theme one by one (S15P31E105-206).
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
  // 2.1 홈: the readiness score in dots and the figures in records.
  score: 'Doto-Black',
  mono: 'IBMPlexMono-Regular',
  monoMedium: 'IBMPlexMono-Medium',
} as const;

// Android picks a weight by file, so each variant names its family instead of setting fontWeight.
export const typography = {
  display: { fontFamily: fontFamily.black, fontSize: 27, lineHeight: 35 },
  title: { fontFamily: fontFamily.black, fontSize: 22, lineHeight: 29 },
  heading: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 24 },
  // Buttons and segments use the medium weight (DESIGN.md 4).
  button: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 20 },
  buttonSmall: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18 },
  bodyMedium: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20 },
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
  // Kit boxes (DESIGN.md 2-7).
  card: 28,
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
  // Tab screens keep tabBar + tabBarInset × 2 = 116 free at the bottom (DESIGN.md 2-3).
  tabBar: 76,
  tabBarInset: 20,
  tabCircle: 40,
} as const;

export type TypographyVariant = keyof typeof typography;
