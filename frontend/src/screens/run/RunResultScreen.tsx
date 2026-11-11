import React, { useCallback, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, Logo, Pop, useCountUp } from '../../components';
import { useRepositories } from '../../data';
import { errorCode } from '../../data/errors';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { comparisonResult, useFinalComparison } from './recordComparison';
import {
  MixedFigure,
  ResultButton,
  resultLook,
  resultType,
  ResultWatermark,
  RouteArea,
  SideFigure,
  StatBlock,
} from './resultLook';
import { useRunControlState, useRunSession } from './RunSession';

// A course counts as 완주 once almost all of it is run; GPS rarely lands on the exact finish.
const finishShare = 0.98;

// When the run began, in KST like the rest of the app: #오후러닝 and 2026.11.10 (시안).
function runDay(startedAt: string) {
  const shifted = new Date(new Date(startedAt).getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    tag: shifted.getUTCHours() < 12 ? '#오전러닝' : '#오후러닝',
    date: `${shifted.getUTCFullYear()}.${pad(shifted.getUTCMonth() + 1)}.${pad(
      shifted.getUTCDate(),
    )}`,
    year: shifted.getUTCFullYear(),
  };
}

// 1분 · 30초 · 1분 20초: a gap in time as words.
function timeWords(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (minutes === 0) {
    return `${rest}초`;
  }
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

// 4.5 러닝 결과 (코스) and 4.5F 자유 러닝 결과 as 시안 G3 · 경로 톤온톤 민트 (S15P31E105-661): the RunWay mark, the
// handwritten #오후러닝 and the day, three blocks (페이스 · 시간 · 목표) with the other figures beside them, the route
// with a square every kilometre, and 기록 공유 · 완료 at the foot.
export function RunResultScreen() {
  const navigation = useNavigation();
  const { run, retrySave } = useRunSession();
  const { courses } = useRepositories();
  const [courseSave, setCourseSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [courseSaveError, setCourseSaveError] = useState('');
  const control = useRunControlState();
  const finalComparison = useFinalComparison(
    control?.sessionId ?? null,
    control?.comparison ?? null,
  );
  const [height, setHeight] = useState(0);
  const plan = run?.config.plan ?? null;

  // A finished run has nothing to go back to; back means 완료.
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        navigateTo(navigation, 'Home');
        return true;
      });
      return () => back.remove();
    }, [navigation]),
  );

  // Hooks come before the early return below; the count is used only for an achieved goal.
  const countedDistance = useCountUp(run?.summary?.distanceM ?? 0);

  const saveCourse = async () => {
    if (!run?.recordId || courseSave === 'saving' || courseSave === 'saved') return;
    setCourseSave('saving');
    try {
      await courses.saveFromRun(run.recordId);
      setCourseSave('saved');
      setCourseSaveError('');
    } catch (error) {
      setCourseSave('failed');
      const code = errorCode(error);
      setCourseSaveError(
        code === 'COURSE_GRADE_NOT_READY' || code === 'COURSE_GRADE_UNAVAILABLE'
          ? '경사 정보를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.'
          : code === 'VALIDATION_ERROR'
            ? '코스로 만들 GPS 경로가 부족해요.'
            : '코스를 저장하지 못했어요. 다시 시도해 주세요.',
      );
    }
  };

  if (!run?.summary) {
    return <View style={styles.root} />;
  }
  const { summary, config, trail, saveState, recordId, goalAchieved } = run;
  const finished = plan
    ? summary.distanceM >= plan.distanceM * finishShare
    : false;
  const shape = plan ? plan.route : trail;
  const day = runDay(run.startedAt);
  // 4.5 비교 결과: 서버가 계산한 같은 지점 도달 시간 차이(S15P31E105-422).
  const rivalResult = comparisonResult(finalComparison);
  // 목표 달성: prefer H02 goalAchieved after save; else the course finished within its planned time
  // (S15P31E105-638, 완료 하이라이트 S15P31E105-478).
  const localAchieved =
    plan !== null &&
    finished &&
    summary.durationSec <= plan.expectedDurationSec;
  const achieved = goalAchieved !== null ? goalAchieved : localAchieved;
  const showGoal =
    goalAchieved !== null ? plan !== null : plan !== null && finished;
  const goalPace = config.goalPaceSecPerKm;
  const pace = summary.averagePaceSecPerKm;

  // The third block: the course's planned time once it is decided, else the goal pace when there is one.
  let goalBlock: React.ReactNode = null;
  if (showGoal && plan) {
    const gap = summary.durationSec - plan.expectedDurationSec;
    goalBlock = (
      <Pop active={achieved}>
        <StatBlock
          caps="GOAL"
          value={formatDuration(plan.expectedDurationSec)}
          script="목표"
        >
          <View style={styles.side}>
            <AppText style={[resultType.label, !achieved && styles.danger]}>
              {achieved ? '목표 달성' : '목표 미달성'}
            </AppText>
            {/* The server may call it achieved on its own terms; a gain is shown only when there is one. */}
            {achieved && gap < 0 ? (
              <MixedFigure text={`${timeWords(gap)} 단축`} />
            ) : null}
            {!achieved && gap > 0 ? (
              <MixedFigure text={`${timeWords(gap)} 초과`} danger />
            ) : null}
          </View>
        </StatBlock>
      </Pop>
    );
  } else if (goalPace) {
    const gap = pace === null ? null : Math.round(pace - goalPace);
    goalBlock = (
      <StatBlock caps="GOAL" value={formatPace(goalPace)} script="목표">
        <View style={styles.side}>
          <AppText style={resultType.label}>목표 페이스</AppText>
          {gap === null ? null : gap === 0 ? (
            <MixedFigure text="목표와 같아요" />
          ) : (
            <MixedFigure
              text={`${timeWords(gap)} ${gap < 0 ? '빠름' : '느림'}`}
            />
          )}
        </View>
      </StatBlock>
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={event => setHeight(event.nativeEvent.layout.height)}
    >
      <StatusBar barStyle="light-content" />
      {height > 0 ? <ResultWatermark height={height} year={day.year} /> : null}
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* The RunWay logo in white, the handwritten time of day and the date (시안). */}
          <View style={styles.head} accessibilityRole="header">
            <ThemeProvider tone="dark">
              <Logo width={150} />
            </ThemeProvider>
            <AppText style={styles.tag}>{day.tag}</AppText>
            <AppText style={styles.date}>{day.date}</AppText>
          </View>
          <View style={styles.blocks}>
            <StatBlock
              caps="PACE"
              value={pace === null ? '– –' : formatPace(pace)}
              valueLabel="평균 페이스"
              script="평균 페이스"
            >
              <SideFigure
                label="거리"
                value={formatKm(achieved ? countedDistance : summary.distanceM)}
                unit="KM"
              />
            </StatBlock>
            <StatBlock
              caps="TIME"
              value={formatDuration(summary.durationSec)}
              script="시간"
            >
              <View style={styles.sidePair}>
                <SideFigure
                  label="평균 심박"
                  value={
                    summary.averageHeartRate === null
                      ? '– –'
                      : String(summary.averageHeartRate)
                  }
                  unit="BPM"
                />
                <SideFigure
                  label="평균 케이던스"
                  value={
                    summary.averageCadence === null
                      ? '– –'
                      : String(summary.averageCadence)
                  }
                  unit="SPM"
                />
              </View>
            </StatBlock>
            {goalBlock}
          </View>
          {rivalResult ? (
            <AppText style={styles.rival}>{rivalResult}</AppText>
          ) : null}
          {/* Only a failed or unconfirmed save is shown (README 알려진 문제); saving and saved stay quiet. With the
              server the run is already stored, so a record not read back yet is 확인 못 함, not 저장 못 함. */}
          {saveState === 'failed' || saveState === 'unconfirmed' ? (
            <View style={styles.saveRow}>
              <Icon name="alert" color={resultLook.danger} size={14} />
              <AppText style={styles.saveFailed}>
                {saveState === 'failed'
                  ? '기록을 저장하지 못했어요'
                  : '기록 저장을 확인하지 못했어요'}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  saveState === 'failed' ? '다시 저장' : '다시 확인'
                }
                onPress={retrySave}
                hitSlop={8}
              >
                <AppText style={styles.retry}>
                  {saveState === 'failed' ? '다시 저장' : '다시 확인'}
                </AppText>
              </Pressable>
            </View>
          ) : null}
          <RouteArea route={shape} style={styles.route} />
          {courseSave === 'saved' ? (
            <AppText style={styles.courseMessage}>내 코스에 저장했어요.</AppText>
          ) : courseSave === 'failed' ? (
            <AppText style={[styles.courseMessage, styles.danger]}>{courseSaveError}</AppText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.buttons}>
        {!plan ? (
          <View style={styles.buttonRow}>
            <ResultButton
              title={courseSave === 'saving' ? '코스 저장 중' : courseSave === 'saved' ? '코스 저장 완료' : '코스로 정하기'}
              disabled={saveState !== 'saved' || !recordId || courseSave === 'saving' || courseSave === 'saved'}
              onPress={() => { void saveCourse(); }}
            />
          </View>
        ) : null}
        <View style={styles.buttonRow}>
          <ResultButton
            title="기록 공유"
            disabled={saveState !== 'saved' || !recordId}
            // 7.3 shares this run's record, not just the newest one.
            onPress={() =>
              recordId
                ? navigation.navigate('PostWrite', { recordId })
                : undefined
            }
          />
          <ResultButton
            primary
            title="완료"
            onPress={() => navigateTo(navigation, 'Home')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const blockWidth = 300;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: resultLook.page },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingTop: 30,
    paddingBottom: 12,
    paddingHorizontal: 20,
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
  date: {
    marginTop: 2,
    fontFamily: fontFamily.resultBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 2,
    color: resultLook.sub,
  },
  blocks: {
    alignSelf: 'center',
    width: blockWidth,
    maxWidth: '100%',
    marginTop: 26,
    gap: 22,
  },
  sidePair: { gap: 14 },
  side: { gap: 2 },
  danger: { color: resultLook.danger },
  rival: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: resultLook.sub,
  },
  saveRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  saveFailed: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: resultLook.danger,
  },
  retry: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    color: resultLook.text,
    textDecorationLine: 'underline',
  },
  // The route takes what the screen leaves, between a small and the 시안's size.
  route: {
    alignSelf: 'center',
    width: 254,
    maxWidth: '100%',
    flex: 1,
    minHeight: 120,
    maxHeight: 220,
    marginTop: 18,
  },
  buttons: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  courseMessage: {
    textAlign: 'center',
    color: resultLook.text,
    fontFamily: fontFamily.medium,
    fontSize: 13,
  },
});
