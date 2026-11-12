import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { StackActions, useNavigation } from '@react-navigation/native';
import { AppText, BottomSheet } from '../../components';
import { useRepositories, useResource, type Repositories } from '../../data';
import type { RunRecordSummary } from '../../data/types';
import {
  formatDotDate,
  formatDuration,
  formatKm,
  formatPace,
  withoutDistance,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, ThemeProvider, useTheme } from '../../theme';
import { MapScreenFrame } from './MapScreenFrame';
import { RunMap } from '../../components/RunMap';
import { gpsLabels, RunStartBar } from './parts';
import type { RunConfig } from './RunSession';
import { RunGoalSheet } from './goal/RunGoalSheet';
import {
  goalConfig,
  goalFromSearch,
  goalLabel,
  type RunGoal,
} from './goal/runGoal';
import { BackButton } from '../../components/BackButton';
import { useCourseSearch } from '../course/CourseSearch';
import { courseGoalOf, useRunGoalDraft } from './goal/RunGoalDraft';

const loadPlan = (repositories: Repositories) =>
  repositories.courses.getTodayPlan();
// Looked up apart from the plan, so a slow or failed GPS fix never holds the course back.
const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

// 경쟁 모드 (S15P31E105-422): pick one of my earlier runs on this course, or none. The server checks the pick
// and compares the time to reach the same distance during the run; nothing shows when the course has no run yet.
function ComparisonPicker({
  courseId,
  night,
  value,
  onChange,
}: {
  courseId: string;
  night: boolean;
  value: string | null;
  onChange: (sessionId: string | null) => void;
}) {
  const { colors } = useTheme();
  const { records } = useRepositories();
  const [runs, setRuns] = useState<RunRecordSummary[]>([]);
  useEffect(() => {
    let alive = true;
    setRuns([]);
    onChange(null);
    records
      .getCourseRuns(courseId)
      .then(found => alive && setRuns(found.slice(0, 3)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, records, onChange]);
  if (runs.length === 0) {
    return null;
  }
  const chip = (
    key: string,
    label: string,
    a11y: string,
    selected: boolean,
    sessionId: string | null,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      onPress={() => onChange(sessionId)}
      hitSlop={4}
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? night
              ? colors.text
              : ink
            : night
            ? colors.surfaceMuted
            : 'rgba(2,5,14,0.06)',
        },
      ]}
    >
      <AppText
        style={[
          styles.chipText,
          {
            color: selected
              ? night
                ? colors.background
                : '#FFFFFF'
              : night
              ? colors.text
              : ink,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </Pressable>
  );
  return (
    <View style={styles.picker}>
      <AppText style={styles.kickerSheet}>이 코스의 내 기록과 비교</AppText>
      <View style={styles.chips}>
        {chip('none', '비교 안 함', '기록 비교 안 함', value === null, null)}
        {runs.map(run =>
          chip(
            run.id,
            `${formatDotDate(run.startedAt)} · ${formatDuration(
              run.durationSec,
            )}`,
            `${formatDotDate(run.startedAt)} ${formatDuration(
              run.durationSec,
            )} 기록과 비교`,
            value === run.id,
            run.id,
          ),
        )}
      </View>
    </View>
  );
}

// 2.0 코스 러닝: the chosen course, ready to start. Since S15P31E105-683 it is 2.0F's map with a course picked: 뒤로
// alone at the top, the course one mint line with me in a bubble, and the course chip beside the goal under
// 오늘의 전략 (or the course's figures).
export function CourseRunScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  // The run start map stays bright after sunset (S15P31E105-683), so its card keeps the day design too (담당자 요청).
  const night = false;
  const resource = useResource(useCallback(loadPlan, []));
  const placeResource = useResource(useCallback(loadPlace, []));
  const plan = resource.status === 'ready' ? resource.data : null;
  // Loaded, but no course was picked yet (or the app restarted since): 2.0 asks for one (S15P31E105-635).
  const noCourse = resource.status === 'ready' && !plan;
  const place =
    placeResource.status === 'ready' ? placeResource.data : undefined;
  const [comparisonSessionId, setComparison] = useState<string | null>(null);
  // 운동 목표 (S15P31E105-517): the course keeps its distance; 추천 전략 runs the plan's pace, or a time or a pace
  // of the user's own. The goal typed on 3.1 comes along with its course (S15P31E105-635); a plan without a pace
  // of its own starts without one.
  const { search } = useCourseSearch();
  const [picked, setGoal] = useState<RunGoal | null>(null);
  useEffect(() => setGoal(null), [search]);
  // The goal set on the map comes first (S15P31E105-683), then the one typed on 3.1, then the plan's.
  const draft = useRunGoalDraft();
  const goal: RunGoal = picked ??
    courseGoalOf(draft.goal) ??
    goalFromSearch(search) ?? {
      kind: plan && !plan.targetPaceSecPerKm ? 'NONE' : 'PLAN',
    };
  // A picked course that brings a goal of its own (3.1's 목표 or the plan's pace) while a different goal was set on the
  // map: the user chooses which to run with, once per course (S15P31E105-683, 담당자 요청). Until then the map's stays.
  const mapGoal = courseGoalOf(draft.goal);
  const suggested: RunGoal | null =
    goalFromSearch(search) ??
    (plan?.targetPaceSecPerKm ? { kind: 'PLAN' } : null);
  const askKey = plan
    ? `${plan.courseId}|${JSON.stringify(suggested)}|${JSON.stringify(mapGoal)}`
    : null;
  const asked = useRef<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!askKey || asked.current === askKey) {
      return;
    }
    asked.current = askKey;
    setAsking(
      !!mapGoal &&
        !!suggested &&
        JSON.stringify(mapGoal) !== JSON.stringify(suggested),
    );
    // mapGoal and suggested are in askKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);
  // A goal set here goes back to the map too, so dropping the course keeps it; 추천 전략 belongs to the course.
  const keep = (next: RunGoal) => {
    setGoal(next);
    if (next.kind !== 'PLAN') {
      draft.setGoal(next);
    }
  };
  const [choosing, setChoosing] = useState(false);
  const course = plan
    ? { distanceM: plan.distanceM, plannedPace: plan.targetPaceSecPerKm }
    : undefined;
  const courseConfig: RunConfig | null = plan
    ? {
        mode: 'COURSE',
        plan,
        ...goalConfig(goal, course),
        comparisonSessionId,
      }
    : null;
  const goalChip = {
    label: goalLabel(goal, plan?.targetPaceSecPerKm),
    onPress: () => setChoosing(true),
  };
  const picker = plan ? (
    <ComparisonPicker
      courseId={plan.courseId}
      night={night}
      value={comparisonSessionId}
      onChange={setComparison}
    />
  ) : null;

  // A name that already says its distance (5.0km 코스) is not followed by it again.
  const title = !plan
    ? ''
    : /\d\s*km/i.test(plan.name)
    ? plan.name
    : `${withoutDistance(plan.name)} · ${formatKm(plan.distanceM, 1)}km`;
  // The course chip (S15P31E105-683): the picked course on the right of the goal; a tap changes it on 3.1, its ✕
  // drops it and the same map goes back to a free run.
  const courseChip = plan
    ? {
        label: title,
        picked: true,
        onPress: () => navigateTo(navigation, 'TodayRun'),
        // Back to the map under it (or in its place), so the stack never holds two of the same map.
        onClear: () => navigation.dispatch(StackActions.popTo('FreeRun')),
      }
    : {
        label: '코스 설정',
        picked: false,
        onPress: () => navigateTo(navigation, 'TodayRun'),
      };
  // Only 뒤로 at the top, like 2.0F: the course is in its chip and where I am in the bubble on the map.
  const top = (
    <View style={styles.nightTop}>
      <BackButton onPress={navigation.goBack} />
    </View>
  );

  const bottom = noCourse ? (
    <>
      <View>
        <AppText style={styles.kickerSheet}>코스 러닝</AppText>
        <AppText style={styles.strategy} numberOfLines={1} adjustsFontSizeToFit>
          아직 고른 코스가 없어요
        </AppText>
        <AppText style={styles.goal}>
          코스를 추천받거나 저장한 코스에서 골라 주세요
        </AppText>
      </View>
      <RunStartBar night={night} config={null} course={courseChip} />
    </>
  ) : !plan ? (
    resource.status === 'error' ? (
      <AppText tone="danger">코스를 불러오지 못했어요</AppText>
    ) : (
      <ActivityIndicator />
    )
  ) : (
    <>
      {plan.strategy ? (
        <View>
          <AppText
            style={[
              styles.kickerSheet,
              night && { color: colors.textSecondary },
            ]}
          >
            오늘의 전략
          </AppText>
          <AppText
            style={[styles.strategy, night && { color: colors.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {plan.strategy}
          </AppText>
          <AppText
            style={[styles.goal, night && { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {plan.targetPaceSecPerKm
              ? `목표 ${formatPace(
                  plan.targetPaceSecPerKm,
                )} · 예상 ${formatDuration(plan.expectedDurationSec)}`
              : `예상 ${formatDuration(plan.expectedDurationSec)}`}
            {plan.caution ? (
              <AppText style={styles.caution}>{` · ${plan.caution}`}</AppText>
            ) : null}
          </AppText>
        </View>
      ) : (
        // A server course has no pace plan yet: only its own figures, no strategy (S15P31E105-635).
        <View>
          <AppText
            style={[
              styles.kickerSheet,
              night && { color: colors.textSecondary },
            ]}
          >
            코스 정보
          </AppText>
          <AppText
            style={[styles.strategy, night && { color: colors.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {`${formatKm(plan.distanceM, 1)}km · 예상 ${formatDuration(
              plan.expectedDurationSec,
            )}`}
          </AppText>
        </View>
      )}
      {picker}
      <RunStartBar
        night={night}
        config={courseConfig}
        goal={goalChip}
        course={courseChip}
      />
    </>
  );

  return (
    <>
      <ThemeProvider tone="light">
        <MapScreenFrame
          renderMap={logo => (
            <RunMap
              // One mint line, the same as 2.0F's map (S15P31E105-683); the plan's km paces stay in 오늘의 전략.
              route={plan?.route}
              unmeasuredEdges={plan?.unmeasuredEdges}
              position={place?.position ?? undefined}
              placeLabel={
                place
                  ? {
                      title: place.name,
                      sub: `현재 위치 · ${gpsLabels[place.gps]}`,
                    }
                  : undefined
              }
              // The camera frames the course's start, not me: far from the course the fit of both zoomed out
              // and lost the start (S15P31E105-715).
              fitTo={plan?.route?.length ? [plan.route[0]] : undefined}
              area={{ top: 0.19, bottom: 0.56 }}
              logo={logo}
              view="lean"
              look="mint"
              style={StyleSheet.absoluteFill}
            />
          )}
          top={top}
          bottom={bottom}
        />
      </ThemeProvider>
      <RunGoalSheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        mode="COURSE"
        goal={goal}
        course={course}
        onSet={next => {
          keep(next);
          setChoosing(false);
        }}
      />
      {mapGoal && suggested ? (
        <ThemeProvider tone="dark">
          <BottomSheet
            visible={asking}
            onClose={() => setAsking(false)}
            title="어떤 목표로 달릴까요?"
            description="이 코스에는 추천 목표가 있어요."
            background={k1.night}
          >
            <View style={styles.choices}>
              {[
                {
                  label: '코스 추천 목표',
                  goal: suggested,
                  a11y: '코스 추천 목표로 달리기',
                },
                {
                  label: '내가 정한 목표',
                  goal: mapGoal,
                  a11y: '내가 정한 목표 유지',
                },
              ].map(choice => (
                <Pressable
                  key={choice.label}
                  accessibilityRole="button"
                  accessibilityLabel={choice.a11y}
                  onPress={() => {
                    setGoal(choice.goal);
                    setAsking(false);
                  }}
                  style={({ pressed }) => [
                    styles.choice,
                    pressed && styles.choicePressed,
                  ]}
                >
                  <AppText style={styles.choiceKicker}>{choice.label}</AppText>
                  <AppText style={styles.choiceValue} numberOfLines={1}>
                    {goalLabel(choice.goal, plan?.targetPaceSecPerKm)}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </BottomSheet>
        </ThemeProvider>
      ) : null}
    </>
  );
}

const ink = '#02050E';
const grey = '#95969A';

const styles = StyleSheet.create({
  nightTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  picker: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  chipText: { fontFamily: fontFamily.bold, fontSize: 12.5, lineHeight: 16 },
  kickerSheet: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: grey,
  },
  strategy: {
    marginTop: 1,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: ink,
  },
  goal: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: '#67696E',
  },
  caution: { fontFamily: fontFamily.bold, color: '#D44A4A' },
  choices: { gap: 10 },
  choice: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  choicePressed: { opacity: 0.7 },
  choiceKicker: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: grey,
  },
  choiceValue: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 25,
    color: ink,
  },
});
