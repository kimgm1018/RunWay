import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, useCountUp, type IconName } from '../../components';
import type { ReadinessState, TodayCondition } from '../../data';
import type { SleepAccess, TodaySleep } from '../../health/samsungSleep';
import { formatMonthDay, formatSleep } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { fontFamily } from '../../theme';
import { recordsLook } from '../records/look';
import { longDay } from '../records/DatePicker';

// 2.1 홈의 준비도 (S15P31E105-564, 담당자 결정): today's readiness on the frost card, laid out like 5.1's run
// card. R02 gives only the latest score, so it is always today's whatever day the date line shows (담당자 결정:
// 지난 날은 띄우지 않음). 러닝 시작 left with the old card (하단 탭에 러닝); a state without a usable score keeps the
// button that fixes it.

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

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricLabel}>
        <Icon
          name={icon}
          color={recordsLook.onCardLabel}
          size={13}
          strokeWidth={2}
        />
        <AppText style={styles.label}>{label}</AppText>
      </View>
      <AppText style={styles.metricValue}>{value}</AppText>
      {sub ? <AppText style={styles.metricSub}>{sub}</AppText> : null}
    </View>
  );
}

// The score on a 0–100 line: the filled part up to the score, a white dot at it.
function Gauge({ score }: { score: number | null }) {
  const share = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <View style={styles.gauge}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      {score === null ? null : (
        <View style={[styles.knob, { left: `${share * 100}%` }]} />
      )}
      <View style={styles.ends}>
        <AppText style={styles.end}>0</AppText>
        <AppText style={styles.end}>100</AppText>
      </View>
    </View>
  );
}

// S15P31E105-572: Samsung Health sleep read on this phone. Without a score for today it still shows the latest
// night (today's when there is one), with its source and wake date, and the card asks for sleep access when it is
// missing.
export type PhoneSleep = {
  access: SleepAccess | null;
  today: TodaySleep | null;
  requesting: boolean;
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

export function ReadinessPanel({
  today,
  phoneSleep,
}: {
  today: TodayCondition;
  phoneSleep?: PhoneSleep;
}) {
  const navigation = useNavigation();
  const ready = today.readinessState === 'ready';
  const { action: stateAction, note: stateNote } =
    states[today.readinessState];
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
  const connect =
    consented && phoneSleep && needsAccess(phoneSleep.access) && !r02Sleep;
  // A missing 안정 심박 or 주간 부하 says why (2026-11-09 사용자 결정, 실기기 E2E). R02 gives the resting heart
  // rate only for the score's own day, and nothing collects training load yet (readiness-formula 7.1).
  const restingHeartRate =
    ready && today.restingHeartRate !== null ? today.restingHeartRate : null;
  const restingHeartRateSub =
    restingHeartRate !== null
      ? today.restingHeartRateLabel
      : !consented
      ? null
      : ready
      ? '오늘 워치 기록 없음'
      : '준비도 계산 후 표시';
  const weeklyLoad = ready && today.weeklyLoad ? today.weeklyLoad : null;
  const weeklyLoadSub =
    weeklyLoad !== null ? today.weeklyLoadLabel : consented ? '수집 전' : null;
  // 2.P′ 오래된 데이터 says when the last score was made, when it is known.
  const note =
    today.readinessState === 'stale' && today.lastAssessedDate
      ? `마지막 평가 ${formatMonthDay(today.lastAssessedDate)}`
      : stateNote;
  const score = ready ? today.readinessScore : null;
  const counted = Math.round(useCountUp(score ?? 0));
  // R02 has no grade yet: the title names one only when the data has it (mock data).
  const [grade, advice] = today.readinessSummary?.split(' · ') ?? [];
  return (
    <View>
      <View style={styles.chip}>
        <AppText style={styles.chipText}>{longDay(today.date)}</AppText>
      </View>
      <AppText style={styles.title}>
        {ready && grade ? `오늘 준비도 ${grade}` : '오늘 준비도'}
      </AppText>
      {ready && advice ? (
        <AppText style={styles.subtitle}>{advice}</AppText>
      ) : note ? (
        <AppText style={styles.subtitle}>{note}</AppText>
      ) : null}

      <View style={styles.scoreBlock}>
        <AppText style={styles.label}>준비도</AppText>
        <AppText
          style={styles.score}
          accessibilityLabel={`준비도 ${score ?? '없음'}`}
        >
          {score === null ? '--' : String(counted)}
          <AppText style={styles.scoreUnit}> /100</AppText>
        </AppText>
        <Gauge score={score} />
      </View>

      <View style={styles.metrics}>
        <Metric
          icon="moon"
          label="수면"
          value={sleepValue}
          sub={sleepSub}
        />
        <Metric
          icon="heart"
          label="안정 심박"
          value={
            restingHeartRate !== null ? `${restingHeartRate} bpm` : '– –'
          }
          sub={restingHeartRateSub}
        />
        <Metric
          icon="activity"
          label="주간 부하"
          value={weeklyLoad ?? '– –'}
          sub={weeklyLoadSub}
        />
      </View>

      {ready && today.aiAdvice ? (
        <View style={styles.advice}>
          <AppText style={styles.label}>오늘의 조언</AppText>
          <AppText style={styles.adviceText}>{today.aiAdvice}</AppText>
        </View>
      ) : null}

      {connect ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="삼성 헬스 연결"
          accessibilityState={{ busy: phoneSleep.requesting }}
          disabled={phoneSleep.requesting}
          onPress={phoneSleep.onConnect}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText style={styles.actionText}>삼성 헬스 연결</AppText>
        </Pressable>
      ) : stateAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stateAction.title}
          onPress={() => navigateTo(navigation, stateAction.route)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText style={styles.actionText}>{stateAction.title}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
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
  title: {
    marginTop: 14,
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  subtitle: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: recordsLook.onCardSub,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCardLabel,
  },
  scoreBlock: { marginTop: 26 },
  score: {
    marginTop: 2,
    fontFamily: fontFamily.bold,
    fontSize: 64,
    lineHeight: 72,
    letterSpacing: -2,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  scoreUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    letterSpacing: 0,
    color: recordsLook.onCardSub,
  },
  gauge: { marginTop: 14, height: 34 },
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
  knob: {
    position: 'absolute',
    top: -4,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  },
  ends: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  end: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardMuted,
  },
  metrics: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: recordsLook.onCardLine,
    flexDirection: 'row',
    gap: 12,
  },
  metric: { flex: 1 },
  metricLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricValue: {
    marginTop: 4,
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: recordsLook.onCard,
  },
  metricSub: {
    marginTop: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCardSub,
  },
  advice: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: recordsLook.onCardLine,
    gap: 6,
  },
  adviceText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: recordsLook.onCard,
  },
  action: {
    marginTop: 24,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  pressed: { opacity: 0.75 },
  actionText: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    color: recordsLook.ink,
  },
});
