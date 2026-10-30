import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon } from '../../components';
import { useRepositories, useResource, type Repositories } from '../../data';
import { formatDuration, formatKm, formatPace, isNight } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { k1, radius, spacing, useTheme } from '../../theme';
import { MapScreenFrame } from './MapScreenFrame';
import { k1PaceColors, MockMap } from './MockMap';
import { PlaceCard, RunStartBar } from './parts';
import type { RunConfig } from './RunSession';

const loadCourse = (repositories: Repositories) =>
  Promise.all([
    repositories.courses.getTodayPlan(),
    repositories.run.getCurrentPlace(),
  ]);

function ChangeLink() {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="코스 변경"
      onPress={() => navigateTo(navigation, 'TodayRun')}
      hitSlop={8}
    >
      <AppText variant="captionStrong">변경</AppText>
    </Pressable>
  );
}

// Legend for the segment colors: 빠름 ■■■ 느림, in the K1 map's scale.
function PaceLegend() {
  const { colors } = useTheme();
  return (
    <View style={[styles.legend, { backgroundColor: colors.surfaceRaised }]}>
      <AppText variant="labelStrong">빠름</AppText>
      {k1PaceColors.map(color => (
        <View
          key={color}
          style={[styles.legendBar, { backgroundColor: color }]}
        />
      ))}
      <AppText variant="labelStrong">느림</AppText>
    </View>
  );
}

// 2.0 코스 러닝 (낮) and 2.0N (밤): the chosen course with a pace per km, ready to start.
export function CourseRunScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const resource = useResource(useCallback(loadCourse, []));
  const [plan, place] = resource.status === 'ready' ? resource.data : [];
  // A course run aims at the course distance and the plan's pace.
  const courseConfig: RunConfig | null = plan
    ? {
        mode: 'COURSE',
        plan,
        goalDistanceM: plan.distanceM,
        goalPaceSecPerKm: plan.targetPaceSecPerKm,
      }
    : null;

  const top = !plan ? null : night && place ? (
    <PlaceCard name={place.name} gps={place.gps} />
  ) : (
    <>
      <View style={[styles.topCard, { backgroundColor: colors.surfaceRaised }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={navigation.goBack}
          hitSlop={12}
          style={styles.back}
        >
          <Icon name="back" color={colors.text} size={18} />
        </Pressable>
        <View style={styles.flex}>
          <AppText variant="label" tone="textTertiary">
            오늘의 러닝 전략
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {`${plan.name} ${formatKm(plan.distanceM, 1)}km`}
          </AppText>
        </View>
        <ChangeLink />
      </View>
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
            {`${plan.name} · ${formatKm(plan.distanceM, 1)}km`}
          </AppText>
        </View>
        <ChangeLink />
      </View>
      <RunStartBar night config={courseConfig} />
    </>
  ) : (
    <>
      <View style={styles.strategy}>
        <AppText variant="label" tone="textTertiary">
          오늘의 전략
        </AppText>
        <AppText variant="heading">{plan.strategy}</AppText>
        <AppText variant="label" tone="textSecondary">
          {`목표 ${formatPace(plan.targetPaceSecPerKm)} · 예상 ${formatDuration(
            plan.expectedDurationSec,
          )}`}
          {plan.caution ? (
            <AppText variant="labelStrong" tone="danger">
              {` · ${plan.caution}`}
            </AppText>
          ) : null}
        </AppText>
      </View>
      <RunStartBar night={false} config={courseConfig} />
    </>
  );

  return (
    <MapScreenFrame
      map={
        <MockMap
          k1Style
          night={night}
          route={plan?.route}
          segmentPaces={plan?.segmentPacesSecPerKm}
          showPaceLabels
          formatLabel={(_, pace) => formatPace(pace)}
        />
      }
      top={top}
      bottom={bottom}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // White card with a bare back chevron (DESIGN.md 2-6 지도 위 흰 카드).
  topCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 14,
    paddingLeft: 12,
    paddingRight: 18,
    borderRadius: 24,
    shadowColor: k1.night,
    shadowOpacity: 0.12,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  back: { width: 24, alignItems: 'center' },
  legend: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  legendBar: { width: 14, height: 5, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  tile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strategy: { gap: spacing.xs },
});
