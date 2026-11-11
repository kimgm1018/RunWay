import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { AppText, Icon, PressableScale, type IconName } from '../../components';
import { GlassIconButton } from '../../components/GlassIconButton';
import { fontFamily } from '../../theme';

// 그룹런 시안 (S15P31E105-673, RunWay-그룹런-시안-20261111): the group-run screens drawn like 6.7's 완주 현황 table.
// No cards: thin lines between rows, a heavier line under a section, mint Korean labels, a short colour bar before
// a person's or a crew's name, my own row lit in mint, mint pill buttons. 6.7 결과 keeps its own look.
export const stand = {
  page: '#02050E',
  // A bottom sheet over the page.
  sheet: '#0D1422',
  text: '#FFFFFF',
  sub: '#B9C0CA',
  muted: '#8E97A8',
  // Under a section title or a big number, and between two side-by-side figures.
  rule: 'rgba(255,255,255,0.4)',
  // Between rows.
  line: 'rgba(255,255,255,0.12)',
  mint: '#4DFFD2',
  onMint: '#02050E',
  // My own row (and 6.0's 곧 출발): a faint mint with a mint line under it.
  meFill: 'rgba(77,255,210,0.1)',
  meLine: 'rgba(77,255,210,0.5)',
  // Fields, quiet buttons and the round glass buttons.
  field: 'rgba(255,255,255,0.07)',
  glass: 'rgba(255,255,255,0.12)',
  glassLine: 'rgba(255,255,255,0.22)',
  // The rim of an outlined button.
  outline: 'rgba(255,255,255,0.75)',
  // The app's one red (#D44A4A).
  danger: '#D44A4A',
  dangerFill: 'rgba(212,74,74,0.16)',
  // The live metric charts (6.6): pace mint, distance blue, heart red, cadence yellow.
  chart: {
    pace: '#4DFFD2',
    distance: '#4D9BFF',
    heart: '#D44A4A',
    cadence: '#FFD84D',
  },
} as const;

// Everyone in a group run has a colour of their own (담당자 요청: 그룹이니까 색 여러 개): I am mint, each other person
// keeps the colour their id points to, so 6.4, 6.5 and 6.6 agree even though the server lists them in other orders.
// Two people whose ids point to the same colour in one list: the later one takes the next free colour.
export const memberPalette = [
  '#FFD84D',
  '#4D9BFF',
  '#FF7EB6',
  '#B58CFF',
  '#FF9F1C',
] as const;

const preferredColor = (userId: string) => {
  let hash = 2943;
  for (let index = 0; index < userId.length; index++) {
    hash = (hash * 31 + userId.charCodeAt(index) * 7919) % 2147483647;
  }
  return Math.floor(hash / 7) % memberPalette.length;
};

export function memberColors(
  people: readonly { userId: string; isMe: boolean }[],
) {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  // Everyone listed, in id order, so who gets bumped on a clash does not depend on the list's order.
  const others = [
    ...new Set(people.filter(p => !p.isMe).map(p => p.userId)),
  ].sort();
  for (const userId of others) {
    let index = preferredColor(userId);
    for (
      let tries = 0;
      tries < memberPalette.length && taken.has(index);
      tries++
    ) {
      index = (index + 1) % memberPalette.length;
    }
    taken.add(index);
    colors.set(userId, memberPalette[index]);
  }
  for (const person of people) {
    if (person.isMe) {
      colors.set(person.userId, stand.mint);
    }
  }
  return colors;
}

// The bar before a name in 6.6 그룹's standings (S15P31E105-693; 6.7 완주 현황 keeps its state colours): a run takes up to 200
// people, too many for a colour each, so only the first row (선두) is orange and the last (후미) purple, colours the
// screens use for nothing else (mint is me and 완주, red is 중단); everyone else a quiet grey. One row alone is the leader.
export const idleBar = 'rgba(255,255,255,0.2)';
export const leadBar = '#FF9F1C';
export const tailBar = '#B58CFF';

export function standingBarColor(index: number, count: number) {
  if (index === 0) {
    return leadBar;
  }
  return index === count - 1 ? tailBar : idleBar;
}

// A crew's colour, the bar before its name on 6.0 and under a run's title. The screens that name a crew know its
// id but not where it sits in my list, so the colour comes from the id.
const crewPalette = [
  '#FF9F1C',
  '#B58CFF',
  '#4D9BFF',
  '#FFD84D',
  '#FF7EB6',
] as const;

export function crewColor(crewId: string) {
  let hash = 268;
  for (let index = 0; index < crewId.length; index++) {
    hash = (hash * 31 + crewId.charCodeAt(index)) % 1000000007;
  }
  return crewPalette[hash % crewPalette.length];
}

