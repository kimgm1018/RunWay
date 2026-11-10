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
  Logo,
} from '../../components';
import { BackButton } from '../../components/BackButton';
import { GlassIconButton } from '../../components/GlassIconButton';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import {
  MixedFigure,
  ResultButton,
  resultLook,
  ResultWatermark,
  RouteArea,
  SideFigure,
  StatBlock,
} from '../run/resultLook';
import { useRunSession } from '../run/RunSession';
import { FinishStandings } from './FinishStandings';
import { MissingTarget } from './MissingTarget';

const stateOrder = {
  FINISHED: 0,
  RUNNING: 1,
  STOPPED: 2,
  UNCONFIRMED: 3,
  NOT_STARTED: 4,
};

// 조회·분석 상태: a line of the result's state in a thin outlined box with an icon before it.
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
    <View style={styles.stateNote}>
      <Icon name={icon} color={resultLook.sub} size={18} />
      <AppText
        style={[styles.stateText, styles.flex]}
        accessibilityLiveRegion={live ? 'polite' : undefined}
      >
        {text}
      </AppText>
    </View>
  );
}

// 6.7 그룹런 결과: who finished the goal fixed at the start, without ranks. In the tone of 4.5 시안 G3
// (S15P31E105-661 담당자 결정: 그룹런 결과도 같은 톤): the navy page, the RunWay mark with the handwritten #그룹런 and
// the run's title, the group's figures in the G3 blocks, the course with a square every kilometre, 완주 현황 as ruled
// rows, and square 공유 · 완료 at the foot.
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
  const [height, setHeight] = useState(0);
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
          {/* Light status bar text on the navy page while the result loads, as on the result itself. */}
          <StatusBar barStyle="light-content" />
          <SafeAreaView style={styles.flex}>
            {failed ? (
              <EmptyState
                icon="alert"
                title="결과를 불러오지 못했어요"
                actionLabel="다시 시도"
                onAction={load}
              />
            ) : (
              <ActivityIndicator
                style={styles.loading}
                color={resultLook.mint}
              />
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
    <View
      style={styles.root}
      onLayout={event => setHeight(event.nativeEvent.layout.height)}
    >
      <StatusBar barStyle="light-content" />
      {height > 0 ? (
        <ResultWatermark height={height} year={new Date().getFullYear()} />
      ) : null}
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <BackButton tone="dark" onPress={done} />
            {/* The same round glass button as 뒤로, so the two corners match. */}
            <GlassIconButton
              icon="refresh"
              accessibilityLabel="결과 새로고침"
              onPress={load}
              tone="dark"
            />
          </View>
          {/* The RunWay mark, the handwritten #그룹런 and the run's title, as the head of 시안 G3. */}
          <View style={styles.head}>
            <ThemeProvider tone="dark">
              <Logo width={150} />
            </ThemeProvider>
            <AppText style={styles.tag}>#그룹런</AppText>
            <AppText style={styles.title} numberOfLines={1}>
              {result.title}
            </AppText>
          </View>
          <View style={styles.blocks}>
            <StatBlock
              caps="GROUP"
              value={averagePace === null ? '– –' : formatPace(averagePace)}
              valueLabel="그룹 평균 페이스"
              script="그룹 평균"
            >
              <SideFigure
                label="함께 달린 거리"
                value={
                  result.distanceM === null
                    ? '– –'
                    : formatKm(result.distanceM, 1)
                }
                unit="KM"
              />
            </StatBlock>
            <StatBlock
              caps="FINISHED"
              value={`${finished}/${rows.length}`}
              script="완주"
            >
              <View style={styles.sidePair}>
                <SideFigure
                  label="최대 간격"
                  value={
                    result.maxGapM === null ? '– –' : String(result.maxGapM)
                  }
                  unit="M"
                />
                {mine ? (
                  <SideFigure
                    label="내 기록"
                    value={
                      mine.durationSec === null
                        ? '미확인'
                        : formatDuration(mine.durationSec)
                    }
                  />
                ) : null}
              </View>
            </StatBlock>
          </View>
          <View accessibilityRole="header">
            <MixedFigure
              style={styles.headline}
              numberStyle={styles.headlineNumber}
              text={
                result.analysisStatus === 'PROCESSING' ||
                result.hasUnconfirmedStarts
                  ? `현재 ${finished}명 완주 확인 · 나머지 기록 확인 중`
                  : `${rows.length}명 중 ${finished}명 완주했어요`
              }
            />
          </View>
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
          {routeLine ? (
            <RouteArea route={routeLine} style={styles.route} />
          ) : null}
          {/* 완주 현황 as a race standings board (담당자 레퍼런스). */}
          <FinishStandings rows={rows} />
          <AppText style={styles.note}>
            이번 내 기록은 내 기록 › 그룹런 탭에 남아요
          </AppText>
        </ScrollView>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.buttons}>
        <ResultButton
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
        <ResultButton primary title="완료" onPress={done} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: resultLook.page },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 20,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  head: { alignItems: 'center' },
  tag: {
    marginTop: 4,
    fontFamily: fontFamily.resultScript,
    fontSize: 66,
    lineHeight: 72,
    color: resultLook.mint,
    transform: [{ rotate: '-4deg' }],
  },
  title: {
    marginTop: 2,
    maxWidth: '100%',
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: resultLook.sub,
  },
  blocks: {
    alignSelf: 'center',
    width: 300,
    maxWidth: '100%',
    marginTop: 8,
    gap: 22,
  },
  sidePair: { gap: 14 },
  headline: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 24,
  },
  headlineNumber: { fontSize: 18, color: resultLook.mint },
  stateNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: resultLook.line,
  },
  stateText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: resultLook.text,
  },
  route: { alignSelf: 'center', width: 254, maxWidth: '100%', height: 170 },
  note: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: resultLook.sub,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
});
