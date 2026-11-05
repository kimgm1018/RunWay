import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { AppText, Icon, type IconName } from '../../components';
import { fontFamily } from '../../theme';
import { OnboardingBackdrop } from '../onboarding/look';
import { BackButton } from '../../components/BackButton';
import { GlassIconButton } from '../../components/GlassIconButton';

// runway-records (S15P31E105-465): the look 5.1 · 5.2 · 5.3 share. The layout is the handoff's 390×844 frame:
// title at 46 (30 / 800), 24 from the sides, sections 24 apart, and the same mist as the 1.x screens.
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
} as const;

// The mist (#E9EEF1 → #B4C8D3) is the 1.x background itself.
export const RecordsBackdrop = OnboardingBackdrop;

export const glassCard: ViewStyle = {
  borderWidth: 1,
  borderColor: recordsLook.glassRim,
  backgroundColor: recordsLook.glass,
  boxShadow: recordsLook.glassShadow,
};

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

// The handoff's tabs: a 40-high track of equal tabs, the chosen one navy. glass gives the track the card glass
// (5.3); otherwise it is a faint white well (5.1 · 5.2).
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  glass = false,
}: {
  options: { value: T; label: string; accessibilityLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  glass?: boolean;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.tabs, glass ? glassCard : styles.tabsWell]}
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
            style={[styles.tab, selected && styles.tabOn]}
          >
            <AppText
              numberOfLines={1}
              style={[styles.tabText, selected && styles.tabTextOn]}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// A 12 / 700 label after a thin navy bar (평균 페이스, 누적 거리, …).
export function BarLabel({ label }: { label: string }) {
  return (
    <View style={styles.barLabel}>
      <AppText style={styles.barLabelText}>{label}</AppText>
    </View>
  );
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
    height: 40,
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 16,
  },
  tabsWell: {
    backgroundColor: 'rgba(255,255,255,0.42)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
  },
  tab: {
    flex: 1,
    height: 32,
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
  barLabel: {
    paddingLeft: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: recordsLook.ink,
  },
  barLabelText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: -0.3,
    color: recordsLook.ink,
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
    fontFamily: fontFamily.mono,
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
