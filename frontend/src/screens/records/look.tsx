import React from 'react';
import {
  Animated,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon, type IconName } from '../../components';
import { fontFamily, size } from '../../theme';
import { StartBackdrop } from '../onboarding/StartScreen';
import { BackButton } from '../../components/BackButton';
import { GlassIconButton } from '../../components/GlassIconButton';

// runway-records (S15P31E105-465, 2차 -485): the look 5.1 · 5.2 · 5.3 share. The layout is the handoff's 390×844
// frame: title at 46 (30 / 800), 24 from the sides, on the 1.1 background with its runner. Tabs and buttons are
// light glass with navy text; the content cards are a grey frost with white text (onCard).
export const recordsLook = {
  ink: '#02050E',
  sub: '#56646C',
  muted: '#8A979E',
  bar: '#3A5A6C',
  glass: 'rgba(255,255,255,0.5)',
  glassRim: 'rgba(255,255,255,0.6)',
  glassShadow:
    '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
  side: 24,
  // Text on the frost cards (runway-records 2차).
  onCard: '#FFFFFF',
  onCardLabel: 'rgba(255,255,255,0.88)',
  onCardSub: 'rgba(255,255,255,0.75)',
  onCardMuted: 'rgba(255,255,255,0.72)',
  onCardLine: 'rgba(255,255,255,0.25)',
  // 2.1 홈's one accent on the navy card (S15P31E105-594 담당자 결정): mint, the feed's route colour.
  mint: '#4DFFD2',
} as const;

// The 1.1 background with its runner (담당자 결정: 시안대로 사진, 1.1과 같은 배경). The mockup sees the runner
// through blurred glass; without a backdrop blur the photo itself is blurred, so the white text stays readable.
export function RecordsBackdrop() {
  return <StartBackdrop blur={14} />;
}

export const glassCard: ViewStyle = {
  borderWidth: 1,
  borderColor: recordsLook.glassRim,
  backgroundColor: recordsLook.glass,
  boxShadow: recordsLook.glassShadow,
};

// The content cards (runway-records 2차): a grey frost over the runner, 26 round, white text inside.
export const frostCard: ViewStyle = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.22)',
  backgroundColor: 'rgba(132,144,151,0.34)',
  borderRadius: 26,
  boxShadow: '0 30px 70px rgba(0,0,0,0.22)',
};

// The one frame of 5.1 · 5.2 · 5.3 (담당자 결정: 상단 탭 · 가운데 카드 · 하단 탭 위치와 크기 동일). The title row, the
// top tabs (16 from the sides; 5.1's dates 62 high, the thin tabs of 5.2 · 5.3 44, 담당자 결정), the frost card from 12 under the tabs to 12 over the bottom bar, and the
// bottom bar's place (64 high, 16 in) for 5.2's buttons. The card's content scrolls inside it when it is long.
export const recordsFrame = {
  side: 16,
  // 5.1's (and 2.1's) week strip: capsule days with room for the ring, then the legend (S15P31E105-657).
  tabsHeight: 114,
  thinTabsHeight: 44,
  gap: 12,
} as const;

