import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { AppText, Icon, useToast, WordWrap } from '../../components';
import type { RunRecordDetail, RunSplit } from '../../data';
import {
  formatClockTime,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { fontFamily } from '../../theme';
import { FlipCard } from './FlipCard';
import { recordsLook } from './look';
import { compareWithGoal, kmBands, measured } from './paceHeart';
import { paceHeartLook } from './PaceHeartPreview';
import { kstDay } from './parts';
import { TargetSplitChart } from './TargetSplitChart';

// 2.1 홈 러닝 분석 (S15P31E105-615; S15P31E105-594 담당자 시안 "러닝 분석 앞뒤"): one run seen two ways on a card that
// turns. Above both faces the run's row (its icon, name, date and time; a group run's opens 6.7), so either face is
// about the same run. (기록 상세 보기 and its screen were dropped, S15P31E105-594 담당자 결정.) 앞면 러닝 결과: 페이스와 심박 변화 on axes of their own, then 거리 · 시간 · 평균 페이스 · 평균 심박 in a grid
// and 목표와 비교하기. 뒷면 목표와 비교: the sentence from the average against the run's own target pace, the two paces
// side by side and as bars, 구간별 목표 비교 by km, and 러닝 결과 보기. Faster or slower is only said, never judged;
// nothing unmeasured reads 0 or 정상.

const heart = paceHeartLook.heart;
// The pace line and its figures in the home's mint (S15P31E105-594 담당자 요청), the heart rate in its coral.
const pace = recordsLook.mint;

// 2026.11.10 · 07:20
function runTime(startedAt: string) {
  return `${kstDay(startedAt).replace(/-/g, '.')} · ${formatClockTime(
    startedAt,
  )}`;
}

function RunRow({
  record,
  onOpen,
  openLabel,
}: {
  record: RunRecordDetail;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const body = (
    <>
      <View style={styles.runIcon}>
        <Icon
          name="runner"
          color={recordsLook.onCard}
          size={20}
          strokeWidth={2}
        />
      </View>
      <View style={styles.flex}>
        <AppText style={styles.runName} numberOfLines={1}>
          {record.title}
        </AppText>
        <AppText style={styles.runTime}>{runTime(record.startedAt)}</AppText>
      </View>
      {onOpen ? (
        <Icon
          name="forward"
          color={recordsLook.onCardSub}
          size={20}
          strokeWidth={2}
        />
      ) : null}
    </>
  );
  return onOpen ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={openLabel}
      onPress={onOpen}
      style={({ pressed }) => [styles.runRow, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.runRow}>{body}</View>
  );
}

// The card's turn button: the words and the turning arrow (담당자 요청서: 회전 아이콘과 텍스트), white (담당자 요청, S15P31E105-594).
function TurnButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.turn, pressed && styles.pressed]}
    >
      <AppText style={styles.turnText}>{label}</AppText>
      <Icon
        name="refresh"
        color={recordsLook.ink}
        size={16}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

// ---- 페이스와 심박 변화 ----

const plotHeight = 150;
const leftGutter = 44;
const rightGutter = 40;
const kmLabel = 34;

// A round span around the values with a tick in its middle: 5:40 · 6:00 · 6:20 for pace, 130 · 150 · 170 for bpm.
function axis(values: number[], step: number) {
  if (values.length === 0) {
    return null;
  }
  let low = Math.floor(Math.min(...values) / step) * step;
  let high = Math.ceil(Math.max(...values) / step) * step;
  if (high - low < step * 2) {
    high = low + step * 2;
  }
  // Even steps either side of the middle tick.
  if (((high - low) / step) % 2 === 1) {
    high += step;
  }
  return { low, high, mid: (low + high) / 2 };
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <Svg width={22} height={10}>
        <Line x1={0} x2={22} y1={5} y2={5} stroke={color} strokeWidth={2} />
        <Circle
          cx={11}
          cy={5}
          r={3.4}
          fill={recordsLook.ink}
          stroke={color}
          strokeWidth={1.8}
        />
      </Svg>
      <AppText style={styles.legendText}>{label}</AppText>
    </View>
  );
}

type KmAverage = {
  startM: number;
  endM: number;
  pace: number | null;
  heart: number | null;
};

// Each km's average pace (time over distance) and heart rate (by distance) from the splits whose middle falls in it.
function kmAverages(splits: RunSplit[]): KmAverage[] {
  return kmBands(splits).map(band => {
    let seconds = 0;
    let paced = 0;
    let beats = 0;
    let timed = 0;
    for (const split of splits) {
      const middle = (split.startDistanceM + split.endDistanceM) / 2;
      if (middle < band.startM || middle > band.endM) {
        continue;
      }
      const length = split.endDistanceM - split.startDistanceM;
      if (split.paceSecPerKm !== null) {
        seconds += (split.paceSecPerKm * length) / 1000;
        paced += length;
      }
      if (split.averageHeartRate !== null) {
        beats += split.averageHeartRate * length;
        timed += length;
      }
    }
    return {
      startM: band.startM,
      endM: band.endM,
      pace: paced > 0 ? (seconds * 1000) / paced : null,
      heart: timed > 0 ? Math.round(beats / timed) : null,
    };
  });
}

