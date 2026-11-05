import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Icon } from '../../components';
import type { RunRecordDetail } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { BarLabel, PillTabs, recordsLook } from './look';
import { SplitChart, type SplitMetric } from './SplitChart';

// 19초 or 1분 50초.
export function formatGap(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)}분 ${rounded % 60}초`
    : `${rounded}초`;
}

const metrics: { value: SplitMetric; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'heartRate', label: '심박' },
  { value: 'cadence', label: '케이던스' },
];

function average(values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length
    ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length)
    : null;
}

// ✓ 목표 30:00 달성 · 19초 단축, or the miss in coral.
function GoalLine({ record }: { record: RunRecordDetail }) {
  if (record.targetDurationSec === null) {
    return null;
  }
  const gap = record.targetDurationSec - record.durationSec;
  const achieved = gap >= 0;
  const color = achieved ? recordsLook.ink : '#C4644B';
  return (
    <View style={styles.goal}>
      <Icon
        name={achieved ? 'check' : 'close'}
        color={color}
        size={15}
        strokeWidth={2.6}
      />
      <AppText style={[styles.goalText, { color }]}>
        {achieved
          ? `목표 ${formatDuration(
              record.targetDurationSec,
            )} 달성 · ${formatGap(gap)} 단축`
          : `목표 ${formatDuration(
              record.targetDurationSec,
            )} 미달성 · ${formatGap(gap)} 늦음`}
      </AppText>
    </View>
  );
}

function Figure({
  label,
  value,
  unit,
  large = false,
}: {
  label: string;
  value: string;
  unit?: string;
  large?: boolean;
}) {
  return (
    <View style={large ? styles.figureLarge : styles.figure}>
      <BarLabel label={label} />
      <View style={[styles.figureValue, large && styles.figureValueLarge]}>
        <AppText style={large ? styles.big : styles.mid}>{value}</AppText>
        {unit ? <AppText style={styles.unit}>{unit}</AppText> : null}
      </View>
    </View>
  );
}

// 5.1 카드 · 5.2 본문 (runway-records): 페이스 · 심박 · 케이던스 tabs, the three figures, the split graph and the
// goal line. onOpen makes the figures and the graph a link (5.1 → 5.2).
export function RecordView({
  record,
  chartHeight,
  onOpen,
  openLabel,
}: {
  record: RunRecordDetail;
  chartHeight: number;
  onOpen?: () => void;
  openLabel?: string;
}) {
  // 심박·케이던스 tabs appear only when the run measured them.
  const available = metrics.filter(
    metric =>
      metric.value === 'pace' ||
      record.splits.some(split =>
        metric.value === 'heartRate'
          ? split.averageHeartRate !== null
          : split.averageCadence !== null,
      ),
  );
  const [metric, setMetric] = useState<SplitMetric>('pace');
  const reference =
    metric === 'pace'
      ? record.targetPaceSecPerKm
        ? {
            value: record.targetPaceSecPerKm,
            label: `목표 ${formatPace(record.targetPaceSecPerKm)}`,
          }
        : null
      : (() => {
          const mean = average(
            record.splits.map(split =>
              metric === 'heartRate'
                ? split.averageHeartRate
                : split.averageCadence,
            ),
          );
          return mean === null ? null : { value: mean, label: `평균 ${mean}` };
        })();
  const body = (
    <>
      <View style={styles.figures}>
        <Figure
          large
          label="평균 페이스"
          value={formatPace(record.averagePaceSecPerKm)}
          unit="/km"
        />
        <Figure label="거리" value={formatKm(record.distanceM)} unit="km" />
        <Figure label="시간" value={formatDuration(record.durationSec)} />
      </View>
      <SplitChart
        key={metric}
        splits={record.splits}
        metric={metric}
        reference={reference}
        height={chartHeight}
        formatValue={value =>
          metric === 'pace' ? formatPace(value) : String(value)
        }
      />
    </>
  );
  return (
    <View style={styles.root}>
      {available.length > 1 ? (
        <PillTabs options={available} value={metric} onChange={setMetric} />
      ) : null}
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={openLabel}
          onPress={onOpen}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.body}>{body}</View>
      )}
      <GoalLine record={record} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 20 },
  body: { gap: 24 },
  pressed: { opacity: 0.7 },
  figures: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  figureLarge: { flex: 1.25 },
  figure: { flex: 1 },
  figureValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 10,
  },
  figureValueLarge: { marginTop: 4 },
  big: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: recordsLook.ink,
    includeFontPadding: false,
  },
  mid: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.8,
    color: recordsLook.ink,
    includeFontPadding: false,
  },
  unit: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.sub,
  },
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  goalText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: -0.3,
  },
});