// Korean in the app's Korean font, figures and Latin in Archivo (NumText). The weights of the 시안.
export const standType = StyleSheet.create({
  // 20 screen title beside the back button.
  title: {
    fontFamily: fontFamily.black,
    fontSize: 20,
    lineHeight: 26,
    color: stand.text,
  },
  // A mint section label (코스, 목표 시간, 취소 이유 …).
  label: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.mint,
  },
  // A small mint label over a figure (평균 페이스, 목표 페이스 …).
  smallLabel: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    lineHeight: 18,
    color: stand.mint,
  },
  name: {
    fontFamily: fontFamily.black,
    fontSize: 17,
    lineHeight: 23,
    color: stand.text,
  },
  body: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 21,
    color: stand.text,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: stand.sub,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.muted,
  },
  // A big figure (6’00”) and the unit after it.
  figure: {
    fontFamily: fontFamily.resultBlack,
    color: stand.text,
  },
  unit: {
    fontFamily: fontFamily.numberBold,
    color: stand.sub,
  },
});

// The header of a pushed group screen: the round glass back button and the title on its left.
export function StandHeader({
  title,
  onBack,
  dim = false,
}: {
  title: string;
  onBack: () => void;
  // Under a bottom sheet, faded with the rest of the page.
  dim?: boolean;
}) {
  return (
    <View style={[styles.header, dim && styles.dim]}>
      <GlassIconButton
        icon="back"
        tone="dark"
        diameter={40}
        accessibilityLabel="뒤로"
        onPress={onBack}
      />
      <AppText style={standType.title} accessibilityRole="header">
        {title}
      </AppText>
    </View>
  );
}

// The short colour bar before a name.
export function ColorBar({
  color,
  height = 30,
  style,
}: {
  color: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.bar, { height, backgroundColor: color }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

// A person's round initial in their colour.
export function MemberDot({
  name,
  color,
  size = 32,
  overlap = false,
}: {
  name: string;
  color: string;
  size?: number;
  // In a row of dots each one sits a little over the one before it, with a page-coloured rim.
  overlap?: boolean;
}) {
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        overlap && styles.dotOverlap,
      ]}
    >
      <AppText style={[styles.dotText, { fontSize: size * 0.45 }]}>
        {name.slice(0, 1)}
      </AppText>
    </View>
  );
}

// A small square tag: mint (곧 출발, 오늘, 나), outlined (참가 중, 승인 대기) or red (취소됨).
export function StandTag({
  label,
  tone = 'mint',
  style,
}: {
  label: string;
  tone?: 'mint' | 'outline' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tag, tagTone[tone], style]}>
      <AppText
        style={[
          styles.tagText,
          tone === 'outline' && styles.tagTextOutline,
          tone === 'danger' && styles.tagTextDanger,
        ]}
      >
        {label}
      </AppText>
    </View>
  );
}

// The big round-ended button, 50 high: mint with navy text (the main one), outlined white (the second one), red
// (취소하기, 전체 종료) or a quiet dark one. An icon after the label sits in a small navy circle on mint.
export function StandButton({
  title,
  icon,
  iconBackground,
  tone = 'mint',
  disabled = false,
  onPress,
  onLongPress,
  delayLongPress,
  accessibilityLabel,
  style,
  children,
}: {
  title?: string;
  icon?: IconName;
  // The circle behind the icon in another colour (그룹런 취소하기: a red circle on the white button).
  iconBackground?: string;
  tone?: 'mint' | 'outline' | 'danger' | 'dangerOutline' | 'quiet' | 'white';
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  // A button that cannot be pressed yet is a quiet dark one with grey text, whatever its tone.
  const look = disabled ? buttonTone.disabled : buttonTone[tone];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={[styles.button, look.box, style]}
    >
      {children ?? (
        <View style={styles.buttonContent}>
          <AppText style={[styles.buttonText, look.text]}>{title}</AppText>
          {icon ? (
            <View
              style={[
                styles.buttonIcon,
                look.icon,
                iconBackground ? { backgroundColor: iconBackground } : null,
                disabled && styles.dim,
              ]}
            >
              <Icon
                name={icon}
                color={iconBackground ? stand.text : look.iconColor}
                size={14}
              />
            </View>
          ) : null}
        </View>
      )}
    </PressableScale>
  );
}

