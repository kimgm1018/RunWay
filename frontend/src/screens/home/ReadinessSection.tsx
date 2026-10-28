import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button } from '../../components';
import type { ReadinessState, TodayCondition } from '../../data';
import { formatClockTime, formatMonthDay, formatSleep } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { radius, spacing, useTheme } from '../../theme';

type Fallback = {
  pill: string;
  headline: string;
  emphasis: string;
  explain: string;
  action?: { title: string; route: RouteName };
};

// 2.1 states ②–⑤: no confirmed score and nothing that looks like a health-based recommendation.
function fallbackFor(today: TodayCondition): Fallback | null {
  const states: Record<Exclude<ReadinessState, 'ready'>, Fallback> = {
    collecting: {
      pill: '평가 전',
      headline: '준비도 수집 중',
      emphasis: '점수 산출 전',
      explain:
        '건강 데이터가 모이면 준비도를 알려 드려요. 지금은 수준·목표 기준으로 추천해요.',
    },
    stale: {
      pill: '평가 전',
      headline: today.lastAssessedDate
        ? `마지막 평가 ${formatMonthDay(today.lastAssessedDate)}`
        : '오래된 데이터',
      emphasis: '오늘 점수로 쓰지 않아요',
      explain: '워치를 동기화하면 오늘 준비도를 다시 평가해요.',
      action: { title: '워치 동기화', route: 'WatchConnect' },
    },
    permissionDenied: {
      pill: '평가 전',
      headline: '건강 데이터',
      emphasis: '권한 없음',
      explain:
        '설정 > Health Connect에서 권한을 허용하면 준비도를 볼 수 있어요.',
      action: { title: '설정 열기', route: 'Settings' },
    },
    watchDisconnected: {
      pill: '평가 전',
      headline: '워치',
      emphasis: '미연결',
      explain: '설정에서 워치를 연결하면 준비도를 볼 수 있어요.',
      action: { title: '워치 연결', route: 'WatchConnect' },
    },
  };
  return today.readinessState === 'ready' ? null : states[today.readinessState];
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: colors.surfaceMuted }]}>
      <AppText style={styles.tiny} tone="textTertiary">
        {label}
      </AppText>
      <AppText variant="metric">
        {value}
        {unit ? (
          <AppText variant="label" tone="textTertiary">
            {unit}
          </AppText>
        ) : null}
      </AppText>
      {note ? (
        <AppText style={styles.tiny} tone="accentText">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

// 2.1 오늘 컨디션 · 자동 평가: the condition pill and the readiness card.
export function ReadinessSection({ today }: { today: TodayCondition }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const fallback = fallbackFor(today);
  const synced = today.syncedAt
    ? `${formatClockTime(today.syncedAt)} 동기화`
    : '동기화 전';
  const glass = { backgroundColor: colors.surface, borderColor: colors.border };
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <AppText variant="heading">오늘 컨디션 · 자동 평가</AppText>
        <AppText variant="label" tone="textTertiary">
          {today.syncedAt
            ? `${formatMonthDay(today.syncedAt)} · ${synced}`
            : synced}
        </AppText>
      </View>
      <View style={[styles.pill, glass]}>
        <AppText variant="captionStrong" style={styles.pillLabel}>
          오늘 컨디션
        </AppText>
        <AppText
          variant="captionStrong"
          tone={fallback ? 'textTertiary' : 'accentText'}
          style={styles.pillValue}
        >
          {fallback ? fallback.pill : today.condition}
        </AppText>
        <AppText variant="label" tone="textSecondary" style={styles.pillNote}>
          건강·활동 정보로 자동 평가
        </AppText>
      </View>
      <View style={[styles.card, glass]}>
        <View style={styles.cardHead}>
          <AppText variant="caption" tone="textTertiary">
            오늘의 준비도
          </AppText>
          <AppText variant="caption" tone="textTertiary">
            {synced}
          </AppText>
        </View>
        <View style={styles.scoreRow}>
          <AppText
            variant="metricHero"
            tone={fallback ? 'textDisabled' : 'text'}
          >
            {fallback ? '– –' : today.readinessScore}
          </AppText>
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            {fallback ? fallback.headline : '/100'}
            {'\n'}
            <AppText variant="captionStrong" tone="accentText">
              {fallback
                ? fallback.emphasis
                : today.readinessSummary?.split(' · ')[0]}
            </AppText>
            {!fallback && today.readinessSummary?.includes(' · ')
              ? ` · ${today.readinessSummary.split(' · ').slice(1).join(' · ')}`
              : ''}
          </AppText>
        </View>
        {fallback ? (
          <>
            <AppText variant="caption" tone="textSecondary">
              {fallback.explain}
            </AppText>
            {fallback.action ? (
              <Button
                title={fallback.action.title}
                variant="secondary"
                size="small"
                style={styles.action}
                onPress={() => navigateTo(navigation, fallback.action!.route)}
              />
            ) : null}
          </>
        ) : (
          <>
            <View style={[styles.track, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${today.readinessScore ?? 0}%`,
                    backgroundColor: colors.accent,
                  },
                ]}
              />
            </View>
            <View style={styles.metrics}>
              <Metric
                label="수면"
                value={
                  today.sleepMinutes === null
                    ? '– –'
                    : formatSleep(today.sleepMinutes)
                }
                note={today.sleepLabel}
              />
              <Metric
                label="안정 심박"
                value={
                  today.restingHeartRate === null
                    ? '– –'
                    : String(today.restingHeartRate)
                }
                unit=" bpm"
                note={today.restingHeartRateLabel}
              />
              <Metric
                label="7일 부하"
                value={today.weeklyLoad ?? '– –'}
                note={today.weeklyLoadLabel}
              />
            </View>
            {today.aiAdvice ? (
              <AppText variant="caption" tone="textSecondary">
                <AppText variant="captionStrong" tone="accentText">
                  AI
                </AppText>{' '}
                {today.aiAdvice}
              </AppText>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: spacing.md, marginHorizontal: -spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xs,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  pillLabel: { paddingVertical: 9, paddingHorizontal: spacing.xl },
  pillValue: { flex: 1 },
  pillNote: { paddingHorizontal: spacing.xl },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: spacing.xxl,
    paddingHorizontal: 18,
    gap: spacing.xl,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xl },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  metrics: { flexDirection: 'row', gap: spacing.md },
  metric: {
    flex: 1,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
  },
  tiny: { fontSize: 10, lineHeight: 14 },
  action: { alignSelf: 'flex-start' },
});