export function RecordsShell({
  title,
  onBack,
  right,
  tabs,
  children,
  footer,
  after,
  cardStyle,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  tabs: React.ReactNode;
  children: React.ReactNode;
  // 5.2's buttons, where the tab bar sits on 5.1 and 5.3.
  footer?: React.ReactNode;
  // Pickers, menus and their scrims, over everything.
  after?: React.ReactNode;
  // 5.3 turns its card over (a rotation from the screen).
  cardStyle?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const insets = useSafeAreaInsets();
  const barBottom = Math.max(insets.bottom, size.tabBarInset);
  return (
    <View style={styles.shell}>
      <StatusBar barStyle="dark-content" />
      <RecordsBackdrop />
      <View style={[styles.shellHead, { paddingTop: insets.top + 10 }]}>
        <ScreenTitle title={title} onBack={onBack} right={right} />
      </View>
      <View style={styles.shellTabs}>{tabs}</View>
      <Animated.View
        style={[
          frostCard,
          styles.shellCard,
          { marginBottom: barBottom + size.tabBar + recordsFrame.gap },
          cardStyle,
        ]}
      >
        {children}
      </Animated.View>
      {footer ? (
        <View style={[styles.shellFooter, { bottom: barBottom }]}>
          {footer}
        </View>
      ) : null}
      {after}
    </View>
  );
}

// The top of the picker panels, just under the tabs (5.1's dates, or the thin tabs).
export function usePickerTop(thin = false) {
  const insets = useSafeAreaInsets();
  return (
    insets.top +
    10 +
    52 +
    8 +
    (thin ? recordsFrame.thinTabsHeight : recordsFrame.tabsHeight) +
    8
  );
}

// 내 기록 · 기록 상세 · 러닝 분석: the 30 / 800 title, with a round glass button on the right when there is one.
// onBack puts a round glass 뒤로 at the top left, before the title (담당자 결정: 하위 화면엔 뒤로).
export function ScreenTitle({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleLeft}>
        {onBack ? <BackGlassButton onPress={onBack} /> : null}
        <AppText accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
      </View>
      {right}
    </View>
  );
}

// The round glass 뒤로 the 5.x and 3.1 screens share at their top left.
export function BackGlassButton({ onPress }: { onPress: () => void }) {
  return <BackButton onPress={onPress} />;
}

export function RoundGlassButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <GlassIconButton icon={icon} accessibilityLabel={label} onPress={onPress} />
  );
}

// The handoff's tabs: a 40-high track of equal tabs. glass (5.3 기간) is a glass track with the chosen tab navy;
// the default (5.2) is a glass track with the chosen tab white; onCard (5.1, inside the frost card) is a faint
// white well with white text.
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  glass = false,
  onCard = false,
}: {
  options: { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  glass?: boolean;
  onCard?: boolean;
}) {
  const navy = glass;
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.tabs, onCard ? styles.tabsOnCard : glassCard]}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[
              styles.tab,
              selected && (navy ? styles.tabOn : styles.tabOnWhite),
            ]}
          >
            <AppText
              numberOfLines={1}
              style={[
                styles.tabText,
                onCard && !selected && styles.tabTextOnCard,
                selected && (navy ? styles.tabTextOn : styles.tabTextOnWhite),
              ]}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// The 13.5 label over a figure on a frost card (평균 페이스, 누적 거리, …).
export function BarLabel({ label }: { label: string }) {
  return <AppText style={styles.barLabelText}>{label}</AppText>;
}

type PickerCell = {
  key: string;
  label: string;
  // A second line under the label (1주 → 10.1–10.4).
  sub?: string;
  accessibilityLabel: string;
  selected: boolean;
  disabled: boolean;
  dot: boolean;
};

