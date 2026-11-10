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
import {
  AppText,
  EmptyState,
  Icon,
  type IconName,
  PressableScale,
} from '../../components';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { RouteLine } from '../course/RouteLine';
import { useRunSession } from '../run/RunSession';
import { crewCard, groupTone, NightBackground, NumText, Raised } from './look';
import { MissingTarget } from './MissingTarget';
import { BottomFade } from './parts';
import { BackButton } from '../../components/BackButton';

const stateOrder = {
  FINISHED: 0,
  RUNNING: 1,
  STOPPED: 2,
  UNCONFIRMED: 3,
  NOT_STARTED: 4,
};

// A figure with its label over it and its unit after it, on the result card (6.7-StatTiles), arranged as in
// 담당자 시안 (S15P31E105-594 담당자 시안).
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
      <AppText style={styles.statLabel}>{label}</AppText>
      <View style={styles.statLine}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? <AppText style={styles.statUnit}>{unit}</AppText> : null}
      </View>
    </View>
  );
}

// 조회·분석 상태 (S15P31E105-594 담당자 시안): a line of the result's state on a small faint white card with an icon
// before it.
function StateNote({
  icon,
  text,
  live = false,
}: {
  icon: IconName;
  text: string;
  live?: boolean;
}) {
  return (
    <Raised tone="night" style={styles.stateNote}>
      <Icon name={icon} color={groupTone.sub} size={20} />
      <AppText
        style={[styles.stateText, styles.flex]}
        accessibilityLiveRegion={live ? 'polite' : undefined}
      >
        {text}
      </AppText>
    </Raised>
  );
}

// 6.7 하단 버튼 on the navy page (S15P31E105-594 담당자 결정: 큰 버튼은 흰 바탕에 남색 글씨): the main one white
// with navy text, quiet a faint white secondary with white text (공유, an outline in the 시안).
function FooterPill({
  title,
  quiet = false,
  onPress,
}: {
  title: string;
  quiet?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        quiet && styles.pillQuiet,
        pressed && styles.pillPressed,
      ]}
    >
      <AppText style={[styles.pillText, quiet && styles.pillTextQuiet]}>
        {title}
      </AppText>
    </PressableScale>
  );
}