function PaceHeartAxes({ splits }: { splits: RunSplit[] }) {
  const [width, setWidth] = useState(0);
  const seen = measured(splits);
  const end = splits[splits.length - 1]?.endDistanceM ?? 0;
  const plotWidth = Math.max(width - leftGutter - rightGutter, 0);
  const x = (meters: number) =>
    leftGutter + (end > 0 ? (meters / end) * plotWidth : 0);
  // One point per km (1km 구간 평균 기준, 담당자 시안), whatever length the API's splits are.
  const kms = kmAverages(splits);
  const paces = kms
    .map(km => km.pace)
    .filter((value): value is number => value !== null);
  const beats = kms
    .map(km => km.heart)
    .filter((value): value is number => value !== null);
  const paceAxis = axis(paces, 10);
  const heartAxis = axis(beats, 10);
  const top = 8;
  const bottom = plotHeight - 8;
  // Pace: faster (a lower number) higher up. Heart rate: higher up.
  const yPace = (value: number) =>
    paceAxis
      ? top +
        ((value - paceAxis.low) / (paceAxis.high - paceAxis.low)) *
          (bottom - top)
      : 0;
  const yHeart = (value: number) =>
    heartAxis
      ? bottom -
        ((value - heartAxis.low) / (heartAxis.high - heartAxis.low)) *
          (bottom - top)
      : 0;
  const bands = kmBands(splits);
  const points = (
    valueOf: (km: KmAverage) => number | null,
    y: (value: number) => number,
  ) => {
    const runs: { x: number; y: number }[][] = [[]];
    for (const km of kms) {
      const value = valueOf(km);
      if (value === null) {
        if (runs[runs.length - 1].length) {
          runs.push([]);
        }
        continue;
      }
      runs[runs.length - 1].push({
        x: x((km.startM + km.endM) / 2),
        y: y(value),
      });
    }
    return runs.filter(run => run.length > 0);
  };
  const drawLine = (
    runs: { x: number; y: number }[][],
    color: string,
    hollow: boolean,
    key: string,
  ) => (
    <React.Fragment key={key}>
      {runs.map((run, index) =>
        run.length > 1 ? (
          <Path
            key={`${key}-${index}`}
            d={run
              .map((point, at) => `${at ? 'L' : 'M'}${point.x},${point.y}`)
              .join(' ')}
            stroke={color}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        ) : null,
      )}
      {runs.flat().map((point, index) => (
        <Circle
          key={`${key}-dot-${index}`}
          cx={point.x}
          cy={point.y}
          r={hollow ? 3.6 : 3.4}
          fill={hollow ? recordsLook.ink : color}
          stroke={color}
          strokeWidth={hollow ? 2 : 0}
        />
      ))}
    </React.Fragment>
  );
  const ticks = [top, (top + bottom) / 2, bottom];
  return (
    <View
      accessible
      accessibilityLabel={`페이스 ${
        paces.length
          ? `${formatPace(paces[0])}에서 ${formatPace(paces[paces.length - 1])}`
          : '기록 없음'
      }, 심박 ${
        beats.length
          ? `${beats[0]}에서 ${beats[beats.length - 1]} bpm`
          : '기록 없음'
      }`}
    >
      <View style={styles.legend}>
        <LegendLine color={pace} label="페이스" />
        <LegendLine color={heart} label="심박" />
      </View>
      <View style={styles.axisTitles}>
        <AppText style={[styles.axisTitle, { color: pace }]}>
          {seen.pace ? '/km' : ''}
        </AppText>
        <AppText style={[styles.axisTitle, { color: heart }]}>
          {seen.heart ? 'bpm' : ''}
        </AppText>
      </View>
      <View
        style={{ height: plotHeight }}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && end > 0 ? (
          <Svg width={width} height={plotHeight} testID="pace-heart-chart">
            {/* The pace scale on the left, the heart rate's on the right, each in its line's colour; the distance along the foot. */}
            <Line
              x1={leftGutter}
              x2={leftGutter}
              y1={top}
              y2={bottom}
              stroke={pace}
              strokeWidth={1}
            />
            <Line
              x1={leftGutter + plotWidth}
              x2={leftGutter + plotWidth}
              y1={top}
              y2={bottom}
              stroke={heart}
              strokeWidth={1}
            />
            <Line
              x1={leftGutter}
              x2={leftGutter + plotWidth}
              y1={bottom}
              y2={bottom}
              stroke={recordsLook.onCardMuted}
              strokeWidth={1}
            />
            {ticks.map(at => (
              <React.Fragment key={`tick-${at}`}>
                <Line
                  x1={leftGutter - 5}
                  x2={leftGutter}
                  y1={at}
                  y2={at}
                  stroke={pace}
                  strokeWidth={1}
                />
                <Line
                  x1={leftGutter + plotWidth}
                  x2={leftGutter + plotWidth + 5}
                  y1={at}
                  y2={at}
                  stroke={heart}
                  strokeWidth={1}
                />
              </React.Fragment>
            ))}
            {bands.map(band => (
              <Line
                key={`km-${band.km}`}
                x1={x((band.startM + band.endM) / 2)}
                x2={x((band.startM + band.endM) / 2)}
                y1={bottom}
                y2={bottom + 5}
                stroke={recordsLook.onCardMuted}
                strokeWidth={1}
              />
            ))}
            {heartAxis
              ? drawLine(
                  points(km => km.heart, yHeart),
                  heart,
                  false,
                  'heart',
                )
              : null}
            {paceAxis
              ? drawLine(
                  points(km => km.pace, yPace),
                  pace,
                  true,
                  'pace',
                )
              : null}
          </Svg>
        ) : null}
        {paceAxis
          ? [paceAxis.low, paceAxis.mid, paceAxis.high].map((value, index) => (
              <AppText
                key={`pace-${index}`}
                style={[
                  styles.scale,
                  styles.scaleLeft,
                  { top: ticks[index] - 8 },
                ]}
              >
                {formatPace(value).replace('″', '').replace('′', ':')}
              </AppText>
            ))
          : null}
        {heartAxis
          ? [heartAxis.high, heartAxis.mid, heartAxis.low].map(
              (value, index) => (
                <AppText
                  key={`heart-${index}`}
                  style={[
                    styles.scale,
                    styles.scaleRight,
                    { top: ticks[index] - 8 },
                  ]}
                >
                  {String(value)}
                </AppText>
              ),
            )
          : null}
      </View>
      <View style={styles.kms}>
        {width > 0 && end > 0
          ? bands
              .filter(band => x(band.endM) - x(band.startM) >= kmLabel * 0.8)
              .map(band => (
                <AppText
                  key={`kml-${band.km}`}
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
    </View>
  );
}

// ---- 거리 · 시간 · 평균 페이스 · 평균 심박 ----

function Cell({
  label,
  value,
  unit,
  color,
  left = false,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  left?: boolean;
}) {
  return (
    <View style={[styles.cell, left && styles.cellLeft]}>
      <AppText style={styles.cellLabel}>{label}</AppText>
      {unit ? (
        <AppText style={[styles.cellValue, color ? { color } : null]}>
          {value}
          <AppText style={[styles.cellUnit, color ? { color } : null]}>
            {unit}
          </AppText>
        </AppText>
      ) : (
        <AppText style={[styles.cellValue, color ? { color } : null]}>
          {value}
        </AppText>
      )}
    </View>
  );
}

// ---- 뒷면 ----

function PaceBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <View style={styles.paceBar}>
      <AppText style={styles.paceBarLabel}>{label}</AppText>
      <View style={styles.paceBarTrack}>
        <View
          style={[
            styles.paceBarFill,
            {
              width: `${(value / (max * 1.12)) * 100}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <AppText style={styles.paceBarValue}>{formatPace(value)}</AppText>
    </View>
  );
}

export function HomeRecord({
  record,
  onOpen,
  openLabel,
}: {
  record: RunRecordDetail;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const seen = measured(record.splits);
  // 요청서 5 사용자 상태별 표시: one line under the lines for what is missing.
  const notice =
    seen.pace && !seen.heart
      ? '이번 러닝에는 심박수 기록이 없어요.'
      : seen.heart && !seen.pace
      ? '이번 러닝에는 페이스 기록이 없어요.'
      : seen.gap
      ? '일부 구간의 데이터가 없어요.'
      : null;
  const goal = compareWithGoal(
    record.splits,
    record.averagePaceSecPerKm,
    record.targetPaceSecPerKm,
  );
  // S15P31E105-685: a run recorded without a target pace has nothing to compare, so the card stays on its front and a
  // toast says why, instead of turning to a back with that one line.
  const toast = useToast();
  const noTarget = () =>
    toast('목표 페이스 없이 기록한 러닝이라 비교할 목표가 없어요');

  const front = (turn: () => void) => (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <AppText style={styles.panelTitle}>페이스와 심박 변화</AppText>
      </View>
      {seen.pace || seen.heart ? (
        <View style={styles.chart}>
          <PaceHeartAxes splits={record.splits} />
          <AppText style={styles.caption}>
            {notice ?? '1km 구간 평균 기준'}
          </AppText>
        </View>
      ) : null}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <Cell
            left
            label="거리"
            value={formatKm(record.distanceM)}
            unit=" km"
          />
          <Cell label="시간" value={formatDuration(record.durationSec)} />
        </View>
        <View style={[styles.gridRow, styles.gridRule]}>
          <Cell
            left
            label="평균 페이스"
            value={formatPace(record.averagePaceSecPerKm)}
            unit="/km"
            color={pace}
          />
          {record.averageHeartRate === null ? (
            <Cell label="평균 심박" value="기록 없음" />
          ) : (
            <Cell
              label="평균 심박"
              value={String(record.averageHeartRate)}
              unit=" bpm"
              color={heart}
            />
          )}
        </View>
      </View>
      <TurnButton
        label="목표와 비교하기"
        onPress={goal.kind === 'noTarget' ? noTarget : turn}
      />
    </View>
  );

  const back = (turn: () => void) => (
    <View style={styles.panel}>
      <AppText style={styles.panelTitle}>목표와 비교</AppText>
      {/* Whole words per line on the back too (Android breaks Korean between letters). */}
      <View style={styles.summaryBox}>
        <WordWrap
          text={
            goal.kind === 'noTarget'
              ? '목표 페이스 없이 기록한 러닝이에요'
              : goal.summary
          }
          style={styles.summary}
          fontSize={19}
        />
      </View>
      {goal.kind === 'target' ? (
        <>
          <View style={styles.pair}>
            <View style={styles.pairCell}>
              <AppText style={styles.cellLabel}>목표 페이스</AppText>
              <AppText style={styles.pairValue}>
                {formatPace(goal.target)}
                <AppText style={styles.cellUnit}>/km</AppText>
              </AppText>
            </View>
            <View style={[styles.pairCell, styles.pairRight]}>
              <AppText style={styles.cellLabel}>실제 평균 페이스</AppText>
              <AppText style={styles.pairValue}>
                {formatPace(goal.average)}
                <AppText style={styles.cellUnit}>/km</AppText>
              </AppText>
              <AppText style={styles.pairNote}>{goal.gap}</AppText>
            </View>
          </View>
          <View style={styles.bars}>
            <PaceBar
              label="목표"
              value={goal.target}
              max={Math.max(goal.target, goal.average)}
              color={recordsLook.onCard}
            />
            <PaceBar
              label="실제"
              value={goal.average}
              max={Math.max(goal.target, goal.average)}
              color={heart}
            />
          </View>
          {goal.splits ? (
            <View style={styles.splits}>
              <TargetSplitChart splits={record.splits} target={goal.target} />
            </View>
          ) : null}
        </>
      ) : null}
      <TurnButton label="러닝 결과 보기" onPress={turn} />
    </View>
  );

  return (
    <View style={styles.root}>
      <RunRow record={record} onOpen={onOpen} openLabel={openLabel} />
      <FlipCard front={front} back={back} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: recordsLook.onCardLine,
  },
  runIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  runName: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: recordsLook.onCard,
  },
  runTime: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCardSub,
  },
  panel: {
    padding: 16,
    gap: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: recordsLook.onCard,
  },
  chart: { gap: 2 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardLabel,
  },
  axisTitles: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  axisTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardSub,
  },
  scale: {
    position: 'absolute',
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 16,
  },
  scaleLeft: {
    left: 0,
    width: leftGutter - 8,
    color: pace,
  },
  scaleRight: {
    right: 0,
    width: rightGutter - 8,
    textAlign: 'right',
    color: heart,
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
  caption: {
    marginTop: 6,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
  grid: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recordsLook.onCardLine,
  },
  gridRow: { flexDirection: 'row', paddingVertical: 10 },
  gridRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recordsLook.onCardLine,
  },
  cell: { flex: 1, paddingHorizontal: 10 },
  cellLeft: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: recordsLook.onCardLine,
  },
  cellLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCardLabel,
  },
  cellValue: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  cellUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    letterSpacing: 0,
    color: recordsLook.onCard,
  },
  turn: {
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  turnText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: recordsLook.ink,
  },
  summaryBox: { marginTop: -6 },
  summary: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  pair: { flexDirection: 'row' },
  pairCell: { flex: 1, paddingHorizontal: 8 },
  pairRight: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: recordsLook.onCardLine,
    paddingLeft: 14,
  },
  pairValue: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  pairNote: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardSub,
  },
  bars: { gap: 8 },
  paceBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paceBarLabel: {
    width: 28,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.onCardLabel,
  },
  paceBarTrack: {
    flex: 1,
    height: 9,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  paceBarFill: { height: 9, borderRadius: 5 },
  paceBarValue: {
    width: 48,
    textAlign: 'right',
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCard,
  },
  splits: {
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: recordsLook.onCardLine,
  },
});
