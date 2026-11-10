import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, useCountUp, WordWrap } from '../../components';
import type { ReadinessState, TodayCondition } from '../../data';
import type { SleepAccess, TodaySleep } from '../../health/samsungSleep';
import type { TodayRestingHr } from '../../health/samsungRestingHr';
import { formatMonthDay, formatSleep } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily } from '../../theme';
import { recordsLook } from '../records/look';
import { longDay } from '../records/DatePicker';
import {
  accent,
  LoadCard,
  LoadNotice,
  ScoreReasons,
  ScoreRing,
  scoreText,
  type ReasonRow,
} from './ReadinessFlow';
import { readinessGuide } from './readinessGuide';

// 2.1 홈의 준비도 (S15P31E105-564; S15P31E105-615 담당자 요청서: 점수 나열 대신 "오늘 어떻게 달릴지"): on top the day's
// sentence and its reasons in plain words, then the score and the metrics in full, and 러닝 시작하기 (2.0M) at the foot
// (담당자 요청). R02 gives only the latest score, so it is always today's whatever day the date line shows (담당자 결정:
// 지난 날은 띄우지 않음). A state without a usable score keeps the button that fixes it, under the main one.

const states: Record<
  ReadinessState,
  { action: { title: string; route: RouteName } | null; note: string | null }
> = {
  ready: { action: null, note: null },
  collecting: {
    action: { title: '워치 동기화', route: 'WatchConnect' },
    note: '데이터를 모으는 중이에요',
  },
  stale: {
    action: { title: '워치 동기화', route: 'WatchConnect' },
    note: '데이터가 오래됐어요',
  },
  permissionDenied: {
    action: { title: '설정 열기', route: 'Settings' },
    note: '건강 데이터 권한이 없어요',
  },
  watchDisconnected: {
    action: { title: '워치 연결', route: 'WatchConnect' },
    note: '연결된 워치가 없어요',
  },
};

// The score's grade on top (S15P31E105-594 담당자 요청: "준비도 양호, 보통 이런 느낌"). R02 has no grade yet
// (readiness-formula 6절), so the card names the band of the score itself: 80 and up 양호, 60 and up 보통, else 낮음.
export const gradeOf = (score: number) =>
  score >= 80 ? '양호' : score >= 60 ? '보통' : '낮음';

// The top sentence for the week's load band (weeklyLoadLabel, S15P31E105-599).
const loadSentences: Record<string, string> = {
  '평소보다 적음': '최근 운동량이 평소보다 적어요.',
  '평소와 비슷': '최근 운동량이 평소와 비슷해요.',
  '평소보다 많음': '최근 운동량이 평소보다 많아요.',
  '많이 많음': '최근 운동량이 평소보다 많이 많아요.',
};

// S15P31E105-572: Samsung Health sleep read on this phone. Without a score for today it still shows the latest
// night (today's when there is one), with its source and wake date, and the card asks for sleep access when it is
// missing.
export type PhoneSleep = {
  access: SleepAccess | null;
  today: TodaySleep | null;
  // S15P31E105-600: heart rate access and today's resting heart rate computed on this phone from Samsung Health.
  heartAccess?: SleepAccess | null;
  restingHr?: TodayRestingHr | null;
  // S15P31E105-599: exercise read access for the weekly training load.
  exerciseAccess?: SleepAccess | null;
  requesting: boolean;
  // Asks for sleep, heart rate and exercise together (D-8).
  onConnect: () => void;
};

const needsAccess = (access: SleepAccess | null | undefined) =>
  access === 'notRequested' || access === 'denied' || access === 'revoked';

