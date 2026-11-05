import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';
import { AppText } from '../../components';
import type { RunRecordSummary } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { BarLabel, recordsLook } from './look';

// One day (month, year) of the period: what the three figures are drawn from.
export type FigureBucket = {
  key: string;
  distanceM: number;
  durationSec: number;
  runCount: number;
  future: boolean;
  records: RunRecordSummary[];
};

const swipeDistance = 48;

// A label, the figure large with a note at its right, then its graph (runway-records 2차 5.3 앞면).
function Section({
  label,
  value,
  note,
  children,
  first = false,
}: {
  label: string;
  value: string;
  note: string | null;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <View
      style={!first && styles.sectionGap}
      accessibilityLabel={`${label} ${value}`}
    >
      <BarLabel label={label} />
      <View style={styles.valueRow}>
        <AppText style={styles.value}>{value}</AppText>
        {note ? <AppText style={styles.note}>{note}</AppText> : null}
      </View>
      <View style={styles.graph}>{children}</View>
    </View>
  );
}

// A smooth line through the points: each step a curve with flat ends, like the mockup's cumulative line.
function smoothPath(points: { x: number; y: number }[]) {
  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M${point.x},${point.y}`;
    }
    const before = points[index - 1];
    const middle = (before.x + point.x) / 2;
    return `${path} C${middle},${before.y} ${middle},${point.y} ${point.x},${point.y}`;
  }, '');
}

// 5.3 카드 앞면 (runway-records 2차, 담당자 결정: 평균 페이스 > 누적 거리 > 총 시간): the average pace with each
// run's pace as a line (최고 = the fastest run), the distance with the period adding up, and the time with a
// rounded bar for each day (month, year) with runs. A swipe moves to the period before or after.
export function PeriodFigures({
  buckets,
  previousName,
  previousDistanceM,
  onSwipe,
}: {
  buckets: FigureBucket[];
  // 9월 · 지난주 · 2025년, for 9월보다 +7.4km; null for 전체 or without the period before.
  previousName: string | null;
  previousDistanceM: number | null;
  onSwipe: (direction: 1 | -1) => void;
}) {
  const [width, setWidth] = useState(314);
  const touchX = useRef<number | null>(null);
  const records = buckets
    .flatMap(bucket => bucket.records)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const distanceM = buckets.reduce((sum, bucket) => sum + bucket.distanceM, 0);
  const durationSec = buckets.reduce(
    (sum, bucket) => sum + bucket.durationSec,
    0,
  );
  const runCount = buckets.reduce((sum, bucket) => sum + bucket.runCount, 0);
  const pace =
    distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : null;
  const fastest = records.length
    ? Math.min(...records.map(record => record.averagePaceSecPerKm))
    : null;

  // 평균 페이스: each run's pace, faster higher, 46 high.
  const paceHeight = 70;
  const paces = records.map(record => record.averagePaceSecPerKm);
  const paceMin = Math.min(...paces);
  const paceMax = Math.max(...paces);
  const paceSpan = Math.max(paceMax - paceMin, 1);
  const paceLine =
    paces.length > 1
      ? paces
          .map(
            (value, index) =>
              `${(index / (paces.length - 1)) * width},${
                4 + ((value - paceMin) / paceSpan) * (paceHeight - 8)
              }`,
          )
          .join(' ')
      : paces.length === 1
      ? `0,${paceHeight / 2} ${width},${paceHeight / 2}`
      : '';

  // 누적 거리: the total at each day (month, year) with runs, joined smoothly from 0 to the last past day, with
  // a faint fill under it.
  const distanceHeight = 80;
  const past = buckets.filter(bucket => !bucket.future);
  const lastPast = Math.max(past.length - 1, 1);
  let total = 0;
  const steps = past.flatMap((bucket, index) => {
    if (bucket.runCount === 0) {
      return [];
    }
    total += bucket.distanceM;
    return [{ index, total }];
  });
  const top = Math.max(total, previousDistanceM ?? 0, 1);
  const yOf = (value: number) =>
    distanceHeight - 6 - (value / top) * (distanceHeight - 14);
  const distancePoints = [
    { x: 0, y: yOf(0) },
    ...steps.map(step => ({
      x: (step.index / lastPast) * width,
      y: yOf(step.total),
    })),
    ...(steps.length && steps[steps.length - 1].index < past.length - 1
      ? [{ x: width, y: yOf(total) }]
      : []),
  ];
  const distanceLine = total > 0 ? smoothPath(distancePoints) : '';

  // 총 시간: a rounded bar for each day (month, year) with runs, 58 high, 8 apart.
  const timeHeight = 84;
  const runDays = buckets.filter(bucket => bucket.runCount > 0);
  const longest = Math.max(...runDays.map(bucket => bucket.durationSec), 1);
  const barGap = runDays.length > 12 ? 4 : 8;
  const barWidth = runDays.length
    ? (width - barGap * (runDays.length - 1)) / runDays.length
    : 0;

  const gap = previousDistanceM === null ? null : distanceM - previousDistanceM;
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      onTouchStart={event => {
        touchX.current = event.nativeEvent.pageX;
      }}
      onTouchEnd={event => {
        const from = touchX.current;
        touchX.current = null;
        if (from !== null) {
          const dx = event.nativeEvent.pageX - from;
          if (Math.abs(dx) > swipeDistance) {
            onSwipe(dx < 0 ? 1 : -1);
          }
        }
      }}
    >
      <Section
        first
        label="평균 페이스"
        value={pace ? `${formatPace(pace)}/km` : '– –'}
        note={fastest ? `최고: ${formatPace(fastest)}/km` : null}
      >
        <Svg width={width} height={paceHeight}>
          {paceLine ? (
            <Polyline
              points={paceLine}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
      </Section>
      <Section
        label="누적 거리"
        value={`${formatKm(distanceM, 1)}km`}
        note={
          gap !== null && previousName
            ? `${previousName}보다 ${gap >= 0 ? '+' : '−'}${formatKm(
                Math.abs(gap),
                1,
              )}km`
            : null
        }
      >
        <Svg width={width} height={distanceHeight}>
          <Defs>
            <LinearGradient id="periodDistance" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.06} />
            </LinearGradient>
          </Defs>
          {distanceLine ? (
            <>
              <Path
                d={`${distanceLine} L${
                  distancePoints[distancePoints.length - 1].x
                },${distanceHeight} L0,${distanceHeight} Z`}
                fill="url(#periodDistance)"
              />
              <Path
                d={distanceLine}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : null}
        </Svg>
      </Section>
      <Section
        label="총 시간"
        value={durationSec > 0 ? formatDuration(durationSec) : '– –'}
        note={`러닝 ${runCount}회`}
      >
        <Svg width={width} height={timeHeight}>
          {runDays.map((bucket, index) => {
            const share = bucket.durationSec / longest;
            const height = Math.max(share * timeHeight, 6);
            return (
              <Rect
                key={bucket.key}
                x={index * (barWidth + barGap)}
                y={timeHeight - height}
                width={barWidth}
                height={height}
                rx={Math.min(6, barWidth / 2)}
                fill="#FFFFFF"
                fillOpacity={0.62 + share * 0.3}
              />
            );
          })}
        </Svg>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: 28 },
  valueRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  // 34 like 5.1's average pace, so the three figures read at a glance (담당자 결정).
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: recordsLook.onCard,
  },
  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: -0.2,
    color: recordsLook.onCard,
  },
  graph: { marginTop: 12 },
});
