import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon } from '../../components';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { RouteLine } from '../course/RouteLine';
import { useRunSession } from '../run/RunSession';
import { GroupBackground, groupLook, Raised, SectionLabel } from './look';
import { BackButton } from '../../components/BackButton';

const stateOrder = {
  FINISHED: 0,
  RUNNING: 1,
  STOPPED: 2,
  UNCONFIRMED: 3,
  NOT_STARTED: 4,
};

// A figure with its unit and label under it, straight on the background (6.7-StatTiles).
function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statLine}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? <AppText style={styles.statUnit}>{unit}</AppText> : null}
      </View>
      <AppText style={styles.statLabel}>{label}</AppText>
    </View>
  );
}

// 6.7-ResultHero: the back button and the run's title chip, the group's average pace as the big number, and
// the result line. The course loop stays faint behind it.
function Hero({
  title,
  headline,
  averagePace,
  route,
  onBack,
}: {
  title: string;
  headline: string;
  averagePace: number | null;
  route: [number, number][] | null;
  onBack: () => void;
}) {
  return (
    <View style={styles.hero}>
      {route ? (
        <View style={styles.heroRoute} pointerEvents="none">
          <RouteLine route={route} />
        </View>
      ) : null}
      <View style={styles.heroTop}>
        <BackButton tone="dark" onPress={onBack} />
        <Raised tone="darkGlass" style={styles.titleChip}>
          <AppText style={styles.titleText} numberOfLines={1}>
            {title}
          </AppText>
        </Raised>
      </View>
      <AppText style={styles.heroLabel}>그룹 평균</AppText>
      <View style={styles.heroLine}>
        <AppText style={styles.heroPace}>
          {averagePace === null ? '—' : formatPace(averagePace)}
        </AppText>
        <AppText style={styles.heroUnit}>/km</AppText>
      </View>
      <AppText style={styles.headline} accessibilityRole="header">
        {headline}
      </AppText>
    </View>
  );
}

// 6.7 하단 버튼: navy glass pills, both alike (--cta-navy-bg as a plain fill).
function NavyButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navyButton,
        pressed && styles.navyButtonPressed,
      ]}
    >
      <AppText style={styles.navyText}>{title}</AppText>
    </Pressable>
  );
}

