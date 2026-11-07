import React, { useId } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  AppText,
  Backdrop,
  Icon,
  MistFill,
  type IconName,
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
  // The crew cards stay navy on the mist (S15P31E105-483 탭 색 흐름 리뷰).
  crewCardNavy: '#0C1822',
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
  warn: '#E2876F',
  // --cta-navy-bg (6.7 bottom buttons) as a plain fill, see the Svg alpha note below.
  ctaNavy: 'rgba(14,26,34,0.93)',
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
  // --raised-navy-*: navy pills and the picked segment on light screens.
  navy: {
    colors: ['#1A2E39', '#091019', '#02050E'],
    offsets: [0, 0.55, 1],
    fill: '#091019',
    boxShadow:
      'inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -2px 4px rgba(0,0,0,0.3), 0 4px 12px rgba(2,5,14,0.25)',
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
  style,
}: {
  children: React.ReactNode;
  // mist: the 15px label of 6.0~6.3 in navy on the mist (S15P31E105-483).
  tone?: 'dark' | 'light' | 'lightOnDark' | 'mist';
  style?: StyleProp<ViewStyle>;
}) {
  const color =
    tone === 'light' || tone === 'mist' ? groupLook.onLight : groupLook.onDark;
  return (
    <View style={[styles.label, { borderLeftColor: color }, style]}>
      <AppText
        style={[
          styles.labelText,
          tone !== 'dark' && tone !== 'mist' && styles.labelTextSmall,
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
// (6.2 · 6.3), where dark glass would not show.
export function GroupCta({
  title,
  icon,
  primary = true,
  disabled = false,
  onMist = false,
  onPress,
}: {
  title: string;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  onMist?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.ctaPressed}
    >
      <Raised
        tone={primary ? 'white' : onMist ? 'navy' : 'darkGlass'}
        style={[styles.cta, primary && { boxShadow: ctaShadow }]}
      >
        {/* Disabled dims the label only: the button floats over the list, which must not show through. */}
        <View style={[styles.ctaContent, disabled && styles.disabled]}>
          <AppText style={primary ? styles.ctaText : styles.ctaTextGlass}>
            {title}
          </AppText>
          {primary && icon ? (
            <View style={styles.ctaIcon}>
              <Icon name={icon} color={groupLook.onDark} size={14} />
            </View>
          ) : null}
        </View>
      </Raised>
    </Pressable>
  );
}

// The crew card shared by 6.0 내 크루 and 6.1 크루 모집, so both read the same (담당자 요청): a navy card on
// the mist (S15P31E105-483), a 21 name, 13 small lines 10 under or over it and 34 round buttons on the right.
export const crewCard = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 20,
    backgroundColor: groupLook.crewCardNavy,
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.3), 0 8px 20px rgba(2,5,14,0.2)',
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.4,
    color: groupLook.onDark,
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
    backgroundColor: groupLook.darkButton,
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
        <Icon name="search" color={groupLook.onLightSub} size={16} />
        <TextInput
          accessibilityLabel={label}
          placeholder="크루 이름이나 지역으로 검색"
          placeholderTextColor={groupLook.onLightMuted}
          selectionColor={groupLook.onLight}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
          autoFocus
          style={styles.searchInput}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="검색 닫기"
        onPress={onClose}
        style={({ pressed }) => [
          crewCard.round,
          styles.roundOnLight,
          pressed && styles.ctaPressed,
        ]}
      >
        <Icon name="close" color={groupLook.onLight} size={16} />
      </Pressable>
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
  ctaPressed: { transform: [{ scale: 0.98 }] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: groupLook.lightButton,
    boxShadow: insetTrackLight,
  },
  roundOnLight: {
    backgroundColor: groupLook.lightButton,
    boxShadow: '0 2px 6px rgba(30,45,60,0.12)',
  },
  // No lineHeight: on Android it clips the top of the placeholder in a single-line input. Without the
  // font's extra top padding the text sits centred in the 34 field.
  searchInput: {
    flex: 1,
    height: 34,
    fontFamily: typography.input.fontFamily,
    fontSize: 14,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: groupLook.onLight,
  },
  disabled: { opacity: 0.45 },
});
