import React, { useId } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  AppText,
  Backdrop,
  Icon,
  type IconName,
  MistFill,
  PressableScale,
} from '../../components';
import { fontFamily, typography } from '../../theme';

// runway-group-handoff tokens.css (S15P31E105-414): the look the 6 그룹 screens share. Grain is left out as on
// the other handoff screens (담당자 결정).
export const groupLook = {
  // --bg-analysis-dark (6.0~6.3).
  darkBackground: [
    '#1A2E39',
    '#0D171F',
    '#060606',
    '#091019',
    '#182E3D',
    '#3A5A6C',
  ],
  darkBackgroundStops: [0, 0.12, 0.3, 0.55, 0.8, 1],
  navy: '#02050E',
  onDark: '#FFFFFF',
  onDarkSub: 'rgba(255,255,255,0.6)',
  onDarkMuted: 'rgba(255,255,255,0.45)',
  // Crew initial tiles and the round buttons on the dark screens.
  darkFill: 'rgba(255,255,255,0.12)',
  darkButton: 'rgba(255,255,255,0.1)',
  // A run's left line: today in white, later runs faint.
  lineToday: '#FFFFFF',
  lineLater: 'rgba(255,255,255,0.3)',
  // Text on the light screens (6.4 · 6.4c · 6.5 · 6.8 upper part, 6.6 · 6.6r · 6.9 map, and the mist
  // screens 6.0~6.3, S15P31E105-483).
  onLight: '#02050E',
  onLightSub: '#56646C',
  onLightSub2: '#3A5A6C',
  onLightMuted: 'rgba(2,5,14,0.45)',
  // Initial tiles and round buttons on the mist screens (6.0~6.3).
  lightFill: 'rgba(2,5,14,0.07)',
  lightButton: 'rgba(255,255,255,0.55)',
  // A run's left line on 6.0's white crew cards (S15P31E105-563): today in navy, later runs faint.
  lineTodayOnLight: '#02050E',
  lineLaterOnLight: 'rgba(2,5,14,0.2)',
  // The white page of 6.2 · 6.4c · 6.5 · 6.8 and the grey band between its parts (S15P31E105-563, 담당자 결정).
  page: '#FFFFFF',
  // The mint of runway-group-screen-designs (S15P31E105-594), the home's mint too: only on the small marks
  // (chips, +, 참가 중, picked small chips), with navy text on it; big buttons stay dark navy (담당자 요청).
  mint: '#4DFFD2',
  onMint: '#02050E',
  band: '#EEF1F4',
  // --bg-common (6.4 · 6.4c · 6.5 · 6.8 · 6.6c): white for the top third, then down to navy.
  commonBackground: [
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
  commonBackgroundStops: [
    0, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
    1,
  ],
  // --bg-course (6.7): dark at the top through steel blue to near white.
  courseBackground: [
    '#1A2E39',
    '#0D171F',
    '#06080B',
    '#060606',
    '#060709',
    '#091019',
    '#182E3D',
    '#3A5A6C',
    '#5D8194',
    '#7599AB',
    '#7DA0B2',
    '#7DA0B2',
    '#81A3B3',
    '#8DACBA',
    '#A4BDC9',
    '#C4D4DC',
    '#E2EAEE',
    '#F3F5F6',
    '#F8F8F8',
    '#F9F9F9',
  ],
  courseBackgroundStops: [
    0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.65, 0.7,
    0.75, 0.8, 0.85, 0.9, 0.95, 1,
  ],
  // The light map behind 6.4 · 6.6 · 6.6r · 6.9.
  mapBackground: '#F3F5F6',
  // --warn: the 취소 icon circle only (6.4c).
  warn: '#F15066',
  // --cta-navy-bg (6.7 bottom buttons) as a plain fill, see the Svg alpha note below.
  ctaNavy: 'rgba(14,26,34,0.93)',
} as const;

// runway-group-screen-designs in the home tone (S15P31E105-594 담당자 결정 2026-11-10: 진한 네이비 배경, 지금 디자인과
// 일관된 톤): the home card navy page, faint white cards, white text, white big buttons, mint only on small marks
// and the watch's red pink for 해산 · 취소 · 내보내기.
export const groupTone = {
  // The page: the home card's and the tab bar's navy.
  page: '#02050E',
  // A bottom sheet over it, a step lighter so it stands apart from the page.
  sheet: '#0E1621',
  // A card on it: a faint white like the panels inside the home card, with a faint white rim.
  card: 'rgba(255,255,255,0.07)',
  cardLine: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF',
  sub: 'rgba(255,255,255,0.68)',
  muted: 'rgba(255,255,255,0.45)',
  line: 'rgba(255,255,255,0.12)',
  // A field or a row inside a card.
  inner: 'rgba(255,255,255,0.08)',
  // Big buttons: white with navy text, like the home's 러닝 결과 보기 (담당자 요청: 큰 버튼에 민트 X).
  button: '#FFFFFF',
  onButton: '#02050E',
  // Mint only on the small marks (chips, +, 나, toggles, bars), navy text on it.
  accent: groupLook.mint,
  onAccent: groupLook.onMint,
  accentSoft: 'rgba(77,255,210,0.16)',
  // A quiet chip or secondary button.
  quiet: 'rgba(255,255,255,0.14)',
  // The watch's warning red pink toned down (wear RunwayTheme Warning #FF5C7A, a little redder and softer, kept as vivid as the mint so the two read as one set: 담당자 요청 '톤 낮춰줘' · '약간 붉은 톤' · '민트랑 톤 맞게') for
  // 해산 · 취소 · 내보내기 · 종료, with a faint fill of it behind its icons.
  danger: '#F15066',
  dangerSoft: 'rgba(241,80,102,0.16)',
} as const;

const recipes = {
  // --raised-white-*: white pills and the picked segment on dark screens.
  white: {
    colors: ['#FFFFFF', '#F3F5F6', '#E2EAEE'],
    offsets: [0, 0.55, 1],
    fill: '#F3F5F6',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,1), inset 0 -1.5px 3px rgba(93,129,148,0.16), 0 4px 12px rgba(0,0,0,0.18)',
  },
  // The cards of 6.0 and 6.1 (S15P31E105-563): a softer white than the pills, so they lift off the mist
  // without looking like buttons (담당자 요청): an almost flat white, a faint top light, no inner shade and a
  // low, light drop.
  card: {
    colors: ['#FFFFFF', '#FCFDFD', '#F4F7F9'],
    offsets: [0, 0.55, 1],
    fill: '#FCFDFD',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 10px rgba(30,45,60,0.08)',
  },
  // The navy bottom button of 6.2 and 6.4 (GroupCta navy, S15P31E105-563): plain navy, no gradient or edge
  // light; GroupCta gives it a short drop.
  navyFlat: {
    colors: null,
    fill: '#02050E',
    boxShadow: 'none',
  },
  // The mint main button and picked tab (S15P31E105-594): flat mint, no gradient.
  mintFlat: {
    colors: null,
    fill: '#4DFFD2',
    boxShadow: 'none',
  },
  // A card on the navy page (S15P31E105-594): a faint white with a faint white rim, flat.
  night: {
    colors: null,
    fill: 'rgba(255,255,255,0.07)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
  },
  // The big white button on the navy page.
  whiteFlat: {
    colors: null,
    fill: '#FFFFFF',
    boxShadow: 'none',
  },
  // A quiet secondary button on the navy page.
  quietFlat: {
    colors: null,
    fill: 'rgba(255,255,255,0.14)',
    boxShadow: 'none',
  },
  // --raised-navy-*: navy pills and the picked segment on light screens.
  navy: {
    colors: ['#1A2E39', '#091019', '#02050E'],
    offsets: [0, 0.55, 1],
    fill: '#091019',
    boxShadow:
      'inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -2px 4px rgba(0,0,0,0.3), 0 4px 12px rgba(2,5,14,0.25)',
  },
  // Mint accent pills on 6.2 (S15P31E105-563): K1 mint with navy text on it.
  mint: {
    colors: ['#C4FBF4', '#A7F6EC', '#8DE8DB'],
    offsets: [0, 0.55, 1],
    fill: '#A7F6EC',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1.5px 3px rgba(20,128,111,0.18), 0 4px 12px rgba(20,128,111,0.2)',
  },
  // --raised-dark-glass-*: see-through pills on dark screens. An Svg stop drops an rgba colour's alpha on
  // Android (the pill came out solid white), so this one is the gradient's middle as a plain fill.
  darkGlass: {
    colors: null,
    fill: 'rgba(255,255,255,0.11)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.3)',
  },
} as const;

