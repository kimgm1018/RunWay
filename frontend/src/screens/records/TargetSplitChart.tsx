import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AppText } from '../../components';
import type { RunSplit } from '../../data';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { recordsLook } from './look';
import { kmBands, keepToleranceSec, sideOf, type SplitSide } from './paceHeart';

// 러닝 분석 뒷면의 구간별 목표 비교 (S15P31E105-615; S15P31E105-594 담당자 시안): each km as a bar off the target line
// — up when it ran faster than the target, down when slower, as far as it was off, its seconds by it — over the
// ±10초/km band that counts as 목표 범위. A km is the distance-weighted average of the API's splits in it; a km
// without a pace is a short grey tick on the line and is not counted. The colours only tell the three apart; none of
// them means 좋음 or 나쁨.
export const sideLook: Record<SplitSide, string> = {
  faster: '#A8D8FF',
  within: '#FFFFFF',
  slower: '#FFD38A',
};
const missingLook = 'rgba(255,255,255,0.35)';
const sideName: Record<SplitSide, string> = {
  within: '범위 안',
  faster: '빠름',
  slower: '느림',
};

const plotHeight = 120;
const labelGutter = 46;
const kmLabel = 34;

// Each km's average pace from the splits whose middle falls in it (time over distance), or null without one.
export function kmPaces(splits: RunSplit[]) {
  return kmBands(splits).map(band => {
    let seconds = 0;
    let meters = 0;
    for (const split of splits) {
      const middle = (split.startDistanceM + split.endDistanceM) / 2;
      if (
        split.paceSecPerKm === null ||
        middle < band.startM ||
        middle > band.endM
      ) {
        continue;
      }
      const length = split.endDistanceM - split.startDistanceM;
      seconds += (split.paceSecPerKm * length) / 1000;
      meters += length;
    }
    return { ...band, pace: meters > 0 ? (seconds * 1000) / meters : null };
  });
}

// -5초, +15초, 0초
const secondsText = (diff: number) => {
  const rounded = Math.round(diff);
  return `${rounded > 0 ? '+' : rounded < 0 ? '-' : ''}${Math.abs(rounded)}초`;
};

