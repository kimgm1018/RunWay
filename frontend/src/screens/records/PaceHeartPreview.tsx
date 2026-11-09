import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { AppText } from '../../components';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { recordsLook } from './look';
import type { RunSplit } from '../../data';
import { kmBands } from './paceHeart';

// 2.1's 페이스와 심박 변화 (S15P31E105-615, 담당자 요청: 그래프를 주로, 한 평면에 두 그래프): pace and heart rate as two
// lines in one plot along the run's distance, one band per km. Each line keeps its own scale, pace on the left (a lower number is faster and drawn
// higher) and heart rate on the right, told apart by colour, the legend and the scale's colour. Only the flow is
// shown; reading a moment off the lines is 기록 상세's.
export const paceHeartLook = {
  pace: recordsLook.onCard,
  heart: '#FFB4A2',
};

// The scales' width either side of the plot, and room above and below the lines for their dots.
const gutter = 40;
// The width of a band's km label, centred under it.
const kmLabel = 32;
const inset = 10;

type Point = { x: number; y: number };

// The known values as runs of points: a split without a value ends one run and the next value starts another, so a
// missing stretch shows as a gap rather than a line drawn across it.
function runsOf(
  splits: RunSplit[],
  valueOf: (split: RunSplit) => number | null,
  x: (seconds: number) => number,
  y: (value: number) => number,
) {
  const runs: Point[][] = [[]];
  for (const split of splits) {
    const value = valueOf(split);
    if (value === null) {
      if (runs[runs.length - 1].length) {
        runs.push([]);
      }
      continue;
    }
    runs[runs.length - 1].push({
      x: x((split.startDistanceM + split.endDistanceM) / 2),
      y: y(value),
    });
  }
  return runs.filter(run => run.length > 0);
}

// One measure's scale over the plot: its padded range and where a value sits.
function scaleOf(
  values: number[],
  plotHeight: number,
  higherIsUp: boolean,
): { low: number; high: number; y: (value: number) => number } | null {
  if (values.length === 0) {
    return null;
  }
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const pad = Math.max((high - low) * 0.15, 2);
  const [min, max] = [low - pad, high + pad];
  return {
    low,
    high,
    y: value => {
      const share = (value - min) / (max - min);
      return (
        inset + (higherIsUp ? 1 - share : share) * (plotHeight - inset * 2)
      );
    },
  };
}