// 6.7 그룹런 결과: who finished the goal fixed at the start, without ranks. Laid out as in 담당자 시안
// (S15P31E105-594 담당자 시안) on the navy page in the home's tone (담당자 결정: 진한 네이비): the title chip between
// back and 결과 새로고침, the group's average with the result line and the figures on one faint white card, 완주 현황
// as its own list card, then 내 기록 on a card of its own; mint only on the counts, 나 and the checks.
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
      <ThemeProvider tone="dark">
        <View style={styles.root}>
          <NightBackground />
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
  const routeLine = run?.config.plan?.route ?? null;
  const averagePace = result.averagePaceSecPerKm;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <NightBackground />
      <SafeAreaView edges={['top']} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* The run's title chip centred between 뒤로 and 결과 새로고침, which moved up from the card as in the 시안. */}
          <View style={styles.header}>
            <BackButton tone="dark" onPress={done} />
            <View style={styles.titleSlot}>
              <View style={styles.titleChip}>
                <AppText style={styles.titleText} numberOfLines={1}>
                  {result.title}
                </AppText>
              </View>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="결과 새로고침"
              onPress={load}
              hitSlop={6}
              style={[crewCard.round, styles.refresh]}
            >
              <Icon name="refresh" color={groupTone.text} size={18} />
            </PressableScale>
          </View>
          {/* 6.7-ResultHero: the group's average pace big in the middle, the result line under it, then a line and
              the figures side by side. The course loop stays faint behind it. */}
          <Raised tone="night" style={styles.card}>
            {routeLine ? (
              <View style={styles.heroRoute} pointerEvents="none">
                <RouteLine route={routeLine} color={groupTone.accent} />
              </View>
            ) : null}
            <AppText style={styles.heroLabel}>그룹 평균</AppText>
            <View style={styles.heroLine}>
              <AppText style={styles.heroPace}>
                {averagePace === null ? '—' : formatPace(averagePace)}
              </AppText>
              <AppText style={styles.heroUnit}>/km</AppText>
            </View>
            <View accessibilityRole="header">
              <NumText
                text={
                  result.analysisStatus === 'PROCESSING' ||
                  result.hasUnconfirmedStarts
                    ? `현재 ${finished}명 완주 확인 · 나머지 기록 확인 중`
                    : `${rows.length}명 중 ${finished}명 완주했어요`
                }
                style={styles.headline}
                numberStyle={styles.headlineNumber}
              />
            </View>
            <View style={styles.cardRule} />
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
              <View style={styles.statRule} />
              <Stat
                label="최대 간격"
                value={result.maxGapM === null ? '—' : String(result.maxGapM)}
                unit="m"
              />
            </View>
          </Raised>
          {result.analysisStatus === 'PROCESSING' ? (
            <StateNote
              icon="activity"
              text="기록을 분석하고 있어요. 잠시 후 다시 조회해 주세요."
              live
            />
          ) : null}
          {result.analysisStatus === 'FAILED' ? (
            <StateNote icon="alert" text="일부 기록 분석에 실패했어요." />
          ) : null}
          {result.hasUnconfirmedStarts ? (
            <StateNote
              icon="alert"
              text="실제 시작이 확인되지 않은 참가자가 있어요."
            />
          ) : null}
          {/* 6.7-FinishStatus: the label over its own list card, one row a runner with a line between rows. */}
          <AppText style={styles.section} accessibilityRole="header">
            완주 현황
          </AppText>
          <Raised tone="night" style={styles.list}>
            {rows.map((row, index) => (
              <View
                key={row.userId}
                style={[styles.row, index > 0 && styles.rowLine]}
              >
                <View style={styles.avatar}>
                  <Icon name="person" color={groupTone.text} size={14} />
                </View>
                <View style={[styles.flex, styles.nameLine]}>
                  <AppText
                    style={[
                      styles.name,
                      row.state === 'RUNNING' && styles.running,
                    ]}
                    numberOfLines={1}
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
                  <AppText style={styles.running}>
                    {row.state === 'UNCONFIRMED' ? '시작 미확인' : '미시작'}
                  </AppText>
                ) : row.state === 'STOPPED' ? (
                  // Only an interrupted session is "중단". Missing the goal after finishing
                  // still leaves a normal finish record (S15P31E105-637).
                  <View style={styles.stopped}>
                    <NumText
                      text={
                        row.distanceM === null
                          ? '중단 · 거리 미확인'
                          : `${formatKm(row.distanceM, 1)}km에서 중단`
                      }
                      style={styles.stoppedText}
                    />
                  </View>
                ) : (
                  <View style={styles.nameLine}>
                    <NumText
                      text={
                        row.durationSec === null
                          ? '기록 미확인'
                          : formatDuration(row.durationSec)
                      }
                      style={styles.time}
                    />
                    {row.goalAchieved === true ? (
                      <View style={styles.done}>
                        <Icon
                          name="check"
                          color={groupTone.onAccent}
                          size={12}
                        />
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            ))}
          </Raised>
          {/* 내 기록 on a card of its own under the list, as in the 시안; the same value as before. */}
          {mine ? (
            <Raised tone="night" style={styles.mineCard}>
              <AppText style={styles.mine}>내 기록</AppText>
              <NumText
                text={
                  mine.durationSec === null
                    ? '미확인'
                    : formatDuration(mine.durationSec)
                }
                style={styles.mineValue}
              />
            </Raised>
          ) : null}
          <AppText style={styles.note}>
            이번 내 기록은 내 기록 › 그룹런 탭에 남아요
          </AppText>
        </ScrollView>
      </SafeAreaView>
      {/* 6.7-BottomActions: a quiet 공유 and the white 완료 over the page's foot; 공유 takes more of the row, as in
          the 시안. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade />
        <View style={styles.shareSlot}>
          <FooterPill
            quiet
            title="내 그룹런 기록 공유"
            // 내 그룹런 기록을 지정해 연다(S15P31E105-420). 기록이 없으면(미시작·목업) 기존처럼 최근 기록으로 연다.
            onPress={() =>
              result?.mySessionId
                ? navigation.navigate('PostWrite', {
                    recordId: result.mySessionId,
                  })
                : navigateTo(navigation, 'PostWrite')
            }
          />
        </View>
        <View style={styles.flex}>
          <FooterPill title="완료" onPress={done} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  content: {
    flexGrow: 1,
    paddingHorizontal: 15,
    paddingTop: 6,
    gap: 16,
    paddingBottom: 120,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleSlot: { flex: 1, alignItems: 'center' },
  titleChip: {
    maxWidth: '100%',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: groupTone.quiet,
  },
  titleText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.text,
  },
  // As wide as 뒤로, so the title stays centred.
  refresh: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: groupTone.quiet,
  },
  card: { paddingHorizontal: 18, paddingVertical: 20, borderRadius: 20 },
  // The loop sits light on the right of the big number, in the mint accent.
  heroRoute: {
    position: 'absolute',
    top: 16,
    bottom: 110,
    left: '55%',
    right: 12,
    opacity: 0.3,
  },
  heroLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  heroLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  // Group screen numbers in Rajdhani (S15P31E105-594 담당자 결정).
  heroPace: {
    fontFamily: fontFamily.rajdhaniBold,
    fontSize: 84,
    lineHeight: 92,
    color: groupTone.text,
  },
  heroUnit: {
    marginBottom: 14,
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 20,
    color: groupTone.sub,
  },
  headline: {
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: groupTone.text,
  },
  // The counts of the result line in mint, as in the 시안; mint text reads on the navy card.
  headlineNumber: { color: groupTone.accent },
  section: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupTone.text,
  },
  cardRule: {
    height: 1,
    marginVertical: 16,
    backgroundColor: groupTone.line,
  },
  stats: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  statRule: { width: 1, backgroundColor: groupTone.line },
  stat: { flex: 1, gap: 4 },
  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: {
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 34,
    lineHeight: 40,
    color: groupTone.text,
  },
  statUnit: {
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 16,
    color: groupTone.sub,
  },
  statLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  stateNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  stateText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: groupTone.text,
  },
  list: { paddingHorizontal: 16, borderRadius: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 54 },
  rowLine: { borderTopWidth: 1, borderTopColor: groupTone.line },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.inner,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupTone.text,
  },
  running: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  // 나 as the 시안's mint badge, navy on mint.
  meBadge: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: groupTone.accent,
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 15,
    color: groupTone.onAccent,
  },
  // A finish as the 시안's mint round check, the check navy on it.
  done: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.accent,
  },
  stopped: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: groupTone.quiet,
  },
  stoppedText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: groupTone.text,
  },
  time: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: groupTone.text,
  },
  mineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 20,
  },
  mine: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.sub,
  },
  mineValue: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    color: groupTone.text,
  },
  note: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
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
  // 공유 has the longer label, so it takes more of the row (as in the 시안).
  shareSlot: { flex: 1.5 },
  pill: {
    height: 54,
    borderRadius: 27,
    backgroundColor: groupTone.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillQuiet: { backgroundColor: groupTone.quiet },
  // Pressed, it dims a little.
  pillPressed: { opacity: 0.85 },
  pillText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: groupTone.onButton,
  },
  pillTextQuiet: { color: groupTone.text },
});