function Legend({
  color,
  label,
  band = false,
}: {
  color: string;
  label: string;
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
      <AppText style={styles.legendText}>{label}</AppText>
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
  const kms = kmPaces(splits);
  const totalM = kms[kms.length - 1]?.endM ?? 0;
  const diffs = kms.map(km => (km.pace === null ? null : km.pace - target));
  const known = diffs.filter((diff): diff is number => diff !== null);
  const sides = kms.map(km =>
    km.pace === null ? null : sideOf(km.pace, target),
  );
  const count = (side: SplitSide) => sides.filter(item => item === side).length;
  const missing = sides.filter(item => item === null).length;
  // Half the plot is the largest gap, never less than twice the band, so the band always reads as narrow.
  const reach = Math.max(...known.map(Math.abs), keepToleranceSec * 2);
  const middle = plotHeight / 2;
  // A negative diff (faster than the target) sits above the line, a positive one below.
  const y = (diff: number) => middle + (diff / reach) * (middle - 18);
  const x = (meters: number) => (totalM > 0 ? (meters / totalM) * width : 0);
  const shown = (['within', 'faster', 'slower'] as SplitSide[]).filter(
    side => side === 'within' || count(side) > 0,
  );
  const summary = `${known.length}개 구간 중 ${count(
    'within',
  )}개가 목표 범위 안`;

  return (
    <View accessible accessibilityLabel={`구간별 목표 비교, ${summary}`}>
      <View style={styles.head}>
        <AppText style={styles.title}>구간별 목표 비교</AppText>
        <Legend
          color="rgba(255,255,255,0.3)"
          label={`±${keepToleranceSec}초/km`}
          band
        />
      </View>
      <View style={styles.body}>
        <View style={styles.sideLabels}>
          <AppText style={[styles.sideLabel, styles.sideTop]}>
            {'빠름\n(-)'}
          </AppText>
          <AppText style={[styles.sideLabel, { top: middle - 15 }]}>
            {`목표\n${formatPace(target)}`}
          </AppText>
          <AppText style={[styles.sideLabel, styles.sideBottom]}>
            {'느림\n(+)'}
          </AppText>
        </View>
        <View
          style={styles.plot}
          onLayout={event => setWidth(event.nativeEvent.layout.width)}
        >
          {width > 0 && totalM > 0 ? (
            <Svg width={width} height={plotHeight} testID="target-split-chart">
              {/* The frame: a line up the left and along the foot. */}
              <Line
                x1={0}
                x2={0}
                y1={0}
                y2={plotHeight}
                stroke={recordsLook.onCardMuted}
                strokeWidth={1}
              />
              <Line
                x1={0}
                x2={width}
                y1={plotHeight}
                y2={plotHeight}
                stroke={recordsLook.onCardMuted}
                strokeWidth={1}
              />
              {/* 목표 범위: the target ±10초/km. */}
              <Rect
                x={0}
                y={y(-keepToleranceSec)}
                width={width}
                height={y(keepToleranceSec) - y(-keepToleranceSec)}
                fill="#FFFFFF"
                fillOpacity={0.14}
              />
              {kms.map((km, index) => {
                const diff = diffs[index];
                const side = sides[index];
                const span = x(km.endM) - x(km.startM);
                const barWidth = Math.max(Math.min(span * 0.5, 40), 4);
                const left = x(km.startM) + (span - barWidth) / 2;
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
              {/* The target itself, dashed. */}
              <Line
                x1={0}
                x2={width}
                y1={middle}
                y2={middle}
                stroke="#FFFFFF"
                strokeWidth={1.2}
                strokeDasharray="4 3"
              />
            </Svg>
          ) : null}
          {/* Each km's seconds off the target, above a bar that rises and under one that hangs. */}
          {width > 0 && totalM > 0
            ? kms.map((km, index) => {
                const diff = diffs[index];
                if (diff === null) {
                  return null;
                }
                const end = y(diff);
                const up = Math.round(diff) <= 0;
                return (
                  <AppText
                    key={`v-${index}`}
                    style={[
                      styles.value,
                      {
                        left: x((km.startM + km.endM) / 2) - kmLabel / 2,
                        top: up
                          ? Math.min(middle, end) - 16
                          : Math.max(middle, end) + 2,
                      },
                    ]}
                  >
                    {secondsText(diff)}
                  </AppText>
                );
              })
            : null}
        </View>
      </View>
      <View style={styles.kms}>
        {width > 0 && totalM > 0
          ? kms
              .filter(km => x(km.endM) - x(km.startM) >= kmLabel * 0.8)
              .map(km => (
                <AppText
                  key={km.km}
                  style={[
                    styles.km,
                    {
                      left:
                        labelGutter +
                        x((km.startM + km.endM) / 2) -
                        kmLabel / 2,
                    },
                  ]}
                >
                  {`${km.km}km`}
                </AppText>
              ))
          : null}
      </View>
      <View style={styles.foot}>
        <AppText style={styles.summary}>{summary}</AppText>
        <View style={styles.legend}>
          {shown.map(side => (
            <Legend
              key={side}
              color={sideLook[side]}
              label={`${sideName[side]} ${count(side)}`}
            />
          ))}
          {missing ? (
            <Legend color={missingLook} label={`기록 없음 ${missing}`} />
          ) : null}
        </View>
      </View>
      <AppText
        style={styles.caption}
      >{`구간 평균 비교 · 목표 ±${keepToleranceSec}초/km`}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 21,
    color: recordsLook.onCard,
  },
  body: { flexDirection: 'row' },
  sideLabels: { width: labelGutter, height: plotHeight },
  sideLabel: {
    position: 'absolute',
    left: 0,
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.onCardLabel,
  },
  sideTop: { top: -2 },
  sideBottom: { bottom: -2 },
  plot: { flex: 1, height: plotHeight },
  value: {
    position: 'absolute',
    width: kmLabel,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCard,
  },
  kms: { height: 16, marginTop: 6 },
  km: {
    position: 'absolute',
    width: kmLabel,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
    color: recordsLook.onCardLabel,
  },
  foot: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: 4,
  },
  summary: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: recordsLook.onCard,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  bandSwatch: { width: 18, height: 10, borderRadius: 2 },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardLabel,
  },
  caption: {
    marginTop: 4,
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
});
