import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Icon, WordWrap } from '../../components';
import type { RunRecordDetail } from '../../data';
import {
  formatClockTime,
  formatDuration,
  formatKm,
  formatLongDate,
  formatPace,
} from '../../format';
import { fontFamily } from '../../theme';
import { BarLabel, recordsLook } from './look';
import { compareWithGoal, measured } from './paceHeart';
import { FlipCard } from './FlipCard';
import { TargetSplitChart } from './TargetSplitChart';
import { PaceHeartPreview } from './PaceHeartPreview';
import { SplitChart, type SplitMetric } from './SplitChart';

// 19초 or 1분 50초.
export function formatGap(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)}분 ${rounded % 60}초`
    : `${rounded}초`;
}

export const metrics: { value: SplitMetric; label: string }[] = [
  { value: 'pace', label: '페이스' },
  { value: 'heartRate', label: '심박' },
  { value: 'cadence', label: '케이던스' },
];

// 5.2's 페이스 · 심박 · 케이던스 tabs: 심박 · 케이던스 only when the run measured them.
export function metricOptions(record: RunRecordDetail) {
  return metrics.filter(
    metric =>
      metric.value === 'pace' ||
      record.splits.some(split =>
        metric.value === 'heartRate'
          ? split.averageHeartRate !== null
          : split.averageCadence !== null,
      ),
  );
}

function average(values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length
    ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length)
    : null;
}

// 목표 30:00 달성 · 19초 단축, or a distance goal; trusts H02 goalAchieved (S15P31E105-638).
export function goalLine(record: RunRecordDetail) {
  if (record.goalAchieved === null) {
    return null;
  }
  const achieved = record.goalAchieved;
  if (record.targetDurationSec !== null) {
    const gap = record.targetDurationSec - record.durationSec;
    const target = formatDuration(record.targetDurationSec);
    if (achieved) {
      return {
        text:
          gap >= 0
            ? `목표 ${target} 달성 · ${formatGap(gap)} 단축`
            : `목표 ${target} 달성`,
        achieved: true,
      };
    }
    return {
      text:
        gap < 0
          ? `목표 ${target} 미달성 · ${formatGap(gap)} 늦음`
          : `목표 ${target} 미달성`,
      achieved: false,
    };
  }
  if (record.targetDistanceM !== null) {
    const target = `${formatKm(record.targetDistanceM)}km`;
    return {
      text: achieved ? `목표 ${target} 달성` : `목표 ${target} 미달성`,
      achieved,
    };
  }
  return {
    text: achieved ? '목표 달성' : '목표 미달성',
    achieved,
  };
}

// 목표보다 5초 빠름 beside the average pace, when the run had a target pace.
function paceNote(record: RunRecordDetail) {
  if (!record.targetPaceSecPerKm) {
    return null;
  }
  const gap = Math.round(
    record.targetPaceSecPerKm - record.averagePaceSecPerKm,
  );
  if (gap === 0) {
    return '목표와 같은 페이스';
  }
  return `목표보다 ${formatGap(gap)} ${gap > 0 ? '빠름' : '느림'}`;
}

// The date chip (no RUNWAY, 담당자 결정), the run's name and the goal line: the top of the 5.1 and 5.2 cards.
function CardHead({ record }: { record: RunRecordDetail }) {
  const goal = goalLine(record);
  return (
    <View>
      <View style={styles.headRow}>
        <View style={styles.chip}>
          <AppText style={styles.chipText}>
            {formatLongDate(record.startedAt)}
          </AppText>
        </View>
      </View>
      <AppText style={styles.name} numberOfLines={1}>
        {record.title}
      </AppText>
      {goal ? (
        <AppText
          style={[styles.goal, !goal.achieved && styles.goalMissed]}
          numberOfLines={1}
        >
          {goal.text}
        </AppText>
      ) : null}
    </View>
  );
}

function Figure({
  label,
  value,
  unit,
  size,
}: {
  label: string;
  value: string;
  unit?: string;
  size: 'big' | 'mid' | 'small';
}) {
  return (
    <View>
      <BarLabel label={label} />
      <View style={styles.figureValue}>
        <AppText
          style={
            size === 'big'
              ? styles.big
              : size === 'mid'
              ? styles.mid
              : styles.small
          }
        >
          {value}
          {unit ? (
            <AppText style={size === 'big' ? styles.unitBig : styles.unit}>
              {unit}
            </AppText>
          ) : null}
        </AppText>
      </View>
    </View>
  );
}

// One line of 2.1 최근 러닝's list: the name on the left, the value (and its unit) on the right, a note under it.
function InfoRow({
  label,
  value,
  unit,
  note,
  first = false,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
  first?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !first && styles.rule]}>
      <AppText style={styles.infoLabel}>{label}</AppText>
      <View style={styles.infoRight}>
        <AppText style={styles.infoValue}>
          {value}
          {unit ? <AppText style={styles.infoUnit}>{unit}</AppText> : null}
        </AppText>
        {note ? <AppText style={styles.homeNote}>{note}</AppText> : null}
      </View>
    </View>
  );
}

// The card's turn button: the turning arrow and its words together (담당자 요청서: 회전 아이콘과 텍스트).
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
      style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]}
    >
      <AppText style={styles.homeButtonText}>{label}</AppText>
      <Icon
        name="refresh"
        color={recordsLook.ink}
        size={16}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

// 목표 시간 30:00보다 19초 빨리 마쳤어요, said without 달성 · 미달성 (담당자 요청서: 성공·실패로 단정하지 않음).
function durationLine(record: RunRecordDetail) {
  if (record.targetDurationSec === null) {
    return null;
  }
  const gap = Math.round(record.targetDurationSec - record.durationSec);
  const target = formatDuration(record.targetDurationSec);
  return gap === 0
    ? `목표 시간 ${target}에 맞춰 마쳤어요.`
    : `목표 시간 ${target}보다 ${formatGap(gap)} ${
        gap > 0 ? '빨리' : '늦게'
      } 마쳤어요.`;
}

// 2.1 홈 러닝 분석 (S15P31E105-615, 담당자 요청서): one run seen two ways on a card that turns. The run's date and name
// stay above both faces, so either face is about the same run; a new date or run mounts a new card, front up.
// 앞면 러닝 결과: the pace and heart rate lines (a tap opens 기록 상세), 거리 · 시간 · 평균 페이스 · 평균 심박, 목표와
// 비교하기. 뒷면 목표와 비교: a line from the average against the run's own target pace, the two paces, how many of
// the API's splits fell within ±10초/km of it, which ran faster or slower, and 러닝 결과 보기. Faster or slower is
// only said, never judged; nothing unmeasured reads 0 or 정상.
function HomeRecord({
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
  const lines =
    seen.pace || seen.heart ? (
      <View>
        <BarLabel label="페이스와 심박 변화" />
        <View style={styles.homeChart}>
          <PaceHeartPreview
            splits={record.splits}
            pace={seen.pace}
            heart={seen.heart}
            height={170}
          />
        </View>
        <AppText style={styles.homeCaption}>
          {notice ?? '달린 속도와 심박수의 변화를 함께 살펴보세요.'}
        </AppText>
      </View>
    ) : null;
  const goal = compareWithGoal(
    record.splits,
    record.averagePaceSecPerKm,
    record.targetPaceSecPerKm,
  );
  const duration = durationLine(record);

  const front = (turn: () => void) => (
    <View style={styles.recordsRoot}>
      {lines && onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={openLabel}
          onPress={onOpen}
          style={({ pressed }) => pressed && styles.pressed}
        >
          {lines}
        </Pressable>
      ) : (
        lines
      )}
      <View>
        <InfoRow
          first
          label="거리"
          value={formatKm(record.distanceM)}
          unit=" km"
        />
        <InfoRow label="시간" value={formatDuration(record.durationSec)} />
        <InfoRow
          label="평균 페이스"
          value={formatPace(record.averagePaceSecPerKm)}
          unit="/km"
        />
        <InfoRow
          label="평균 심박"
          value={
            record.averageHeartRate === null
              ? '기록 없음'
              : String(record.averageHeartRate)
          }
          unit={record.averageHeartRate === null ? undefined : ' bpm'}
        />
      </View>
      <TurnButton label="목표와 비교하기" onPress={turn} />
    </View>
  );

  const back = (turn: () => void) => (
    <View style={styles.recordsRoot}>
      <View>
        <BarLabel label="목표와 비교" />
        {/* Whole words per line on the back too (Android breaks Korean between letters). */}
        <View style={styles.backSummaryBox}>
          <WordWrap
            text={
              goal.kind === 'noTarget'
                ? '목표 페이스 없이 기록한 러닝이에요'
                : goal.summary
            }
            style={styles.backSummary}
            fontSize={20}
          />
        </View>
        {duration ? (
          <View style={styles.backLineBox}>
            <WordWrap text={duration} style={styles.backLine} fontSize={14} />
          </View>
        ) : null}
      </View>
      {goal.kind === 'target' ? (
        <View>
          <InfoRow
            first
            label="목표 페이스"
            value={formatPace(goal.target)}
            unit="/km"
          />
          <InfoRow
            label="실제 평균 페이스"
            value={formatPace(goal.average)}
            unit="/km"
            note={goal.gap}
          />
        </View>
      ) : null}
      {/* The splits against the target as a chart, not sentences (담당자 요청: 말 대신 시각 자료로). */}
      {goal.kind === 'target' && goal.splits ? (
        <View style={[styles.backSplits, styles.rule]}>
          <TargetSplitChart splits={record.splits} target={goal.target} />
        </View>
      ) : null}
      <TurnButton label="러닝 결과 보기" onPress={turn} />
    </View>
  );

  return (
    <View style={styles.recordsRoot}>
      <View>
        <View style={styles.headRow}>
          <View style={styles.chip}>
            <AppText style={styles.chipText}>
              {`${formatLongDate(record.startedAt)} · ${formatClockTime(
                record.startedAt,
              )}`}
            </AppText>
          </View>
        </View>
        <AppText style={styles.name} numberOfLines={1}>
          {record.title}
        </AppText>
      </View>
      <FlipCard front={front} back={back} />
    </View>
  );
}

// The body of the 5.1 and 5.2 cards (runway-records 2차, white on the frost card the frame draws). 5.1 (layout
// records): the head, the average pace large, the split graph and 거리 · 시간 under a line; no metric tabs there
// (담당자 결정). 5.2 (layout detail): the head, the three figures in a row, a line, then the graph of the metric its
// tabs picked. onOpen makes the 5.1 body a link to 5.2.
export function RecordView({
  record,
  chartHeight,
  onOpen,
  openLabel,
  layout = 'records',
  metric = 'pace',
}: {
  record: RunRecordDetail;
  chartHeight: number;
  onOpen?: () => void;
  openLabel?: string;
  // home: 2.1 홈 최근 러닝 (S15P31E105-615).
  layout?: 'records' | 'detail' | 'home';
  metric?: SplitMetric;
}) {
  if (layout === 'home') {
    return <HomeRecord record={record} onOpen={onOpen} openLabel={openLabel} />;
  }
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
  const chart = (
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
  );
  const note = paceNote(record);

  if (layout === 'detail') {
    return (
      <View>
        <View>
          <CardHead record={record} />
          <View style={styles.figures}>
            <Figure
              size="mid"
              label="평균 페이스"
              value={formatPace(record.averagePaceSecPerKm)}
              unit="/km"
            />
            <Figure
              size="mid"
              label="거리"
              value={formatKm(record.distanceM)}
              unit="km"
            />
            <Figure
              size="mid"
              label="시간"
              value={formatDuration(record.durationSec)}
            />
          </View>
          <View style={[styles.rule, styles.ruleGap]}>
            {/* 구간 페이스 · 구간 심박 · 구간 케이던스, after the tab chosen above. */}
            <BarLabel
              label={`구간 ${
                metrics.find(item => item.value === metric)?.label ?? '페이스'
              }`}
            />
          </View>
          <View style={styles.chartGap}>{chart}</View>
        </View>
      </View>
    );
  }

  const body = (
    <>
      <View style={styles.paceBlock}>
        <BarLabel label="평균 페이스" />
        <View style={styles.paceRow}>
          <AppText style={styles.big}>
            {formatPace(record.averagePaceSecPerKm)}
            <AppText style={styles.unitBig}>/km</AppText>
          </AppText>
          {note ? <AppText style={styles.note}>{note}</AppText> : null}
        </View>
      </View>
      <View style={styles.chartGap}>{chart}</View>
      <View style={[styles.foot, styles.rule]}>
        <View style={styles.flex}>
          <Figure
            size="small"
            label="거리"
            value={formatKm(record.distanceM)}
            unit="km"
          />
        </View>
        <View style={styles.flex}>
          <Figure
            size="small"
            label="시간"
            value={formatDuration(record.durationSec)}
          />
        </View>
      </View>
    </>
  );
  return (
    <View style={styles.recordsRoot}>
      <CardHead record={record} />
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={openLabel}
          onPress={onOpen}
          style={({ pressed }) => pressed && styles.pressed}
        >
          {body}
        </Pressable>
      ) : (
        <View>{body}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recordsRoot: { gap: 18 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.92)',
  },
  name: {
    marginTop: 14,
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  goal: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: recordsLook.onCardSub,
  },
  goalMissed: { color: '#F4B7A4' },
  paceBlock: { marginTop: 6 },
  paceRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 16,
    color: recordsLook.onCard,
  },
  chartGap: { marginTop: 16 },
  rule: {
    borderTopWidth: 1,
    borderTopColor: recordsLook.onCardLine,
  },
  foot: {
    marginTop: 24,
    paddingTop: 18,
    flexDirection: 'row',
    gap: 12,
  },
  ruleGap: { paddingTop: 18 },
  figures: {
    marginTop: 22,
    marginBottom: 20,
    flexDirection: 'row',
    gap: 22,
  },
  figureValue: { marginTop: 3 },
  big: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  mid: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  small: {
    fontFamily: fontFamily.bold,
    fontSize: 25,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  unitBig: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    letterSpacing: 0,
    color: recordsLook.onCard,
  },
  unit: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    letterSpacing: 0,
    color: recordsLook.onCard,
  },
  homeChart: { marginTop: 12 },
  homeCaption: {
    marginTop: 10,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  homeNote: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: recordsLook.onCardSub,
    textAlign: 'right',
  },
  infoRow: {
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  infoLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: recordsLook.onCardLabel,
  },
  infoRight: { alignItems: 'flex-end', flexShrink: 1 },
  infoValue: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.4,
    color: recordsLook.onCard,
  },
  infoUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    letterSpacing: 0,
    color: recordsLook.onCard,
  },
  backSummaryBox: { marginTop: 8 },
  backLineBox: { marginTop: 6 },
  backSummary: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  backLine: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: recordsLook.onCardSub,
  },
  backSplits: { paddingTop: 14 },
  homeButton: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  homeButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: recordsLook.ink,
  },
});
