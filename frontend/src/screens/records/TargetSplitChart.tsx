import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AppText } from '../../components';
import type { RunSplit } from '../../data';
import { fontFamily } from '../../theme';
import { recordsLook } from './look';
import { kmBands, keepToleranceSec, sideOf, type SplitSide } from './paceHeart';

// 러닝 분석 뒷면의 구간 비교 (S15P31E105-615, 담당자 요청: 말 대신 시각 자료로): each API split as a bar off the target
// line — up when it ran faster than the target, down when slower, as far as it was off — over the ±10초/km band that
// counts as 목표 범위. A split without a pace is a short grey tick on the line and is not counted. The colours only
// tell the three apart; none of them means 좋음 or 나쁨.
export const sideLook: Record<SplitSide, string> = {
  faster: '#A8D8FF',
  within: '#FFFFFF',
  slower: '#FFD38A',
};
const missingLook = 'rgba(255,255,255,0.35)';

const plotHeight = 120;
const kmLabel = 32;

function Legend({
  color,
  label,
  count,
  band = false,
}: {
  color: string;
  label: string;
  count?: number;
  band?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          band ? styles.bandSwatch : styles.swatch,
          { backgroundColor: color },
        ]}
      />
      <AppText style={styles.legendText}>
        {count === undefined ? label : `${label} ${count}`}
      </AppText>
    </View>
  );
}

export function TargetSplitChart({
  splits,
  target,
}: {
  splits: RunSplit[];
  target: number;
}) {
  const [width, setWidth] = useState(0);
  const totalM = splits[splits.length - 1]?.endDistanceM ?? 0;
  const diffs = splits.map(split =>
    split.paceSecPerKm === null ? null : split.paceSecPerKm - target,
  );
  const known = diffs.filter((diff): diff is number => diff !== null);
  const sides = splits.map(split =>
    split.paceSecPerKm === null ? null : sideOf(split.paceSecPerKm, target),
  );
  const count = (side: SplitSide) => sides.filter(item => item === side).length;
  const missing = sides.filter(item => item === null).length;
  // Half the plot is the largest gap, never less than twice the band, so the band always reads as narrow.
  const reach = Math.max(...known.map(Math.abs), keepToleranceSec * 2);
  const middle = plotHeight / 2;
  // A negative diff (faster than the target) sits above the line, a positive one below.
  const y = (diff: number) => middle + (diff / reach) * (middle - 6);
  const x = (meters: number) => (totalM > 0 ? (meters / totalM) * width : 0);
  const bands = kmBands(splits);
  const summary = `분석 가능한 ${known.length}개 구간 중 범위 안 ${count(
    'within',
  )}개, 빠름 ${count('faster')}개, 느림 ${count('slower')}개${
    missing ? `, 기록 없음 ${missing}개` : ''
  }`;

  return (
    <View accessible accessibilityLabel={summary}>
      <View style={styles.legend}>
        <Legend
          color={sideLook.within}
          label="범위 안"
          count={count('within')}
        />
        <Legend color={sideLook.faster} label="빠름" count={count('faster')} />
        <Legend color={sideLook.slower} label="느림" count={count('slower')} />
        {missing ? (
          <Legend color={missingLook} label="기록 없음" count={missing} />
        ) : null}
      </View>
      <View
        style={styles.plot}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && totalM > 0 ? (
          <Svg width={width} height={plotHeight} testID="target-split-chart">
            {/* 목표 범위: the target ±10초/km. */}
            <Rect
              x={0}
              y={y(-keepToleranceSec)}
              width={width}
              height={y(keepToleranceSec) - y(-keepToleranceSec)}
              fill="#FFFFFF"
              fillOpacity={0.14}
            />
            {splits.map((split, index) => {
              const diff = diffs[index];
              const side = sides[index];
              const left = x(split.startDistanceM) + 1.5;
              const barWidth = Math.max(
                x(split.endDistanceM) - x(split.startDistanceM) - 3,
                2,
              );
              if (diff === null || side === null) {
                return (
                  <Rect
                    key={index}
                    x={left}
                    y={middle - 1.5}
                    width={barWidth}
                    height={3}
                    fill={missingLook}
                  />
                );
              }
              // Faster is a lower number (a negative diff), drawn up from the line.
              const end = y(diff);
              return (
                <Rect
                  key={index}
                  x={left}
                  y={Math.min(middle, end)}
                  width={barWidth}
                  height={Math.max(Math.abs(end - middle), 2)}
                  rx={2}
                  fill={sideLook[side]}
                />
              );
            })}
            {/* The target itself. */}
            <Line
              x1={0}
              x2={width}
              y1={middle}
              y2={middle}
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
          </Svg>
        ) : null}
        <AppText style={[styles.edge, styles.edgeTop]}>빠름</AppText>
        <AppText style={[styles.edge, styles.edgeBottom]}>느림</AppText>
      </View>
      <View style={styles.kms}>
        {width > 0 && totalM > 0
          ? bands
              .filter(band => x(band.endM) - x(band.startM) >= kmLabel * 0.8)
              .map(band => (
                <AppText
                  key={band.km}
                  style={[
                    styles.km,
                    { left: x((band.startM + band.endM) / 2) - kmLabel / 2 },
                  ]}
                >
                  {`${band.km}km`}
                </AppText>
              ))
          : null}
      </View>
      <View style={styles.legend}>
        <Legend color="rgba(255,255,255,0.3)" label="목표 ±10초/km" band />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 4,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  bandSwatch: { width: 16, height: 9, borderRadius: 2 },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardLabel,
  },
  plot: { height: plotHeight },
  edge: {
    position: 'absolute',
    right: 0,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 13,
    color: recordsLook.onCardMuted,
  },
  edgeTop: { top: 0 },
  edgeBottom: { bottom: 0 },
  kms: { height: 15, marginTop: 4, marginBottom: 6 },
  km: {
    position: 'absolute',
    width: kmLabel,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.onCardLabel,
  },
});