export type RaisedTone = keyof typeof recipes;

// A pill or segment that looks raised: the recipe's gradient behind its content, with its shadows. Text on a
// white one is navy (groupLook.navy), on a dark glass one white. The gradient draws only once MistFill has
// measured the pill, so the fill colour sits underneath: a newly picked tab is never an empty outline.
export function Raised({
  tone,
  style,
  children,
}: {
  tone: RaisedTone;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  // Svg gradient ids are global on Android, so every pill gets its own.
  const id = `raised${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const recipe = recipes[tone];
  return (
    <View
      style={[
        styles.raised,
        { boxShadow: recipe.boxShadow, backgroundColor: recipe.fill },
        style,
      ]}
    >
      {recipe.colors ? (
        <MistFill
          id={id}
          colors={[...recipe.colors]}
          offsets={[...recipe.offsets]}
        />
      ) : null}
      {children}
    </View>
  );
}

// --inset-track-dark: the pressed-in track under a segmented switch on dark screens.
export const insetTrackDark =
  'inset 0 1px 3px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.08)';

// --inset-track-light: the pressed-in track under a segmented switch on light screens.
export const insetTrackLight =
  'inset 0 1px 3px rgba(30,45,60,0.12), inset 0 -1px 0 rgba(255,255,255,0.7)';

const backgrounds = {
  dark: [groupLook.darkBackground, groupLook.darkBackgroundStops],
  common: [groupLook.commonBackground, groupLook.commonBackgroundStops],
  course: [groupLook.courseBackground, groupLook.courseBackgroundStops],
} as const;

// A whole screen's gradient: dark (--bg-analysis-dark, 6.0~6.3), common (--bg-common, 6.4 · 6.4c · 6.5 ·
// 6.8 · 6.6c) or course (--bg-course, 6.7). Put it first inside the screen's root view.
export function GroupBackground({
  id,
  kind,
}: {
  id: string;
  kind: keyof typeof backgrounds;
}) {
  const [colors, offsets] = backgrounds[kind];
  return <MistFill id={id} colors={[...colors]} offsets={[...offsets]} />;
}

// The mist behind a whole screen (6.0~6.3, S15P31E105-483), as on 홈 and 러닝. It replaced --bg-analysis-dark
// so moving between the tabs keeps one background.
// runway-group-screen-designs (S15P31E105-594 담당자 결정 2026-11-10: 배경은 시안처럼 진한 네이비): the home card's
// navy behind every group screen but the intro.
export function NightBackground() {
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: groupTone.page }]}
      pointerEvents="none"
    />
  );
}

export function MistBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Backdrop />
    </View>
  );
}

// A section title in place of a card: a 1.5px line on its left. 6.0~6.3 (dark) use 15px; the light
// screens use 13px with a navy line, or white on their dark lower part.
export function SectionLabel({
  children,
  tone = 'dark',
  large = false,
  lineColor,
  style,
}: {
  children: React.ReactNode;
  // mist: the 15px label of 6.0~6.3 in navy on the mist (S15P31E105-483).
  tone?: 'dark' | 'light' | 'lightOnDark' | 'mist';
  // 18 instead of 15, for 6.2's bigger text (S15P31E105-563).
  large?: boolean;
  // The left line in another colour than the text (6.2's mint, S15P31E105-563).
  lineColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const color =
    tone === 'light' || tone === 'mist' ? groupLook.onLight : groupLook.onDark;
  return (
    <View
      style={[styles.label, { borderLeftColor: lineColor ?? color }, style]}
    >
      <AppText
        style={[
          styles.labelText,
          tone !== 'dark' && tone !== 'mist' && styles.labelTextSmall,
          large && styles.labelTextLarge,
          { color },
        ]}
        accessibilityRole="header"
      >
        {children}
      </AppText>
    </View>
  );
}

// The big bottom button (6.2 · 6.3 · 6.4 · 6.4c · 6.5 · 6.8): a raised white pill, 54 high, with a navy
// circle icon after its label. A secondary one is dark glass without the circle, or navy on the mist screens
// (6.2 · 6.3), where dark glass would not show. navy (6.4 on the mist, S15P31E105-563) turns it round: the
// primary is a navy pill with a white circle icon, like 6.0's 대기방 입장, and the secondary a white one.
export function GroupCta({
  title,
  icon,
  primary = true,
  disabled = false,
  onMist = false,
  navy = false,
  onPress,
}: {
  title: string;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  onMist?: boolean;
  navy?: boolean;
  onPress: () => void;
}) {
  // White text on every secondary (navy: a quiet white on the navy page).
  const navyFill = !primary;
  // navy: on the navy page (S15P31E105-594) a white primary with navy text, like the home's buttons, and a quiet
  // see-through secondary.
  const tone: RaisedTone = navy
    ? primary
      ? 'whiteFlat'
      : 'quietFlat'
    : primary
    ? 'white'
    : onMist
    ? 'navy'
    : 'darkGlass';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <Raised
        tone={tone}
        style={[styles.cta, primary && !navy && { boxShadow: ctaShadow }]}
      >
        {/* Disabled dims the label only: the button floats over the list, which must not show through. */}
        <View style={[styles.ctaContent, disabled && styles.disabled]}>
          <AppText style={[navyFill ? styles.ctaTextGlass : styles.ctaText]}>
            {title}
          </AppText>
          {primary && icon ? (
            <View style={styles.ctaIcon}>
              <Icon name={icon} color={groupLook.onDark} size={14} />
            </View>
          ) : null}
        </View>
      </Raised>
    </PressableScale>
  );
}

// The crew card shared by 6.0 내 크루 and 6.1 크루 모집, so both read the same (담당자 요청): the raised
// white card of 6.0's 곧 출발 (S15P31E105-563; put card on <Raised tone="card">), a 21 navy name, 13 small
// lines 10 under or over it and 34 dark navy round buttons with white icons on the right.
// A full-width part of a white page under a 10 grey band (6.2 · 6.4c · 6.5 · 6.8): the band is its top border, so
// there are no cards or lines, only the band and the part's label.
export const groupPage = StyleSheet.create({
  page: { backgroundColor: groupLook.page },
  block: {
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderTopWidth: 10,
    borderTopColor: groupLook.band,
  },
});

export const crewCard = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 20,
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.4,
    color: groupLook.onLight,
  },
  small: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  lineGap: { marginTop: 10 },
  round: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: groupLook.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// The search field of 6.0 and 6.1, opened from the round search button beside the tabs (담당자 요청):
// as tall as the round buttons, a light glass field on the mist, with a round close button.
export function SearchField({
  label,
  value,
  onChangeText,
  onClose,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.searchRow}>
      <View style={styles.search}>
        <Icon name="search" color={groupTone.sub} size={16} />
        <TextInput
          accessibilityLabel={label}
          placeholder="크루 이름이나 지역으로 검색"
          placeholderTextColor={groupTone.muted}
          selectionColor={groupTone.accent}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
          autoFocus
          style={styles.searchInput}
        />
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="검색 닫기"
        onPress={onClose}
        style={[crewCard.round, styles.roundOnNight]}
      >
        <Icon name="close" color={groupTone.text} size={16} />
      </PressableScale>
    </View>
  );
}

// --cta-shadow: deeper than a small white pill.
const ctaShadow =
  'inset 0 1px 0 rgba(255,255,255,1), inset 0 -2px 4px rgba(93,129,148,0.18), 0 12px 28px rgba(0,0,0,0.38)';

const styles = StyleSheet.create({
  raised: { overflow: 'hidden' },
  label: {
    borderLeftWidth: 1.5,
    borderLeftColor: groupLook.onDark,
    paddingLeft: 8,
  },
  labelText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 19,
    color: groupLook.onDark,
  },
  labelTextSmall: { fontSize: 13, lineHeight: 17 },
  labelTextLarge: { fontSize: 18, lineHeight: 23 },
  cta: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.navy,
  },
  ctaTextGlass: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onDark,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: groupLook.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: groupTone.card,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
  },
  roundOnNight: { backgroundColor: groupTone.quiet },
  searchInput: {
    flex: 1,
    height: 40,
    fontFamily: typography.input.fontFamily,
    fontSize: 14,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: groupTone.text,
  },
  disabled: { opacity: 0.45 },
});

// The digits of a line in the app's figure font (Archivo, S15P31E105-662), the words around them in the app's Korean
// font, which Archivo has no letters for. D-4, 11.14 07:00, 18/30, 6′10″ and the
// like are one run each.
const numberRun = /(D-\d+|\d[\d:.,/′″'"+-]*)/;

export function NumText({
  text,
  style,
  numberStyle,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  // On top of the figure font's SemiBold: a size or colour of the digits' own.
  numberStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const parts = text.split(numberRun);
  // The digits keep the line's colour (AppText would set its own) at the line's size: Archivo's figures already
  // stand as tall as the Korean letters, so they are no longer drawn larger as Rajdhani's were.
  const line = StyleSheet.flatten(style) ?? {};
  const own: TextStyle = line.color ? { color: line.color } : {};
  return (
    <AppText style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <AppText key={index} style={[numStyles.number, own, numberStyle]}>
            {part}
          </AppText>
        ) : (
          part
        ),
      )}
    </AppText>
  );
}

const numStyles = StyleSheet.create({
  number: { fontFamily: fontFamily.numberSemiBold, letterSpacing: 0 },
});