// 6.7 그룹런 결과: who finished the goal fixed at the start, without ranks. runway-group-handoff: the course
// background (dark at the top into light), no cards.
export function GroupRunResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunResult'>>();
  const { groupRuns } = useRepositories();
  const { run } = useRunSession();
  const groupRunId =
    route.params?.groupRunId ?? run?.config.groupRunId ?? 'gr-today';
  const [result, setResult] = useState<GroupRunResult | null>(null);
  const [failed, setFailed] = useState(false);
  // 서버 결과는 G14를 바로 조회한다. 목업 결과만 기존 로컬 기록 저장을 기다린다.
  const saved =
    /^\d+$/.test(groupRunId) ||
    !run ||
    run.saveState === 'saved' ||
    run.saveState === 'failed';

  const load = useCallback(() => {
    setFailed(false);
    groupRuns.getResult(groupRunId).then(setResult, () => setFailed(true));
  }, [groupRunId, groupRuns]);
  useEffect(() => {
    if (saved) {
      load();
    }
  }, [load, saved]);

  const done = useCallback(
    () => navigateTo(navigation, 'MyCrews'),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        done();
        return true;
      });
      return () => back.remove();
    }, [done]),
  );

  if (!result) {
    return (
      <ThemeProvider tone="dark">
        <View style={[styles.root, styles.ground]}>
          <GroupBackground id="groupRunResultLoading" kind="course" />
          <SafeAreaView style={styles.root}>
            {failed ? (
              <EmptyState
                icon="alert"
                title="결과를 불러오지 못했어요"
                actionLabel="다시 시도"
                onAction={load}
              />
            ) : (
              <ActivityIndicator style={styles.loading} />
            )}
          </SafeAreaView>
        </View>
      </ThemeProvider>
    );
  }

  const rows = [...result.participants].sort(
    (a, b) =>
      stateOrder[a.state] - stateOrder[b.state] ||
      Number(b.goalAchieved) - Number(a.goalAchieved) ||
      (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity),
  );
  const finished = rows.filter(row => row.goalAchieved).length;
  const mine = rows.find(row => row.isMe);

  return (
    <View style={[styles.root, styles.ground]}>
      <StatusBar barStyle="light-content" />
      <GroupBackground id="groupRunResultBackground" kind="course" />
      <SafeAreaView edges={['top']} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Hero
            title={result.title}
            headline={
              result.analysisStatus === 'PROCESSING' ||
              result.hasUnconfirmedStarts
                ? `현재 ${finished}명 완주 확인 · 나머지 기록 확인 중`
                : `${rows.length}명 중 ${finished}명 완주했어요`
            }
            averagePace={result.averagePaceSecPerKm}
            route={run?.config.plan?.route ?? null}
            onBack={done}
          />
          {result.analysisStatus === 'PROCESSING' ? (
            <AppText accessibilityLiveRegion="polite">
              기록을 분석하고 있어요. 잠시 후 다시 조회해 주세요.
            </AppText>
          ) : null}
          {result.analysisStatus === 'FAILED' ? (
            <AppText>일부 기록 분석에 실패했어요.</AppText>
          ) : null}
          {result.hasUnconfirmedStarts ? (
            <AppText>실제 시작이 확인되지 않은 참가자가 있어요.</AppText>
          ) : null}
          <NavyButton title="결과 새로고침" onPress={load} />
          <View style={styles.stats}>
            <Stat
              label="함께 달린 거리"
              value={
                result.distanceM === null ? '—' : formatKm(result.distanceM, 1)
              }
              unit="km"
            />
            <Stat
              label="최대 간격"
              value={result.maxGapM === null ? '—' : String(result.maxGapM)}
              unit="m"
            />
          </View>
          {/* 6.7-FinishStatus: on the light middle of the background, so the text is navy. */}
          <View style={styles.finish}>
            <View style={styles.rowBetween}>
              <SectionLabel tone="light">완주 현황</SectionLabel>
              {mine ? (
                <AppText style={styles.mine}>
                  {`내 기록 ${
                    mine.durationSec === null
                      ? '미확인'
                      : formatDuration(mine.durationSec)
                  }`}
                </AppText>
              ) : null}
            </View>
            {rows.map(row => (
              <View key={row.userId} style={styles.row}>
                <View style={[styles.flex, styles.nameLine]}>
                  <AppText
                    style={[
                      styles.name,
                      row.state === 'RUNNING' && styles.running,
                    ]}
                  >
                    {row.nickname}
                  </AppText>
                  {row.isMe ? (
                    <Raised tone="navy" style={styles.meBadge}>
                      <AppText style={styles.meText}>나</AppText>
                    </Raised>
                  ) : null}
                </View>
                {row.state === 'RUNNING' ? (
                  <AppText style={styles.running}>달리는 중</AppText>
                ) : row.state === 'NOT_STARTED' ||
                  row.state === 'UNCONFIRMED' ? (
                  <AppText>
                    {row.state === 'UNCONFIRMED' ? '시작 미확인' : '미시작'}
                  </AppText>
                ) : row.goalAchieved === false || row.state === 'STOPPED' ? (
                  // A run that stopped short of the goal is the navy pill (6.7-FinishStatus).
                  <Raised tone="navy" style={styles.stopped}>
                    <AppText style={styles.stoppedText}>
                      {row.distanceM === null
                        ? '중단 · 거리 미확인'
                        : `${formatKm(row.distanceM, 1)}km에서 중단`}
                    </AppText>
                  </Raised>
                ) : (
                  <View style={styles.nameLine}>
                    <AppText style={styles.time}>
                      {row.durationSec === null
                        ? '기록 미확인'
                        : formatDuration(row.durationSec)}
                    </AppText>
                    {row.goalAchieved === true ? (
                      <Icon name="check" color={groupLook.onLight} size={14} />
                    ) : null}
                  </View>
                )}
              </View>
            ))}
          </View>
          <AppText style={styles.note}>
            이번 내 기록은 내 기록 › 그룹런 탭에 남아요
          </AppText>
        </ScrollView>
      </SafeAreaView>
      {/* 6.7-BottomActions: two navy glass pills on the light foot. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <NavyButton
          title="내 그룹런 기록 공유"
          onPress={() => navigateTo(navigation, 'PostWrite')}
        />
        <NavyButton title="완료" onPress={done} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  ground: { backgroundColor: groupLook.navy },
  loading: { marginTop: spacing.xxxl },
  content: {
    paddingHorizontal: 15,
    paddingTop: 15,
    gap: 24,
    paddingBottom: 150,
  },
  // 6.7-ResultHero: 360 × 290.
  hero: { minHeight: 290 },
  // The loop sits faint on the right of the big number.
  heroRoute: {
    position: 'absolute',
    top: 56,
    bottom: 60,
    left: 150,
    right: 0,
    opacity: 0.25,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  titleChip: {
    maxWidth: '64%',
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
  },
  titleText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: '#F9F9F9',
  },
  heroLabel: {
    marginTop: 42,
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: 'rgba(249,249,249,0.6)',
  },
  heroLine: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  // Big numbers stay Barlow Regular.
  heroPace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 96,
    lineHeight: 100,
    letterSpacing: -3,
    color: '#F9F9F9',
  },
  heroUnit: {
    marginBottom: 14,
    fontFamily: fontFamily.numberMedium,
    fontSize: 17,
    color: 'rgba(249,249,249,0.6)',
  },
  headline: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: '#F9F9F9',
  },
  stats: { flexDirection: 'row', gap: 16 },
  stat: { flex: 1, gap: 4 },
  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: '#F9F9F9',
  },
  statUnit: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 13,
    color: 'rgba(249,249,249,0.6)',
  },
  statLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(249,249,249,0.6)',
  },
  finish: { gap: 8 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mine: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub2,
  },
  row: { flexDirection: 'row', alignItems: 'center', height: 44 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  running: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupLook.onLightSub2,
  },
  meBadge: {
    height: 18,
    paddingHorizontal: 7,
    borderRadius: 9,
    justifyContent: 'center',
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: groupLook.onDark,
  },
  stopped: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
  },
  stoppedText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: '#F9F9F9',
  },
  time: {
    fontFamily: fontFamily.numberBold,
    fontSize: 15,
    letterSpacing: 0.2,
    color: groupLook.onLight,
  },
  note: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#182E3D',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  navyButton: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    backgroundColor: groupLook.ctaNavy,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow:
      'inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -2px 6px rgba(255,255,255,0.06), 0 10px 26px rgba(2,5,14,0.28)',
  },
  // Pressed, it turns solid navy and sinks a little (6.7 .lg-btn:active).
  navyButtonPressed: {
    backgroundColor: groupLook.navy,
    transform: [{ scale: 0.98 }],
  },
  navyText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: '#F9F9F9',
  },
});