// Tabs drawn as words on a line, the picked one bold with a mint line under it (내 크루 · 크루 모집, 코스 러닝 ·
// 자유 러닝, 페이스 · 거리 · 심박 · 케이던스 · 그룹).
export function UnderlineTabs<T extends string>({
  items,
  active,
  onSelect,
  size = 'medium',
  style,
}: {
  items: readonly { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
  size?: 'small' | 'medium';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tabs, style]} accessibilityRole="tablist">
      {items.map(item => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => !selected && onSelect(item.key)}
            style={[styles.tab, selected && styles.tabOn]}
          >
            <AppText
              style={[
                styles.tabText,
                size === 'small' && styles.tabTextSmall,
                selected && styles.tabTextOn,
              ]}
            >
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// A label over a figure, for two or three side by side with a line between them (평균 페이스 | 목표 페이스).
export function FigureColumns({
  items,
  style,
}: {
  items: readonly { label: string; children: React.ReactNode }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.columns, style]}>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.column, index > 0 && styles.columnAfter]}
        >
          <AppText style={standType.smallLabel}>{item.label}</AppText>
          {item.children}
        </View>
      ))}
    </View>
  );
}

// A figure and its unit on one baseline.
export function Figure({
  value,
  unit,
  size,
  color = stand.text,
  style,
}: {
  value: string;
  unit?: string;
  size: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const valueStyle: TextStyle = {
    fontSize: size,
    lineHeight: Math.round(size * 1.24),
    letterSpacing: size >= 40 ? -1.5 : -0.5,
    color,
  };
  const unitSize = Math.max(11, Math.round(size * 0.3));
  return (
    <View style={[styles.figure, style]}>
      <AppText style={[standType.figure, valueStyle]}>{value}</AppText>
      {unit ? (
        <AppText
          style={[
            standType.unit,
            { fontSize: unitSize, lineHeight: Math.round(unitSize * 1.4) },
          ]}
        >
          {unit}
        </AppText>
      ) : null}
    </View>
  );
}

const tagTone = StyleSheet.create({
  mint: { backgroundColor: stand.mint },
  outline: { borderWidth: 1, borderColor: stand.rule },
  danger: { backgroundColor: stand.danger },
});

const buttonTone = {
  mint: {
    box: { backgroundColor: stand.mint },
    text: { color: stand.onMint },
    icon: { backgroundColor: stand.onMint },
    iconColor: stand.text,
  },
  white: {
    box: { backgroundColor: stand.text },
    text: { color: stand.onMint },
    icon: { backgroundColor: stand.onMint },
    iconColor: stand.text,
  },
  outline: {
    box: { borderWidth: 1, borderColor: stand.outline },
    text: { color: stand.text },
    icon: { backgroundColor: stand.text },
    iconColor: stand.onMint,
  },
  danger: {
    box: { backgroundColor: stand.danger },
    text: { color: stand.onMint },
    icon: { backgroundColor: stand.text },
    iconColor: stand.danger,
  },
  dangerOutline: {
    box: {
      backgroundColor: stand.dangerFill,
      borderWidth: 1.5,
      borderColor: stand.danger,
    },
    text: { color: stand.text },
    icon: { backgroundColor: stand.text },
    iconColor: stand.danger,
  },
  quiet: {
    box: { backgroundColor: 'rgba(255,255,255,0.1)' },
    text: { color: stand.text },
    icon: { backgroundColor: stand.danger },
    iconColor: stand.text,
  },
  disabled: {
    box: { backgroundColor: 'rgba(255,255,255,0.1)' },
    text: { color: stand.muted },
    icon: { backgroundColor: stand.danger },
    iconColor: stand.text,
  },
} as const;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
  },
  dim: { opacity: 0.45 },
  bar: { width: 4 },
  dot: { alignItems: 'center', justifyContent: 'center' },
  dotOverlap: { marginLeft: -6, borderWidth: 1.5, borderColor: stand.page },
  dotText: { fontFamily: fontFamily.black, color: stand.onMint },
  tag: {
    alignSelf: 'flex-start',
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 4,
    justifyContent: 'center',
  },
  tagText: {
    fontFamily: fontFamily.black,
    fontSize: 12,
    lineHeight: 16,
    color: stand.onMint,
  },
  tagTextOutline: { color: stand.sub },
  tagTextDanger: { color: stand.onMint },
  button: {
    height: 50,
    borderRadius: 25,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttonText: { fontFamily: fontFamily.black, fontSize: 16, lineHeight: 21 },
  buttonIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  tab: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabOn: { borderBottomColor: stand.mint },
  tabText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: stand.muted,
  },
  tabTextSmall: { fontSize: 14, lineHeight: 19 },
  tabTextOn: { fontFamily: fontFamily.black, color: stand.text },
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flex: 1, gap: 2 },
  columnAfter: {
    borderLeftWidth: 1,
    borderLeftColor: stand.rule,
    paddingLeft: 24,
  },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
});
