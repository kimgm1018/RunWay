import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, LightGlass } from '../../components';
import { useRepositories, useResource, type Repositories } from '../../data';
import type { RunRecordSummary } from '../../data/types';
import {
  formatDotDate,
  formatDuration,
  formatKm,
  formatPace,
  isNight,
  withoutDistance,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, radius, spacing, useTheme } from '../../theme';
import { MapScreenFrame } from './MapScreenFrame';
import { coursePaceColors } from '../../components/mapRoute';
import { RunMap } from '../../components/RunMap';
import { PlaceCard, RunStartBar } from './parts';
import type { RunConfig } from './RunSession';
import { BackButton } from '../../components/BackButton';

const loadCourse = (repositories: Repositories) =>
  Promise.all([
    repositories.courses.getTodayPlan(),
    repositories.run.getCurrentPlace(),
  ]);

function ChangeLink({ large = false }: { large?: boolean }) {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="코스 변경"
      onPress={() => navigateTo(navigation, 'TodayRun')}
      hitSlop={8}
    >
      <AppText
        variant="captionStrong"
        style={large ? styles.changeText : undefined}
      >
        변경
      </AppText>
    </Pressable>
  );
}

// Legend for the segment colors: 빠름 ■■■ 느림, a small glass pill (runway-course-handoff PaceLegend).
function PaceLegend() {
  return (
    <LightGlass radius={11} style={styles.legend}>
      <AppText style={[styles.legendText, styles.legendStart]}>빠름</AppText>
      {coursePaceColors.map(color => (
        <View
          key={color}
          style={[styles.legendBar, { backgroundColor: color }]}
        />
      ))}
      <AppText style={[styles.legendText, styles.legendEnd]}>느림</AppText>
    </LightGlass>
  );
}

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
          { color: selected ? (night ? colors.background : '#FFFFFF') : night ? colors.text : ink },
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
            `${formatDotDate(run.startedAt)} · ${formatDuration(run.durationSec)}`,
            `${formatDotDate(run.startedAt)} ${formatDuration(run.durationSec)} 기록과 비교`,
            value === run.id,
            run.id,
          ),
        )}
      </View>
    </View>
  );
}

// 2.0 코스 러닝 (낮) and 2.0N (밤): the chosen course with a pace per km, ready to start. By day the
// runway-course-handoff screen: a glass strategy bar, the legend, the hollow pace-colored course and a
// glass strategy sheet.
export function CourseRunScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const resource = useResource(useCallback(loadCourse, []));
  const [plan, place] = resource.status === 'ready' ? resource.data : [];
  const [comparisonSessionId, setComparison] = useState<string | null>(null);
  // A course run aims at the course distance and the plan's pace.
  const courseConfig: RunConfig | null = plan
    ? {
        mode: 'COURSE',
        plan,
        goalDistanceM: plan.distanceM,
        goalPaceSecPerKm: plan.targetPaceSecPerKm,
        comparisonSessionId,
      }
    : null;
  const picker = plan ? (
    <ComparisonPicker
      courseId={plan.courseId}
      night={night}
      value={comparisonSessionId}
      onChange={setComparison}
    />
  ) : null;

  const title = plan
    ? `${withoutDistance(plan.name)} ${formatKm(plan.distanceM, 1)}km`
    : '';
  const top = !plan ? null : night && place ? (
    <PlaceCard name={place.name} gps={place.gps} />
  ) : (
    <>
      <LightGlass radius={31} style={styles.topBar}>
        <BackButton onPress={navigation.goBack} />
        <View style={styles.flex}>
          <AppText style={styles.kicker}>오늘의 러닝 전략</AppText>
          <AppText style={styles.topTitle} numberOfLines={1}>
            {title}
          </AppText>
        </View>
        <ChangeLink large />
      </LightGlass>
      <PaceLegend />
    </>
  );

  const bottom = !plan ? (
    resource.status === 'error' ? (
      <AppText tone="danger">코스를 불러오지 못했어요</AppText>
    ) : (
      <ActivityIndicator />
    )
  ) : night ? (
    <>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: colors.surfaceMuted }]}>
          <Icon name="route" color={colors.text} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="label" tone="textTertiary">
            코스 러닝
          </AppText>
          <AppText variant="heading" numberOfLines={1}>
            {`${withoutDistance(plan.name)} · ${formatKm(plan.distanceM, 1)}km`}
          </AppText>
        </View>
        <ChangeLink />
      </View>
      {picker}
      <RunStartBar night config={courseConfig} />
    </>
  ) : (
    <>
      <View>
        <AppText style={styles.kickerSheet}>오늘의 전략</AppText>
        <AppText style={styles.strategy} numberOfLines={1} adjustsFontSizeToFit>
          {plan.strategy}
        </AppText>
        <AppText style={styles.goal} numberOfLines={1}>
          {`목표 ${formatPace(plan.targetPaceSecPerKm)} · 예상 ${formatDuration(
            plan.expectedDurationSec,
          )}`}
          {plan.caution ? (
            <AppText style={styles.caution}>{` · ${plan.caution}`}</AppText>
          ) : null}
        </AppText>
      </View>
      {picker}
      <RunStartBar night={false} config={courseConfig} />
    </>
  );

  return (
    <MapScreenFrame
      renderMap={logo => (
        <RunMap
          dark={night}
          route={plan?.route}
          segmentPaces={plan?.segmentPacesSecPerKm}
          // The km paces are labelled by day; after sunset the course is a plain white line.
          paceLabels={
            night ? undefined : plan?.segmentPacesSecPerKm.map(formatPace)
          }
          area={{ top: 0.19, bottom: 0.56 }}
          logo={logo}
          style={StyleSheet.absoluteFill}
        />
      )}
      top={top}
      bottom={bottom}
    />
  );
}

const ink = '#02050E';
const grey = '#95969A';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The glass strategy bar: a bare back chevron, the course and 변경.
  topBar: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 18,
  },

  kicker: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: grey,
  },
  topTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: ink,
  },
  changeText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: ink,
  },
  legend: {
    alignSelf: 'flex-end',
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    boxShadow: '0 4px 14px rgba(30,45,60,0.12)',
  },
  legendText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: ink,
  },
  legendStart: { marginRight: 2 },
  legendEnd: { marginLeft: 2 },
  legendBar: { width: 14, height: 5, borderRadius: 3 },
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
  caution: { fontFamily: fontFamily.bold, color: '#C4644B' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  tile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
