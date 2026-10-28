import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text,
} from 'react-native-svg';
import type { RunSplit } from '../../data';
import { fontFamily, useTheme } from '../../theme';

export type SplitMetric = 'pace' | 'heartRate' | 'cadence';

const valueOf: Record<SplitMetric, (split: RunSplit) => number | null> = {
  pace: split => split.paceSecPerKm,
  heartRate: split => split.averageHeartRate,
  cadence: split => split.averageCadence,
};

const height = 168;
const top = 34;
const bottom = 26;
const side = 14;

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

// 5.2 구간 그래프: the chosen measure by distance, a dashed reference line (목표 for pace, 평균
// otherwise) and the best point. Faster pace is drawn higher.
export function SplitChart({
  splits,
  metric,
  reference,
  formatValue,
}: {
  splits: RunSplit[];
  metric: SplitMetric;
  reference: { value: number; label: string } | null;
  formatValue: (value: number) => string;
}) {
  const { colors } = useTheme();
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
  const x = (distance: number) =>
    side + (distance / totalM) * (width - side * 2);
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
  return (
    <View
      style={styles.chart}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={`${formatValue(best.value)} 최고`}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.accentText} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.accentText} stopOpacity={0} />
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
              x1={side}
              x2={width - side}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke={colors.textTertiary}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          ) : null}
          <Path d={line} stroke={colors.accentText} strokeWidth={2.4} fill="none" />
          {reference ? (
            <Text
              x={width - side}
              y={y(reference.value) - 6}
              fontSize={10}
              fontFamily={fontFamily.medium}
              fill={colors.textTertiary}
              textAnchor="end"
            >
              {reference.label}
            </Text>
          ) : null}
          <Circle
            cx={bestPoint.x}
            cy={bestPoint.y}
            r={5}
            fill={colors.accentText}
            stroke={colors.background}
            strokeWidth={2}
          />
          <Text
            x={bestPoint.x + 10}
            y={bestPoint.y - 10}
            fontSize={12}
            fontFamily={fontFamily.bold}
            fill={colors.text}
          >
            {`${formatValue(best.value)} 최고`}
          </Text>
          {kms.map(km => (
            <Text
              key={km}
              x={x(km * 1000)}
              y={height - 6}
              fontSize={10}
              fontFamily={fontFamily.numberRegular}
              fill={colors.textTertiary}
              textAnchor="middle"
            >
              {`${km}km`}
            </Text>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height, alignSelf: 'stretch' },
});