// What the sleep metric says under a missing value, so 거부·해제·기록 없음·시간 미확인·조회 실패 are told apart.
function phoneSleepNote(sleep: PhoneSleep): string | null {
  if (sleep.access === 'denied') {
    return '삼성 헬스 권한 거부됨';
  }
  if (sleep.access === 'revoked') {
    return '삼성 헬스 권한 해제됨';
  }
  if (sleep.access !== 'granted') {
    return null;
  }
  if (sleep.today?.status === 'empty') {
    return '삼성 헬스 기록 없음';
  }
  if (sleep.today?.status === 'unresolved') {
    return '삼성 헬스 수면 시간 미확인';
  }
  if (sleep.today?.status === 'error') {
    return '삼성 헬스 조회 실패';
  }
  return null;
}

// What 안정 심박 says under a missing value when the phone reads Samsung Health heart rate (D-9). Null falls back to
// the watch/score notes.
function phoneRestingHrNote(sleep: PhoneSleep): string | null {
  if (sleep.heartAccess === 'denied') {
    return '삼성 헬스 권한 거부됨';
  }
  if (sleep.heartAccess === 'revoked') {
    return '삼성 헬스 권한 해제됨';
  }
  if (sleep.heartAccess !== 'granted') {
    return null;
  }
  if (sleep.restingHr?.status === 'insufficient') {
    return '오늘 심박 기록 부족';
  }
  if (sleep.restingHr?.status === 'error') {
    return '삼성 헬스 조회 실패';
  }
  // Granted by the OS state, but the read itself was refused (리뷰 B-4).
  if (sleep.restingHr?.status === 'accessRequired') {
    return '삼성 헬스 권한 확인 필요';
  }
  if (sleep.restingHr?.status === 'unavailable') {
    return '삼성 헬스 사용 불가';
  }
  return null;
}