// The 5.3 · 5.1 pickers (월 · 주 · 년): a glass panel under the tabs with a ‹ title › head, a grid of cells, a
// dot on cells with runs, later cells dimmed and the chosen one navy.
function PickerPanel({
  title,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  cells,
  columns,
  legend,
  onPick,
  style,
}: {
  title: string;
  previousLabel?: string;
  nextLabel?: string;
  onPrevious?: () => void;
  // Without onNext the › is dimmed (this period is the newest).
  onNext?: () => void;
  cells: PickerCell[];
  columns: number;
  legend: string;
  onPick: (key: string) => void;
  style?: ViewStyle;
}) {
  const width = `${(100 - (columns - 1) * 2.6) / columns}%` as const;
  return (
    <View style={[styles.picker, style]}>
      <View style={styles.pickerHead}>
        {onPrevious ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={previousLabel}
            onPress={onPrevious}
            style={[styles.yearButton, styles.yearButtonOn]}
          >
            <Icon name="back" color={recordsLook.ink} size={16} />
          </Pressable>
        ) : (
          <View style={styles.yearButton} />
        )}
        <AppText style={styles.pickerYear}>{title}</AppText>
        {previousLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLabel}
            accessibilityState={{ disabled: !onNext }}
            disabled={!onNext}
            onPress={onNext}
            style={[styles.yearButton, onNext ? styles.yearButtonOn : null]}
          >
            <Icon
              name="forward"
              color={onNext ? recordsLook.ink : recordsLook.muted}
              size={16}
            />
          </Pressable>
        ) : (
          <View style={styles.yearButton} />
        )}
      </View>
      <View style={styles.monthGrid}>
        {cells.map(cell => (
          <Pressable
            key={cell.key}
            accessibilityRole="button"
            accessibilityLabel={cell.accessibilityLabel}
            accessibilityState={{
              selected: cell.selected,
              disabled: cell.disabled,
            }}
            disabled={cell.disabled}
            onPress={() => onPick(cell.key)}
            style={[
              styles.monthCell,
              { width },
              cell.sub ? styles.monthCellTall : null,
              cell.disabled
                ? null
                : cell.selected
                ? styles.monthOn
                : styles.monthOff,
            ]}
          >
            <AppText
              style={[
                styles.monthText,
                cell.selected && styles.monthTextOn,
                cell.disabled && styles.monthTextFuture,
              ]}
            >
              {cell.label}
            </AppText>
            {cell.sub ? (
              <AppText
                style={[
                  styles.cellSub,
                  cell.selected && styles.cellSubOn,
                  cell.disabled && styles.monthTextFuture,
                ]}
              >
                {cell.sub}
              </AppText>
            ) : null}
            <View
              style={[
                styles.monthDot,
                cell.dot &&
                  (cell.selected ? styles.monthDotOn : styles.legendDot),
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={[styles.monthDot, styles.legendDot]} />
        <AppText style={styles.legendText}>{legend}</AppText>
      </View>
    </View>
  );
}

// 월 선택 (5.3 · 5.1): one year's twelve months.
export function MonthPicker({
  year,
  selected,
  latest,
  marked,
  onYear,
  onPick,
  style,
}: {
  year: number;
  // YYYY-MM
  selected: string;
  // The newest month that can be picked (this month).
  latest: string;
  marked: ReadonlySet<string>;
  onYear: (year: number) => void;
  onPick: (month: string) => void;
  style?: ViewStyle;
}) {
  const latestYear = Number(latest.slice(0, 4));
  return (
    <PickerPanel
      title={`${year}년`}
      previousLabel="이전 해"
      nextLabel="다음 해"
      onPrevious={() => onYear(year - 1)}
      onNext={year < latestYear ? () => onYear(year + 1) : undefined}
      columns={4}
      legend="기록이 있는 달"
      onPick={onPick}
      style={style}
      cells={Array.from({ length: 12 }, (_, index) => {
        const month = `${year}-${String(index + 1).padStart(2, '0')}`;
        return {
          key: month,
          label: `${index + 1}월`,
          accessibilityLabel: `${year}년 ${index + 1}월`,
          selected: month === selected,
          disabled: month > latest,
          dot: marked.has(month),
        };
      })}
    />
  );
}

// One month's weeks as its calendar rows: 7 days each, Monday to Sunday, from the row holding the 1st to the
// row holding the last day (담당자 결정). 9월 2026: 8.31–9.6, 9.7–9.13, …, 9.28–10.4.
export function weeksOf(month: string) {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const first = new Date(`${month}-01T00:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  const weeks: { start: string; end: string }[] = [];
  while (cursor <= last) {
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + 6);
    weeks.push({ start: day(cursor), end: day(end) });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

const dotted = (day: string) =>
  `${Number(day.slice(5, 7))}.${Number(day.slice(8))}`;

// 주 선택 (5.3): ‹ 2026년 10월 › and that month's weeks, two to a row.
export function WeekPicker({
  month,
  selected,
  today,
  marked,
  onMonth,
  onPick,
  style,
}: {
  // YYYY-MM
  month: string;
  // The chosen week's Monday, or null when it is not one of this month's rows.
  selected: string | null;
  today: string;
  // The Mondays of the weeks with runs.
  marked: ReadonlySet<string>;
  onMonth: (step: 1 | -1) => void;
  onPick: (week: { start: string; end: string }) => void;
  style?: ViewStyle;
}) {
  const weeks = weeksOf(month);
  return (
    <PickerPanel
      title={`${month.slice(0, 4)}년 ${Number(month.slice(5))}월`}
      previousLabel="이전 달"
      nextLabel="다음 달"
      onPrevious={() => onMonth(-1)}
      onNext={month < today.slice(0, 7) ? () => onMonth(1) : undefined}
      columns={2}
      legend="기록이 있는 주"
      onPick={key => {
        const week = weeks.find(item => item.start === key);
        if (week) {
          onPick(week);
        }
      }}
      style={style}
      cells={weeks.map((week, index) => ({
        key: week.start,
        label: `${index + 1}주차`,
        sub: `${dotted(week.start)}–${dotted(week.end)}`,
        accessibilityLabel: `${Number(month.slice(5))}월 ${index + 1}주차`,
        selected: week.start === selected,
        disabled: week.start > today,
        dot: marked.has(week.start),
      }))}
    />
  );
}

// 연도 선택 (5.3): the last five years, three to a row.
export function YearPicker({
  years,
  selected,
  marked,
  onPick,
  style,
}: {
  years: number[];
  selected: number;
  marked: ReadonlySet<number>;
  onPick: (year: number) => void;
  style?: ViewStyle;
}) {
  return (
    <PickerPanel
      title="연도 선택"
      columns={3}
      legend="기록이 있는 해"
      onPick={key => onPick(Number(key))}
      style={style}
      cells={years.map(year => ({
        key: String(year),
        label: `${year}`,
        accessibilityLabel: `${year}년`,
        selected: year === selected,
        disabled: false,
        dot: marked.has(year),
      }))}
    />
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#D7E1E7' },
  shellHead: { paddingHorizontal: recordsLook.side },
  shellTabs: {
    marginTop: 8,
    marginHorizontal: recordsFrame.side,
  },
  shellCard: {
    flex: 1,
    marginTop: recordsFrame.gap,
    marginHorizontal: recordsFrame.side,
    overflow: 'hidden',
  },
  shellFooter: {
    position: 'absolute',
    left: recordsFrame.side,
    right: recordsFrame.side,
    height: size.tabBar,
  },
  titleRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: recordsLook.ink,
  },

  tabs: {
    height: recordsFrame.thinTabsHeight,
    flexDirection: 'row',
    gap: 3,
    padding: 4,
    borderRadius: 16,
  },
  tabsOnCard: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  tabOn: {
    backgroundColor: recordsLook.ink,
    boxShadow: '0 4px 12px rgba(2,5,14,0.18)',
  },
  tabText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.3,
    color: recordsLook.sub,
  },
  tabTextOn: { fontFamily: fontFamily.bold, color: '#FFFFFF' },
  tabOnWhite: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    boxShadow:
      '0 4px 12px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  tabTextOnWhite: { fontFamily: fontFamily.bold, color: recordsLook.ink },
  tabTextOnCard: { color: recordsLook.onCardSub },
  barLabelText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: recordsLook.onCardLabel,
  },
  picker: {
    ...glassCard,
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearButtonOn: {
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 6px rgba(9,17,26,0.08)',
  },
  pickerYear: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: recordsLook.ink,
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthCell: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  monthOff: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  monthOn: {
    backgroundColor: recordsLook.ink,
    boxShadow: '0 6px 14px rgba(2,5,14,0.24)',
  },
  monthText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: recordsLook.ink,
  },
  monthTextOn: { color: '#FFFFFF' },
  monthCellTall: { height: 58 },
  cellSub: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 10.5,
    lineHeight: 13,
    color: recordsLook.sub,
  },
  cellSubOn: { color: 'rgba(255,255,255,0.7)' },
  monthTextFuture: { fontFamily: fontFamily.medium, color: recordsLook.muted },
  monthDot: { width: 4, height: 4, borderRadius: 2 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  legendDot: { backgroundColor: recordsLook.ink },
  monthDotOn: { backgroundColor: '#FFFFFF' },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: recordsLook.sub,
  },
});
