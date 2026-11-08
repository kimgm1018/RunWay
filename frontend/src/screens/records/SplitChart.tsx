import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
import { AppText, RevealX } from '../../components';
import type { RunSplit } from '../../data';
import { fontFamily } from '../../theme';
import { recordsLook } from './look';

export type SplitMetric = 'pace' | 'heartRate' | 'cadence';

const valueOf: Record<SplitMetric, (split: RunSplit) => number | null> = {
  pace: split => split.paceSecPerKm,
  heartRate: split => split.averageHeartRate,
  cadence: split => split.averageCadence,
};

// Room for the best-point callout above and the km labels below.
const top = 34;
const bottom = 26;

// A smooth line through the points (Catmull-Rom turned into cubic Béziers).
function smooth(points: { x: number; y: number }[]) {
  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M${point.x},${point.y}`;
    }
    const before = points[index - 2] ?? points[index - 1];
    const from = points[index - 1];
    const after = points[index + 1] ?? point;
    const c1 = {
      x: from.x + (point.x - before.x) / 6,
      y: from.y + (point.y - before.y) / 6,
    };
    const c2 = {
      x: point.x - (after.x - from.x) / 6,
      y: point.y - (after.y - from.y) / 6,
    };
    return `${path} C${c1.x},${c1.y} ${c2.x},${c2.y} ${point.x},${point.y}`;
  }, '');
}

// 5.1 · 5.2 구간 그래프 (runway-records): the chosen measure by distance as a thick navy line over a fading
// fill, a dashed reference line (목표 for pace, 평균 otherwise) and the best point with a black callout. Faster
// pace is drawn higher.
export function SplitChart({
  splits,
  metric,
  reference,
  formatValue,
  height,
}: {
  splits: RunSplit[];
  metric: SplitMetric;
  reference: { value: number; label: string } | null;
  formatValue: (value: number) => string;
  height: number;
}) {
  const [width, setWidth] = useState(0);
  const values = splits
    .map(split => ({ split, value: valueOf[metric](split) }))
    .filter(
      (item): item is { split: RunSplit; value: number } => item.value !== null,
    );
  const totalM = splits[splits.length - 1]?.endDistanceM ?? 0;
  if (values.length === 0 || totalM === 0) {
    return null;
  }
  const higherIsBetter = metric !== 'pace';
  const all = values
    .map(item => item.value)
    .concat(reference ? [reference.value] : []);
  const [low, high] = [Math.min(...all), Math.max(...all)];
  const pad = Math.max((high - low) * 0.15, 2);
  const [min, max] = [low - pad, high + pad];
  const x = (distance: number) => (distance / totalM) * width;
  const y = (value: number) => {
    const share = (value - min) / (max - min);
    return top + (higherIsBetter ? 1 - share : share) * (height - top - bottom);
  };
  const points = [
    { x: x(0), y: y(values[0].value) },
    ...values.map(item => ({
      x: x((item.split.startDistanceM + item.split.endDistanceM) / 2),
      y: y(item.value),
    })),
    { x: x(totalM), y: y(values[values.length - 1].value) },
  ];
  const line = smooth(points);
  const baseline = height - bottom;
  const best = values.reduce((winner, item) =>
    (higherIsBetter ? item.value > winner.value : item.value < winner.value)
      ? item
      : winner,
  );
  const bestPoint = {
    x: x((best.split.startDistanceM + best.split.endDistanceM) / 2),
    y: y(best.value),
  };
  const kms = Array.from(
    { length: Math.floor(totalM / 1000) + 1 },
    (_, km) => km,
  );
  const bestLabel = `최고 ${formatValue(best.value)}`;
  // On the right half the callout sits left of the point, so a best last split stays inside the chart.
  const calloutLeft = bestPoint.x <= width / 2;
  return (
    <View
      style={[styles.chart, { height }]}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={bestLabel}
    >
      {width > 0 ? (
        <>
          {/* The line draws in from the left once when the splits change (S15P31E105-478). */}
          <RevealX appearKey={line} width={width} height={height}>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.32} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.04} />
                </LinearGradient>
              </Defs>
              <Path
                d={`${line} L${points[points.length - 1].x},${baseline} L${
                  points[0].x
                },${baseline} Z`}
                fill="url(#splitFill)"
              />
              {reference ? (
                <Line
                  x1={0}
                  x2={width}
                  y1={y(reference.value)}
                  y2={y(reference.value)}
                  stroke={recordsLook.onCard}
                  strokeOpacity={0.55}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              ) : null}
              <Path
                d={line}
                stroke={recordsLook.onCard}
                strokeWidth={2.2}
                strokeLinecap="round"
                fill="none"
              />
              <Circle
                cx={bestPoint.x}
                cy={bestPoint.y}
                r={4.5}
                fill="#FFFFFF"
              />
            </Svg>
          </RevealX>
          <View
            pointerEvents="none"
            style={[
              styles.callout,
              { top: Math.max(bestPoint.y - 12, 0) },
              calloutLeft
                ? { left: bestPoint.x + 12 }
                : { right: width - bestPoint.x + 12 },
            ]}
          >
            <AppText style={styles.calloutText}>{bestLabel}</AppText>
          </View>
          {reference ? (
            <AppText
              style={[styles.reference, { top: y(reference.value) + 6 }]}
            >
              {reference.label}
            </AppText>
          ) : null}
          {kms.map(km => (
            <AppText
              key={km}
              style={[styles.km, { top: height - 16, left: x(km * 1000) - 20 }]}
            >
              {`${km}km`}
            </AppText>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { alignSelf: 'stretch' },
  // 최고 5′41″ as plain white text by the point (runway-records 2차).
  callout: {
    position: 'absolute',
    height: 24,
    justifyContent: 'center',
  },
  calloutText: {
    fontFamily: fontFamily.bold,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.onCard,
  },
  reference: {
    position: 'absolute',
    right: 0,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardLabel,
  },
  km: {
    position: 'absolute',
    width: 40,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
});