export function ReadinessPanel({
  today,
  todayDay,
  phoneSleep,
  watchReady = false,
}: {
  today: TodayCondition;
  // Today in KST (YYYY-MM-DD), from 홈's clock.
  todayDay?: string;
  phoneSleep?: PhoneSleep;
  // Fresh watch app response + sensor grants; R02 collecting/stale only describes health data.
  watchReady?: boolean;
}) {
  const navigation = useNavigation();
  // A score made on another day says so and is not called today's (S15P31E105-574): the score's own date against
  // today reads 'N월 N일 기준', not 오늘.
  const isToday = todayDay === undefined || today.date === todayDay;
  const ready = today.readinessState === 'ready';
  const { action, note: fallbackNote } = states[today.readinessState];
  const stateAction =
    watchReady && action?.route === 'WatchConnect' ? null : action;
  const stateNote = watchReady && today.readinessState === 'watchDisconnected'
    ? '데이터를 모으는 중이에요'
    : fallbackNote;
  // Server health consent off: nothing health-related is shown, and the card keeps 설정 열기.
  const consented = today.readinessState !== 'permissionDenied';
  const r02Sleep = ready && today.sleepMinutes !== null;
  // Without R02 sleep for today (no score, a stale score, or a score made from the watch alone) the phone's own
  // read of today's sleep is shown with its source (2026-11-09 사용자 결정, 리뷰 B-3).
  const localSleep =
    consented && !r02Sleep && phoneSleep?.today?.status === 'ready'
      ? phoneSleep.today
      : null;
  const sleepValue = r02Sleep
    ? formatSleep(today.sleepMinutes!)
    : localSleep
    ? formatSleep(Math.round(localSleep.minutes))
    : '– –';
  const sleepSub = r02Sleep
    ? today.sleepLabel
    : localSleep
    ? `삼성 헬스 · ${formatMonthDay(localSleep.date)}`
    : consented && phoneSleep
    ? phoneSleepNote(phoneSleep)
    : ready
    ? today.sleepLabel
    : null;
  // A missing 안정 심박 or 주간 부하 says why (2026-11-09 사용자 결정, 실기기 E2E). R02 gives the resting heart
  // rate and the weekly training load only for the score's own day.
  // S15P31E105-600 (D-9): R02's value with its source first, then today's value computed on this phone from Samsung
  // Health heart rate, then why there is none.
  const r02RestingHeartRate =
    ready && today.restingHeartRate !== null ? today.restingHeartRate : null;
  const localRestingHr =
    consented &&
    r02RestingHeartRate === null &&
    phoneSleep?.restingHr?.status === 'ready' &&
    // A value read before midnight is not today's after it (리뷰 B-1).
    (todayDay === undefined || phoneSleep.restingHr.date === todayDay)
      ? phoneSleep.restingHr
      : null;
  const restingHeartRate =
    r02RestingHeartRate ??
    (localRestingHr ? Math.round(localRestingHr.bpm) : null);
  const restingHeartRateSub =
    r02RestingHeartRate !== null
      ? today.restingHeartRateLabel
      : localRestingHr
      ? '삼성 헬스 · 오늘'
      : !consented
      ? null
      : (phoneSleep && phoneRestingHrNote(phoneSleep)) ??
        (ready ? '오늘 워치 기록 없음' : '준비도 계산 후 표시');
  // S15P31E105-599: R02's last-7-day training load for today's score only (a stale score's load is not today's). A
  // score for today without one means no exercise with heart rate in the last 4 weeks, unless exercise access is off.
  const weeklyLoad = ready && today.weeklyLoad ? today.weeklyLoad : null;
  const weeklyLoadSub =
    weeklyLoad !== null
      ? today.weeklyLoadLabel
      : !consented
      ? null
      : phoneSleep?.exerciseAccess === 'denied'
      ? '삼성 헬스 권한 거부됨'
      : phoneSleep?.exerciseAccess === 'revoked'
      ? '삼성 헬스 권한 해제됨'
      : ready
      ? '최근 4주 심박 기록 운동 없음'
      : '수집 전';
  // Users who allowed sleep and heart rate before exercise was added (S15P31E105-600) get the button again.
  const connect =
    consented &&
    phoneSleep &&
    ((needsAccess(phoneSleep.access) && !r02Sleep) ||
      (needsAccess(phoneSleep.heartAccess) && r02RestingHeartRate === null) ||
      (needsAccess(phoneSleep.exerciseAccess) && weeklyLoad === null));
  // 최근 운동량 shows one plain line (S15P31E105-615: 전문용어 노출 금지): the last 7 days and how it compares with
  // usual, e.g. "30 · 많이 많음"; without a value, the reason instead.
  const recentLoad =
    weeklyLoad !== null
      ? weeklyLoadSub
        ? `${weeklyLoad} · ${weeklyLoadSub}`
        : weeklyLoad
      : null;
  // 2.P′ 오래된 데이터 says when the last score was made, when it is known.
  const note =
    today.readinessState === 'stale' && today.lastAssessedDate
      ? `마지막 평가 ${formatMonthDay(today.lastAssessedDate)}`
      : stateNote;
  const score = ready ? today.readinessScore : null;
  const counted = Math.round(useCountUp(score ?? 0));
  const guide = readinessGuide(today, { isToday });
  // S15P31E105-594 담당자 요청: on top the score's grade (준비도 양호 · 보통 · 낮음), and under it the load against the
  // usual week when there is one (the band R02's numbers already give, S15P31E105-599), else the data's own sentence.
  // Both speak of the score's own day, which the date line names. Without a score, why there is none.
  const trainingLoad = ready ? today.trainingLoad ?? null : null;
  const loadSentence =
    ready && today.weeklyLoadLabel
      ? loadSentences[today.weeklyLoadLabel] ?? null
      : null;
  const headline = score !== null ? `준비도 ${gradeOf(score)}` : null;
  const lead =
    score === null
      ? note
      : loadSentence ??
        (guide.judged
          ? guide.title
          : '운동 기록과 회복 상태를 함께 살펴보세요.');
  const factors = ready ? today.scoreFactors ?? null : null;
  const ratio =
    trainingLoad && trainingLoad.usual !== null && trainingLoad.usual > 0
      ? trainingLoad.weekly / trainingLoad.usual
      : null;
  const change = factors?.restingHrChangePct ?? null;
  const rows: ReasonRow[] = [
    {
      name: '수면',
      score: factors?.sleep ?? null,
      detail: '최근 3일 반영',
      value: sleepValue,
      note: sleepSub,
    },
    {
      name: '안정 심박',
      score: factors?.recovery ?? null,
      detail:
        change === null
          ? '평소 대비'
          : `평소 대비 ${change > 0 ? '+' : ''}${scoreText(change)}%`,
      value: restingHeartRate !== null ? `${restingHeartRate}회/분` : '– –',
      note: restingHeartRateSub,
    },
    {
      name: '최근 운동량',
      score: factors?.load ?? null,
      detail:
        ratio === null
          ? null
          : `평소의 ${scoreText(Math.round(ratio * 10) / 10)}배`,
      value: recentLoad ?? '– –',
      note: recentLoad === null ? weeklyLoadSub : null,
    },
  ];
  const { month, date } = {
    month: Number(today.date.slice(5, 7)),
    date: Number(today.date.slice(8, 10)),
  };
  return (
    <View>
      <View style={styles.head}>
        <AppText style={styles.headTitle}>
          {isToday ? '오늘의 준비도' : '준비도'}
        </AppText>
        <AppText style={styles.headDate}>
          {isToday ? `${month}월 ${date}일` : `${longDay(today.date)} 기준`}
        </AppText>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroText}>
          {headline ? (
            <WordWrap text={headline} style={styles.headline} fontSize={24} />
          ) : null}
          {lead ? (
            <View style={headline ? styles.leadBox : null}>
              <WordWrap text={lead} style={styles.lead} fontSize={13.5} />
            </View>
          ) : null}
        </View>
        <ScoreRing score={score} counted={counted} />
      </View>

      {trainingLoad ? (
        <LoadNotice
          load={trainingLoad}
          loadScored={typeof factors?.load === 'number'}
        />
      ) : null}

      {consented ? (
        <>
          <LoadCard
            day={today.date}
            isToday={isToday}
            load={trainingLoad}
            reason={weeklyLoadSub}
          />
          <ScoreReasons
            score={score}
            title={
              score !== null && factors
                ? `왜 ${score}점인가요?`
                : '준비도에 들어가는 기록'
            }
            rows={rows}
          />
        </>
      ) : null}

      {connect ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="삼성 헬스 연결"
          accessibilityState={{ busy: phoneSleep.requesting }}
          disabled={phoneSleep.requesting}
          onPress={phoneSleep.onConnect}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <AppText style={styles.secondaryText}>삼성 헬스 연결</AppText>
        </Pressable>
      ) : stateAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stateAction.title}
          onPress={() => navigateTo(navigation, stateAction.route)}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <AppText style={styles.secondaryText}>{stateAction.title}</AppText>
        </Pressable>
      ) : null}

      {/* The card's last and main action (담당자 요청: 맨 밑에 러닝 시작하기): the run tab's first step, 2.0M. Nothing
          there is changed by readiness (담당자 요청서: 자동 변경 없음). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="러닝 시작하기"
        onPress={() => navigateTo(navigation, 'RunMode')}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <AppText style={styles.actionText}>러닝 시작하기</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
    color: recordsLook.onCard,
  },
  headDate: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardMuted,
  },
  hero: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroText: { flex: 1 },
  headline: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: recordsLook.onCard,
  },
  leadBox: { marginTop: 10 },
  lead: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 20,
    color: recordsLook.onCardSub,
  },
  secondary: {
    marginTop: 22,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: recordsLook.onCard,
  },
  action: {
    marginTop: 12,
    height: 54,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    // The card's one accent, mint (담당자 결정, S15P31E105-594).
    backgroundColor: accent,
  },
  pressed: { opacity: 0.75 },
  actionText: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    color: recordsLook.ink,
  },
});
