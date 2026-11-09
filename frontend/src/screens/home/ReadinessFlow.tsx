import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText, Icon, WordWrap } from '../../components';
import {
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { formatDuration, formatKm } from '../../format';
import { fontFamily } from '../../theme';
import { recordsLook } from '../records/look';
import { measured } from '../records/paceHeart';
import { PaceHeartPreview } from '../records/PaceHeartPreview';
import { addDays, kstDay } from '../records/parts';

// 2.1 준비도 리포트 (S15P31E105-615, 담당자 요청: "어제 이렇게 뛰었으니 오늘의 준비도는 이렇다"를 글보다 시각화로): three
// steps joined by a rail, read top to bottom — 최근 러닝 (the newest run of the 7 days before, its date by the step's
// title, drawn as its pace and heart rate by km), 지난밤 회복
// (sleep on a bar with the formula's 7시간 mark, the resting heart rate), 오늘 준비도 (the score and which records went
// into it). The score is the server's (R02) and nothing here recomputes it. Yesterday's run reaches the score only
// through 최근 운동량 (readiness-formula 5절), which nothing collects yet; the card says so rather than draw a link the
// score does not have.

// readiness-formula 3절: 7시간 이상 is the sleep score's top; the bar runs a little past it.
export const sleepFullMinutes = 7 * 60;
const sleepScaleMinutes = 9 * 60;

export type FlowInputs = {
  // The score's own day (YYYY-MM-DD), and whether that is today.
  day: string;
  isToday: boolean;
  sleep: { value: string; minutes: number | null; sub: string | null };
  heart: { value: string; sub: string | null };
  readiness: {
    title: string;
    note: string | null;
    score: number | null;
    counted: number;
    gauge: React.ReactNode;
  };
  load: { value: string | null; sub: string | null };
  // Without health consent nothing health-related is shown.
  consented: boolean;
};

// One step: its number on the rail, a line down to the next one with an arrow, and its content.
function Step({
  index,
  title,
  aside,
  last = false,
  children,
}: {
  index: number;
  title: string;
  // A short note to the title's right, e.g. the recent run's date.
  aside?: string | null;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <View style={styles.dot}>
          <AppText style={styles.dotText}>{String(index)}</AppText>
        </View>
        {last ? null : (
          <>
            <View style={styles.line} />
            <Icon
              name="chevronDown"
              color={recordsLook.onCardMuted}
              size={14}
              strokeWidth={2.4}
            />
          </>
        )}
      </View>
      <View style={[styles.body, last && styles.bodyLast]}>
        <View style={styles.stepHead}>
          <AppText style={styles.stepTitle}>{title}</AppText>
          {aside ? <AppText style={styles.aside}>{aside}</AppText> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

// readiness-formula 5절: 최근 운동량 is the last 7 days, so the run shown is the newest within them, before the
// score's day.
const recentDays = 7;
const loadRecent = (repositories: Repositories) =>
  repositories.records.getRecent('recent', 20);

// 10/15: the recent run's day by step 1's title (담당자 요청: 4일 전 · 10월 15일 칩 대신).
const shortDay = (value: string) => {
  const [, month, date] = value.split('-').map(Number);
  return `${month}/${date}`;
};

// Step 1's run: the newest in the 7 days before the score's day, and its detail.
function useRecentRun(day: string) {
  const recent = useResource(loadRecent);
  const from = addDays(day, -recentDays);
  const newest: RunRecordSummary | null =
    recent.status === 'ready'
      ? recent.data.find(run => {
          const ran = kstDay(run.startedAt);
          return ran < day && ran >= from;
        }) ?? null
      : null;
  const detail = useResource(
    useCallback(
      async (repositories: Repositories) =>
        newest ? repositories.records.getDetail(newest.id) : null,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [newest?.id],
    ),
  );
  return { recent, newest, detail };
}

function RecentRun({
  recent,
  newest,
  detail,
}: ReturnType<typeof useRecentRun>) {
  // The detail is this run's only once it carries its id; until then (the run just found, the old answer still
  // held) it is still loading.
  const record =
    newest && detail.status === 'ready' && detail.data?.id === newest.id
      ? detail.data
      : null;
  if (
    recent.status === 'loading' ||
    (newest && !record && detail.status !== 'error')
  ) {
    return <ActivityIndicator style={styles.loading} color="#FFFFFF" />;
  }
  if (recent.status === 'error') {
    return <AppText style={styles.sub}>러닝 기록을 불러오지 못했어요</AppText>;
  }
  if (!newest) {
    return (
      <AppText style={styles.sub}>
        {`최근 ${recentDays}일 동안 기록된 러닝이 없어요`}
      </AppText>
    );
  }
  const seen = record ? measured(record.splits) : null;
  return (
    <View>
      <AppText style={styles.value} numberOfLines={1}>
        {newest.title}
      </AppText>
      {/* The run as a chart, not figures (담당자 요청): pace and heart rate by km with their averages dashed, its
          length and time at the axis' end. */}
      {record && seen && (seen.pace || seen.heart) ? (
        <View style={styles.chart}>
          <PaceHeartPreview
            splits={record.splits}
            pace={seen.pace}
            heart={seen.heart}
            height={110}
            averages={{
              pace: newest.averagePaceSecPerKm,
              heart: record.averageHeartRate,
            }}
            foot={`${formatKm(newest.distanceM)}km · ${formatDuration(
              newest.durationSec,
            )}`}
          />
        </View>
      ) : null}
    </View>
  );
}

// Step 2's sleep: hours on a bar, with the formula's 7시간 mark.
function SleepBar({ minutes }: { minutes: number }) {
  const share = Math.min(minutes / sleepScaleMinutes, 1);
  const mark = sleepFullMinutes / sleepScaleMinutes;
  return (
    <View style={styles.sleepBar}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      <View style={[styles.mark, { left: `${mark * 100}%` }]} />
      <AppText style={[styles.markText, { left: `${mark * 100}%` }]}>
        7시간
      </AppText>
    </View>
  );
}

// A record that went into the score, or why it did not.
function Input({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.input}>
      <AppText style={styles.inputLabel}>{label}</AppText>
      <AppText style={styles.inputValue}>{value}</AppText>
    </View>
  );
}

export function ReadinessFlow({
  day,
  isToday,
  sleep,
  heart,
  readiness,
  load,
  consented,
}: FlowInputs) {
  const recentRun = useRecentRun(day);
  const used = (value: string | null) =>
    value !== null && value !== '– –' ? '반영' : '기록 없음';
  return (
    <View style={styles.flow}>
      <Step
        index={1}
        title="최근 러닝"
        aside={
          recentRun.newest ? shortDay(kstDay(recentRun.newest.startedAt)) : null
        }
      >
        <RecentRun {...recentRun} />
      </Step>

      <Step index={2} title={isToday ? '지난밤 회복' : '그날 회복'}>
        {consented ? (
          <>
            <View style={styles.pair}>
              <View style={styles.half}>
                <AppText style={styles.label}>수면</AppText>
                <AppText style={styles.value}>{sleep.value}</AppText>
                {sleep.sub ? (
                  <AppText style={styles.sub}>{sleep.sub}</AppText>
                ) : null}
              </View>
              <View style={styles.half}>
                <AppText style={styles.label}>안정 시 심박</AppText>
                <AppText style={styles.value}>{heart.value}</AppText>
                {heart.sub ? (
                  <AppText style={styles.sub}>{heart.sub}</AppText>
                ) : null}
              </View>
            </View>
            {sleep.minutes !== null ? (
              <SleepBar minutes={sleep.minutes} />
            ) : null}
          </>
        ) : (
          <AppText style={styles.sub}>건강 데이터 권한이 없어요</AppText>
        )}
      </Step>

      <Step index={3} title={readiness.title} last>
        {readiness.note ? (
          <AppText style={styles.sub}>{readiness.note}</AppText>
        ) : null}
        <AppText
          style={styles.score}
          accessibilityLabel={`준비도 ${readiness.score ?? '없음'}`}
        >
          {readiness.score === null ? '--' : String(readiness.counted)}
          <AppText style={styles.scoreUnit}> /100</AppText>
        </AppText>
        {readiness.gauge}
        {consented ? (
          <View style={styles.inputs}>
            <AppText style={styles.label}>점수에 들어간 기록</AppText>
            <Input label="수면" value={used(sleep.value)} />
            <Input label="안정 시 심박" value={used(heart.value)} />
            <Input
              label="최근 운동량"
              value={load.value ?? load.sub ?? '– –'}
            />
            {load.value === null ? (
              <View style={styles.loadNote}>
                <WordWrap
                  text="최근 러닝은 최근 운동량으로 점수에 들어가요. 아직 수집 전이라 이 점수에는 반영되지 않았어요."
                  style={styles.small}
                  fontSize={12}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Step>
    </View>
  );
}

const styles = StyleSheet.create({
  flow: { marginTop: 22 },
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 24, alignItems: 'center' },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: recordsLook.ink,
  },
  line: {
    flex: 1,
    width: 2,
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  body: { flex: 1, paddingBottom: 22 },
  bodyLast: { paddingBottom: 0 },
  stepHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    columnGap: 8,
    marginBottom: 6,
  },
  stepTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 24,
    color: recordsLook.onCard,
  },
  aside: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardMuted,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCardLabel,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: recordsLook.onCard,
  },
  sub: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCardSub,
  },
  chart: { marginTop: 10 },
  small: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardMuted,
  },
  loading: { marginVertical: 8, alignSelf: 'flex-start' },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  sleepBar: { marginTop: 12, height: 30 },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  mark: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 14,
    marginLeft: -1,
    backgroundColor: '#FFFFFF',
  },
  markText: {
    position: 'absolute',
    top: 13,
    width: 40,
    marginLeft: -20,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 14,
    color: recordsLook.onCardMuted,
  },
  score: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 52,
    lineHeight: 60,
    letterSpacing: -1.6,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  scoreUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    letterSpacing: 0,
    color: recordsLook.onCardSub,
  },
  inputs: { marginTop: 4, gap: 6 },
  input: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  inputLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  inputValue: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCard,
  },
  loadNote: { marginTop: -2 },
});
