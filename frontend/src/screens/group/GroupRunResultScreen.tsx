import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import { AppText, EmptyState, Icon, PressableScale } from '../../components';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { MissingTarget } from './MissingTarget';
import { fontFamily, palette, spacing, ThemeProvider } from '../../theme';
import { RouteLine } from '../course/RouteLine';
import { useRunSession } from '../run/RunSession';
import {
  crewCard,
  groupLook,
  MistBackground,
  Raised,
  SectionLabel,
} from './look';
import { BottomFade } from './parts';
import { BackButton } from '../../components/BackButton';

const stateOrder = {
  FINISHED: 0,
  RUNNING: 1,
  STOPPED: 2,
  UNCONFIRMED: 3,
  NOT_STARTED: 4,
};

// A figure with its unit and label under it, on the result card (6.7-StatTiles).
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
          <RouteLine route={route} color={palette.mintDeep} />
        </View>
      ) : null}
      <View style={styles.heroTop}>
        <BackButton onPress={onBack} />
        <View style={styles.titleChip}>
          <AppText style={styles.titleText} numberOfLines={1}>
            {title}
          </AppText>
        </View>
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

// 6.7 하단 버튼: flat navy pills, both alike, like the other group screens' buttons (S15P31E105-563).
function NavyButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navyButton,
        pressed && styles.navyButtonPressed,
      ]}
    >
      <AppText style={styles.navyText}>{title}</AppText>
    </PressableScale>
  );
}

// 6.7 그룹런 결과: who finished the goal fixed at the start, without ranks. On the mist like 6.0 (담당자 요청,
// S15P31E105-563): the result in navy at the top, then the figures and who finished on one soft white card.
export function GroupRunResultScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunResult'>>();
  const { run } = useRunSession();
  const groupRunId = route.params?.groupRunId ?? run?.config.groupRunId;
  // A record opens its own group run (H01 group.groupRunId); no mock result stands in (S15P31E105-635).
  if (!groupRunId) {
    return <MissingTarget title="그룹런 결과를 찾을 수 없어요" />;
  }
  return <GroupRunResultContent groupRunId={groupRunId} />;
}

function GroupRunResultContent({ groupRunId }: { groupRunId: string }) {
  const navigation = useNavigation();
  const { groupRuns } = useRepositories();
  const { run } = useRunSession();
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
      <ThemeProvider tone="light">
        <View style={styles.root}>
          <MistBackground />
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
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <MistBackground />
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
          {/* The figures and 완주 현황 on one soft white card panel. */}
          <Raised tone="card" style={styles.panel}>
            <View style={styles.stats}>
              <Stat
                label="함께 달린 거리"
                value={
                  result.distanceM === null
                    ? '—'
                    : formatKm(result.distanceM, 1)
                }
                unit="km"
              />
              <Stat
                label="최대 간격"
                value={result.maxGapM === null ? '—' : String(result.maxGapM)}
                unit="m"
              />
              {/* 결과 새로고침 as a small round button at the card's top right (담당자 요청). */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="결과 새로고침"
                onPress={load}
                hitSlop={6}
                style={crewCard.round}
              >
                <Icon name="refresh" color={groupLook.onDark} size={16} />
              </PressableScale>
            </View>
            {/* 6.7-FinishStatus. */}
            <View style={styles.finish}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist" large>
                  완주 현황
                </SectionLabel>
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
                      <View style={styles.meBadge}>
                        <AppText style={styles.meText}>나</AppText>
                      </View>
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
                    // A run that stopped short of the goal is the flat navy pill (6.7-FinishStatus).
                    <View style={styles.stopped}>
                      <AppText style={styles.stoppedText}>
                        {row.distanceM === null
                          ? '중단 · 거리 미확인'
                          : `${formatKm(row.distanceM, 1)}km에서 중단`}
                      </AppText>
                    </View>
                  ) : (
                    <View style={styles.nameLine}>
                      <AppText style={styles.time}>
                        {row.durationSec === null
                          ? '기록 미확인'
                          : formatDuration(row.durationSec)}
                      </AppText>
                      {row.goalAchieved === true ? (
                        <Icon
                          name="check"
                          color={groupLook.onLight}
                          size={14}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
              ))}
            </View>
          </Raised>
          <AppText style={styles.note}>
            이번 내 기록은 내 기록 › 그룹런 탭에 남아요
          </AppText>
        </ScrollView>
      </SafeAreaView>
      {/* 6.7-BottomActions: two flat navy pills over the mist's foot. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade mist />
        <NavyButton
          title="내 그룹런 기록 공유"
          // 내 그룹런 기록을 지정해 연다(S15P31E105-420). 기록이 없으면(미시작·목업) 기존처럼 최근 기록으로 연다.
          onPress={() =>
            result?.mySessionId
              ? navigation.navigate('PostWrite', { recordId: result.mySessionId })
              : navigateTo(navigation, 'PostWrite')
          }
        />
        <NavyButton title="완료" onPress={done} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  // The card grows down to the buttons however few runners there are. 6.7's text is a step or two over the
  // handoff's (담당자 요청, S15P31E105-563).
  content: {
    flexGrow: 1,
    paddingHorizontal: 15,
    paddingTop: 15,
    gap: 24,
    paddingBottom: 176,
  },
  // 6.7-ResultHero: 360 × 290.
  hero: { minHeight: 290 },
  // The loop sits light on the right of the big number, in the mint accent.
  heroRoute: {
    position: 'absolute',
    top: 56,
    bottom: 60,
    left: 150,
    right: 0,
    opacity: 0.55,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  titleChip: {
    maxWidth: '64%',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: groupLook.navy,
  },
  titleText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onDark,
  },
  heroLabel: {
    marginTop: 42,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLightSub,
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
    color: groupLook.onLight,
  },
  heroUnit: {
    marginBottom: 14,
    fontFamily: fontFamily.numberMedium,
    fontSize: 17,
    color: groupLook.onLightSub,
  },
  headline: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: groupLook.onLight,
  },
  // The soft white card (Raised card, as 6.0's crews) holding the figures and 완주 현황.
  panel: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderRadius: 20,
    gap: 24,
  },
  stats: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  stat: { flex: 1, gap: 4 },
  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: groupLook.onLight,
  },
  statUnit: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 15,
    color: groupLook.onLightSub,
  },
  statLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub,
  },
  finish: { gap: 8 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mine: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub2,
  },
  row: { flexDirection: 'row', alignItems: 'center', height: 54 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupLook.onLight,
  },
  running: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLightSub2,
  },
  meBadge: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: groupLook.navy,
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 15,
    color: groupLook.onDark,
  },
  stopped: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: groupLook.navy,
  },
  stoppedText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: '#F9F9F9',
  },
  time: {
    fontFamily: fontFamily.numberBold,
    fontSize: 17,
    letterSpacing: 0.2,
    color: groupLook.onLight,
  },
  note: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
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
    paddingTop: spacing.md,
    paddingBottom: 12,
  },
  // Flat navy with a short drop, like GroupCta navy (S15P31E105-563).
  navyButton: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    backgroundColor: groupLook.navy,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(2,5,14,0.16)',
  },
  // Pressed, it dims a little.
  navyButtonPressed: {
    opacity: 0.85,
  },
  navyText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: '#F9F9F9',
  },
});
