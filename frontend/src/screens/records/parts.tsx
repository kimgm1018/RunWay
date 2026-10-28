import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import type { RunRecordSummary } from '../../data';
import { spacing, useTheme } from '../../theme';

const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

// YYYY-MM-DD in Korea.
export const kstDay = (value: string | Date) =>
  new Date(new Date(value).getTime() + kstOffsetMs).toISOString().slice(0, 10);
export const kstMonth = (value: string | Date) => kstDay(value).slice(0, 7);

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, days: number) =>
  new Date(toDate(day).getTime() + days * dayMs).toISOString().slice(0, 10);
export const shiftMonth = (month: string, months: number) => {
  const date = toDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
};
export const mondayOf = (day: string) =>
  addDays(day, -((toDate(day).getUTCDay() + 6) % 7));

// 10.05, like the dates on each run.
export const shortDay = (day: string) =>
  `${Number(day.slice(5, 7))}.${day.slice(8)}`;

// 5.1 groups runs by week (Monday first): 이번 주, 지난주, then the dates of older weeks.
export function weekGroups(records: RunRecordSummary[], now: Date) {
  const thisWeek = mondayOf(kstDay(now));
  const groups: { label: string; records: RunRecordSummary[] }[] = [];
  for (const record of records) {
    const week = mondayOf(kstDay(record.startedAt));
    const label =
      week === thisWeek
        ? '이번 주'
        : week === addDays(thisWeek, -7)
        ? '지난주'
        : `${shortDay(week)} – ${shortDay(addDays(week, 6))}`;
    const last = groups[groups.length - 1];
    if (last?.label === label) {
      last.records.push(record);
    } else {
      groups.push({ label, records: [record] });
    }
  }
  return groups;
}

// ‹ 2026년 10월 › (5.1·5.3). Without onNext the period is the current one and › is dimmed.
export function PeriodStepper({
  label,
  onPrevious,
  onNext,
  large = false,
}: {
  label: string;
  onPrevious: () => void;
  onNext?: () => void;
  large?: boolean;
}) {
  const { colors } = useTheme();
  const arrow = large ? styles.arrowLarge : styles.arrow;
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="이전 기간"
        onPress={onPrevious}
        hitSlop={10}
      >
        <AppText variant="title" style={arrow}>
          ‹
        </AppText>
      </Pressable>
      <AppText variant={large ? 'display' : 'title'} style={styles.label}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="다음 기간"
        accessibilityState={{ disabled: !onNext }}
        disabled={!onNext}
        onPress={onNext}
        hitSlop={10}
      >
        <AppText
          variant="title"
          style={[arrow, !onNext && { color: colors.textDisabled }]}
        >
          ›
        </AppText>
      </Pressable>
    </View>
  );
}

export const MonthStepper = (props: {
  label: string;
  onPrevious: () => void;
  onNext?: () => void;
}) => <PeriodStepper {...props} large />;

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { includeFontPadding: false },
  arrow: { fontSize: 22, lineHeight: 28 },
  arrowLarge: { fontSize: 28, lineHeight: 34 },
});
