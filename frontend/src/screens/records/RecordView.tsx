import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import { runRouteOf } from '../../components/mapRoute';
import { useRepositories, type RunRecordDetail } from '../../data';
import { errorCode } from '../../data/errors';
import {
  formatDuration,
  formatKm,
  formatLongDate,
  formatPace,
} from '../../format';
import { fontFamily } from '../../theme';
import { BarLabel, recordsLook } from './look';
import { HomeRecord } from './HomeAnalysis';
import { RunRouteMap } from './RunRoute';
import { SplitChart, type SplitMetric } from './SplitChart';

// 19초 or 1분 50초.
export function formatGap(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)}분 ${rounded % 60}초`
    : `${rounded}초`;
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

// The date chip (no RUNWAY, 담당자 결정), the run's name and the goal line: the top of the 5.1 card.
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
  size: 'big' | 'small';
}) {
  return (
    <View>
      <BarLabel label={label} />
      <View style={styles.figureValue}>
        <AppText style={size === 'big' ? styles.big : styles.small}>
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

// The body of the 5.1 card (runway-records 2차, white on the frost card the frame draws): the head, the average pace
// large, the split graph and 거리 · 시간 under a line; no metric tabs there (담당자 결정). onOpen makes the body a link.
// 5.2's layout (기록 상세) was dropped with its screen (S15P31E105-594 담당자 결정).
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
  layout?: 'records' | 'home';
  metric?: SplitMetric;
}) {
  // The run's GPS route (S11) on the map with 경로 재생, never joined across its breaks (S15P31E105-690).
  const route = useMemo(
    () => runRouteOf(record.routeParts),
    [record.routeParts],
  );
  const facts = useMemo(
    () => ({
      id: record.id,
      title: record.title,
      startedAt: record.startedAt,
      distanceM: record.distanceM,
      durationSec: record.durationSec,
      averagePaceSecPerKm: record.averagePaceSecPerKm,
      cadence: average(record.splits.map(split => split.averageCadence)),
    }),
    [record],
  );
  if (layout === 'home') {
    return (
      <HomeRecord
        record={record}
        onOpen={onOpen}
        openLabel={openLabel}
        action={
          record.runType === 'SOLO' && !record.courseId ? (
            <SaveCourseButton key={record.id} recordId={record.id} />
          ) : null
        }
        route={route}
        facts={facts}
      />
    );
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
      {record.runType === 'SOLO' && !record.courseId ? (
        <SaveCourseButton recordId={record.id} />
      ) : null}
      <RunRouteMap
        route={route}
        facts={facts}
        tone="card"
        style={styles.route}
      />
    </View>
  );
}

function SaveCourseButton({ recordId }: { recordId: string }) {
  const { courses } = useRepositories();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const save = async () => {
    if (state === 'saving' || state === 'saved') return;
    setState('saving');
    try {
      await courses.saveFromRun(recordId);
      setState('saved');
      setMessage('내 코스에 저장했어요.');
    } catch (error) {
      setState('failed');
      const code = errorCode(error);
      setMessage(
        code === 'COURSE_GRADE_NOT_READY' || code === 'COURSE_GRADE_UNAVAILABLE'
          ? '경사 정보를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.'
          : code === 'VALIDATION_ERROR'
          ? '코스로 만들 GPS 경로가 부족해요.'
          : '코스를 저장하지 못했어요. 다시 시도해 주세요.',
      );
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="코스로 정하기"
        accessibilityState={{
          disabled: state === 'saving' || state === 'saved',
        }}
        disabled={state === 'saving' || state === 'saved'}
        onPress={() => {
          void save();
        }}
      >
        <AppText style={styles.saveCourseLabel}>
          {state === 'saving'
            ? '코스 저장 중'
            : state === 'saved'
            ? '코스 저장 완료'
            : '코스로 정하기'}
        </AppText>
      </Pressable>
      {message ? (
        <AppText style={styles.saveCourseMessage}>{message}</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  recordsRoot: { gap: 18 },
  saveCourseLabel: {
    color: recordsLook.onCard,
    fontFamily: fontFamily.bold,
    textAlign: 'center',
  },
  saveCourseMessage: {
    color: recordsLook.onCard,
    fontFamily: fontFamily.regular,
    textAlign: 'center',
    marginTop: 6,
  },
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
  goalMissed: { color: '#E79B9B' },
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
  route: { height: 200 },
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
  figureValue: { marginTop: 3 },
  big: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
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
});