function lineOf(runs: Point[][], color: string, key: string) {
  return (
    <React.Fragment key={key}>
      {runs.map((run, index) =>
        run.length > 1 ? (
          <Path
            key={`${key}-line-${index}`}
            d={run
              .map((point, at) => `${at ? 'L' : 'M'}${point.x},${point.y}`)
              .join(' ')}
            stroke={color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null,
      )}
      {runs.flat().map((point, index) => (
        <Circle
          key={`${key}-dot-${index}`}
          cx={point.x}
          cy={point.y}
          r={3}
          fill={color}
        />
      ))}
    </React.Fragment>
  );
}

// 페이스 6′05″에서 5′50″, 심박 142에서 168 bpm, for the screen reader.
function describe(splits: RunSplit[]) {
  const paces = splits
    .map(split => split.paceSecPerKm)
    .filter((value): value is number => value !== null);
  const beats = splits
    .map(split => split.averageHeartRate)
    .filter((value): value is number => value !== null);
  return [
    paces.length
      ? `페이스 ${formatPace(paces[0])}에서 ${formatPace(
          paces[paces.length - 1],
        )}`
      : '페이스 기록 없음',
    beats.length
      ? `심박 ${beats[0]}에서 ${beats[beats.length - 1]} bpm`
      : '심박 기록 없음',
  ].join(', ');
}

function Legend({
  color,
  label,
  note,
}: {
  color: string;
  label: string;
  note: string;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <AppText style={styles.legendLabel}>{label}</AppText>
      <AppText style={styles.legendNote}>{note}</AppText>
    </View>
  );
}

export function PaceHeartPreview({
  splits,
  pace,
  heart,
  height,
  averages,
  foot,
}: {
  splits: RunSplit[];
  pace: boolean;
  heart: boolean;
  // The plot's height; the legend and the km labels add their own.
  height: number;
  // The run's averages as dashed lines in each line's colour (2.1 준비도 리포트 최근 러닝, S15P31E105-615).
  averages?: { pace: number | null; heart: number | null };
  // The run's whole length and time at the axis' end, e.g. 5.02km · 29:41.
  foot?: string;
}) {
  const [width, setWidth] = useState(0);
  const end = splits[splits.length - 1]?.endDistanceM ?? 0;
  const plotWidth = Math.max(width - gutter * 2, 0);
  const x = (distanceM: number) =>
    gutter + (end > 0 ? (distanceM / end) * plotWidth : 0);
  const known = (valueOf: (split: RunSplit) => number | null) =>
    splits.map(valueOf).filter((value): value is number => value !== null);
  const paceScale = scaleOf(
    known(split => split.paceSecPerKm),
    height,
    false,
  );
  const heartScale = scaleOf(
    known(split => split.averageHeartRate),
    height,
    true,
  );
  const bands = kmBands(splits);
  return (
    <View accessible accessibilityLabel={describe(splits)}>
      <View style={styles.legend}>
        <Legend
          color={paceHeartLook.pace}
          label="페이스"
          note={
            !pace
              ? '기록 없음'
              : averages?.pace
              ? `위가 빠름 · 평균 ${formatPace(averages.pace)}`
              : '위가 빠름'
          }
        />
        <Legend
          color={paceHeartLook.heart}
          label="심박"
          note={
            !heart
              ? '기록 없음'
              : averages?.heart
              ? `평균 ${averages.heart}bpm`
              : 'bpm'
          }
        />
      </View>
      <View
        style={{ height }}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && end > 0 ? (
          <Svg width={width} height={height} testID="pace-heart-chart">
            {/* Each km as a band (담당자 요청: 1km 구간이 보이게): every other one lightly shaded, a dashed line between. */}
            {bands.map(band => (
              <React.Fragment key={`band-${band.km}`}>
                {band.km % 2 === 1 ? (
                  <Rect
                    x={x(band.startM)}
                    y={0}
                    width={Math.max(x(band.endM) - x(band.startM), 0)}
                    height={height}
                    fill="#FFFFFF"
                    fillOpacity={0.08}
                  />
                ) : null}
                {band.km > 1 ? (
                  <Line
                    x1={x(band.startM)}
                    x2={x(band.startM)}
                    y1={0}
                    y2={height}
                    stroke={recordsLook.onCardLine}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                  />
                ) : null}
              </React.Fragment>
            ))}
            {/* A faint frame for the shared plot: its top, middle and floor. */}
            {[inset, height / 2, height - inset].map(at => (
              <Line
                key={at}
                x1={gutter}
                x2={gutter + plotWidth}
                y1={at}
                y2={at}
                stroke={recordsLook.onCardLine}
                strokeWidth={1}
                strokeDasharray={at === height - inset ? undefined : '3 4'}
              />
            ))}
            {/* The averages, dashed, under the lines. */}
            {heartScale && averages?.heart ? (
              <Line
                x1={gutter}
                x2={gutter + plotWidth}
                y1={heartScale.y(averages.heart)}
                y2={heartScale.y(averages.heart)}
                stroke={paceHeartLook.heart}
                strokeOpacity={0.8}
                strokeWidth={1.2}
                strokeDasharray="5 4"
              />
            ) : null}
            {paceScale && averages?.pace ? (
              <Line
                x1={gutter}
                x2={gutter + plotWidth}
                y1={paceScale.y(averages.pace)}
                y2={paceScale.y(averages.pace)}
                stroke={paceHeartLook.pace}
                strokeOpacity={0.8}
                strokeWidth={1.2}
                strokeDasharray="5 4"
              />
            ) : null}
            {heartScale
              ? lineOf(
                  runsOf(
                    splits,
                    split => split.averageHeartRate,
                    x,
                    heartScale.y,
                  ),
                  paceHeartLook.heart,
                  'heart',
                )
              : null}
            {paceScale
              ? lineOf(
                  runsOf(splits, split => split.paceSecPerKm, x, paceScale.y),
                  paceHeartLook.pace,
                  'pace',
                )
              : null}
          </Svg>
        ) : null}
        {/* Each scale's ends in its line's colour: pace left (fast at the top), heart rate right. */}
        {paceScale ? (
          <>
            <AppText
              style={[styles.scale, styles.scaleLeft, styles.top]}
              numberOfLines={1}
            >
              {formatPace(paceScale.low)}
            </AppText>
            <AppText
              style={[styles.scale, styles.scaleLeft, styles.bottom]}
              numberOfLines={1}
            >
              {formatPace(paceScale.high)}
            </AppText>
          </>
        ) : null}
        {heartScale ? (
          <>
            <AppText
              style={[styles.scale, styles.scaleRight, styles.top]}
              numberOfLines={1}
            >
              {String(heartScale.high)}
            </AppText>
            <AppText
              style={[styles.scale, styles.scaleRight, styles.bottom]}
              numberOfLines={1}
            >
              {String(heartScale.low)}
            </AppText>
          </>
        ) : null}
      </View>
      {/* Each band's km under its middle (담당자 결정: 분 대신 거리). */}
      <View style={styles.kms}>
        {width > 0 && end > 0
          ? bands
              // A band too narrow for its label (a short last stretch kept as its own km) stays shaded, unlabelled.
              .filter(band => x(band.endM) - x(band.startM) >= kmLabel * 0.8)
              .map(band => (
                <AppText
                  key={`km-${band.km}`}
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
      {foot ? <AppText style={styles.foot}>{foot}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  foot: {
    marginTop: 2,
    marginRight: gutter,
    textAlign: 'right',
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.onCardMuted,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
    marginBottom: 10,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCard,
  },
  legendNote: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 15,
    color: recordsLook.onCardMuted,
  },
  scale: {
    position: 'absolute',
    width: gutter - 4,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 13,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
  scaleLeft: { left: 0, color: paceHeartLook.pace },
  scaleRight: { right: 0, textAlign: 'right', color: paceHeartLook.heart },
  kms: { height: 15, marginTop: 4 },
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
