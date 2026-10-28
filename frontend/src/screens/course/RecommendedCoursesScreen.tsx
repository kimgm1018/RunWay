import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Button, IconButton } from '../../components';
import { useRepositories, type RecommendedCourse } from '../../data';
import { formatKm } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { radius, size, spacing, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import { useCourseSearch } from './CourseSearch';

const defaultSearch = {
  origin: {
    name: '광안리해수욕장 · 현재 위치',
    position: [129.1186, 35.1532] as [number, number],
  },
  targetDistanceM: 5000,
  goalInputType: 'TIME' as const,
  targetDurationSec: 1800,
  targetPaceSecPerKm: null,
  environmentTypes: [],
};

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}>
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <AppText variant="metricLarge">
        {value}
        <AppText variant="caption" tone="textTertiary">
          {` ${unit}`}
        </AppText>
      </AppText>
    </View>
  );
}

// One 3.1b card: the map on the front, the course detail on the back. Tapping turns it over.
function CourseCard({
  course,
  width,
  height,
  onChoose,
  onToggleSave,
}: {
  course: RecommendedCourse;
  width: number;
  height: number;
  onChoose: () => void;
  onToggleSave: () => void;
}) {
  const { colors } = useTheme();
  const [back, setBack] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: back ? 1 : 0,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [back, turn]);
  const face = (from: string, to: string) => ({
    transform: [
      { perspective: 1200 },
      {
        rotateY: turn.interpolate({
          inputRange: [0, 1],
          outputRange: [from, to],
        }),
      },
    ],
  });
  const minutes = Math.round(course.estimatedDurationSec / 60);
  // The chevron follows the label, as in the prototype.
  const choose = (
    <Button
      title="코스 선택  ›"
      accessibilityLabel="코스 선택"
      onPress={onChoose}
    />
  );
  const shell = [
    styles.face,
    { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${course.name}, ${
        back ? '앞면 보기' : '코스 정보 보기'
      }`}
      onPress={() => setBack(value => !value)}
      style={{ width, height }}
    >
      <Animated.View
        style={[shell, face('0deg', '180deg')]}
        pointerEvents={back ? 'none' : 'auto'}
      >
        <View style={styles.map}>
          <MockMap
            night
            route={course.route}
            routeArea={{ top: 120, bottom: 400 }}
          />
        </View>
        <View style={styles.topRight}>
          <IconButton
            icon="bookmark"
            accessibilityLabel={course.saved ? '저장 해제' : '내 코스에 저장'}
            onPress={onToggleSave}
          />
        </View>
        {/* The map fades to the card color behind the title. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient
              id={`fade-${course.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <Stop
                offset="0.45"
                stopColor={colors.surfaceRaised}
                stopOpacity={0}
              />
              <Stop
                offset="0.75"
                stopColor={colors.surfaceRaised}
                stopOpacity={0.92}
              />
              <Stop
                offset="1"
                stopColor={colors.surfaceRaised}
                stopOpacity={1}
              />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#fade-${course.id})`} />
        </Svg>
        <View style={styles.front}>
          <AppText variant="title">{course.name}</AppText>
          <AppText variant="caption" tone="textSecondary">
            {`${formatKm(course.distanceM, 1)}km · ${minutes}분`}
          </AppText>
          <AppText variant="label" tone="textTertiary">
            카드를 누르면 코스 정보를 볼 수 있어요
          </AppText>
          {choose}
        </View>
      </Animated.View>
      <Animated.View
        style={[shell, styles.backFace, face('180deg', '360deg')]}
        pointerEvents={back ? 'auto' : 'none'}
      >
        <View style={styles.between}>
          <View style={styles.tags}>
            <View style={[styles.kind, { backgroundColor: colors.accentSoft }]}>
              <AppText variant="labelStrong" tone="accentText">
                {course.shapeKind}
              </AppText>
            </View>
            <AppText variant="label" tone="textSecondary">
              {course.environmentLabels.join(' · ')}
            </AppText>
          </View>
          <IconButton
            icon="refresh"
            accessibilityLabel="앞면으로 돌아가기"
            onPress={() => setBack(false)}
          />
        </View>
        <AppText variant="title">{course.name}</AppText>
        <View style={styles.stats}>
          <Stat label="거리" value={formatKm(course.distanceM, 1)} unit="km" />
          <Stat label="예상" value={String(minutes)} unit="분" />
          <Stat label="고도" value={`↑${course.elevationGainM}`} unit="m" />
        </View>
        <AppText variant="label" tone="textTertiary">
          구간 고도
        </AppText>
        <View style={styles.elevation} accessibilityLabel="구간 고도">
          {course.elevationProfile.map((level, index) => (
            <View
              key={`${course.id}-${index}`}
              style={[
                styles.elevationBar,
                {
                  height: `${Math.max(level, 8)}%`,
                  backgroundColor:
                    level === Math.max(...course.elevationProfile)
                      ? colors.accent
                      : colors.accentSoft,
                },
              ]}
            />
          ))}
        </View>
        <View
          style={[
            styles.reason,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}
        >
          <AppText variant="captionStrong" tone="accentText">
            추천 이유
          </AppText>
          <AppText variant="caption">{course.reason}</AppText>
        </View>
        <AppText variant="label" tone="textTertiary" style={styles.centerText}>
          카드를 누르면 앞면으로 돌아가요
        </AppText>
        {choose}
      </Animated.View>
    </Pressable>
  );
}

// 3.1b 추천 코스: swipe through the recommendations, turn a card over for its detail, then start.
export function RecommendedCoursesScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { courses } = useRepositories();
  const { search, results, setResults } = useCourseSearch();
  const window = useWindowDimensions();
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  // The prototype's 284px card on a 360px screen; the height fills what is left below the header.
  const cardWidth = Math.round(window.width * (284 / 360));
  const [area, setArea] = useState(0);
  const cardHeight = area
    ? area - spacing.xl * 2
    : Math.round(cardWidth * (496 / 284));
  const gap = spacing.md;
  const step = cardWidth + gap;
  const side = (window.width - cardWidth) / 2;

  // Opened without going through 3.1: ask with the default conditions.
  useEffect(() => {
    if (results) {
      return;
    }
    courses
      .recommend(search ?? defaultSearch)
      .then(setResults, () => setFailed(true));
  }, [courses, results, search, setResults]);

  const toggleSave = async (course: RecommendedCourse) => {
    if (course.saved) {
      await courses.unsave(course.id);
    } else {
      await courses.save(course.id);
    }
    setResults(
      (results ?? []).map(item =>
        item.id === course.id ? { ...item, saved: !course.saved } : item,
      ),
    );
  };
  const choose = async (course: RecommendedCourse) => {
    await courses.choose(course.id);
    navigateTo(navigation, 'CourseRun');
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={colors.statusBar} />
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={navigation.goBack}
        />
        <AppText
          variant="heading"
          accessibilityRole="header"
          style={styles.flex}
        >
          추천 코스
        </AppText>
        {results ? (
          <AppText variant="metricSmall" tone="textSecondary">
            {`${index + 1} / ${results.length}`}
          </AppText>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="조건 변경"
        onPress={() => navigateTo(navigation, 'TodayRun')}
        style={styles.change}
        hitSlop={8}
      >
        <AppText variant="captionStrong" tone="accentText">
          조건 변경
        </AppText>
      </Pressable>
      {!results ? (
        <View style={styles.center}>
          {failed ? (
            <AppText tone="danger">추천 코스를 불러오지 못했어요</AppText>
          ) : (
            <ActivityIndicator />
          )}
        </View>
      ) : (
        <>
          <View
            style={styles.flex}
            onLayout={event => setArea(event.nativeEvent.layout.height)}
          >
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={step}
              decelerationRate="fast"
              contentContainerStyle={[
                styles.track,
                { paddingHorizontal: side, gap },
              ]}
              style={styles.carousel}
              scrollEventThrottle={16}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                {
                  useNativeDriver: true,
                  listener: event =>
                    setIndex(
                      Math.min(
                        results.length - 1,
                        Math.max(
                          0,
                          Math.round(
                            (
                              event as {
                                nativeEvent: { contentOffset: { x: number } };
                              }
                            ).nativeEvent.contentOffset.x / step,
                          ),
                        ),
                      ),
                    ),
                },
              )}
            >
              {results.map((course, position) => {
                const range = [
                  (position - 1) * step,
                  position * step,
                  (position + 1) * step,
                ];
                return (
                  <Animated.View
                    key={course.id}
                    style={{
                      // Side cards shrink and fade, as in the prototype.
                      transform: [
                        {
                          scale: scrollX.interpolate({
                            inputRange: range,
                            outputRange: [0.9, 1, 0.9],
                            extrapolate: 'clamp',
                          }),
                        },
                      ],
                      opacity: scrollX.interpolate({
                        inputRange: range,
                        outputRange: [0.55, 1, 0.55],
                        extrapolate: 'clamp',
                      }),
                    }}
                  >
                    <CourseCard
                      course={course}
                      width={cardWidth}
                      height={cardHeight}
                      onChoose={() => choose(course)}
                      onToggleSave={() => toggleSave(course)}
                    />
                  </Animated.View>
                );
              })}
            </Animated.ScrollView>
          </View>
          <View style={styles.dots}>
            {results.map((course, position) => (
              <View
                key={course.id}
                style={[
                  styles.dot,
                  position === index
                    ? [styles.activeDot, { backgroundColor: colors.accent }]
                    : { backgroundColor: colors.borderStrong },
                ]}
              />
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  change: { alignSelf: 'flex-end', paddingHorizontal: spacing.screen },
  carousel: { flex: 1 },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.sheet - 2,
    borderWidth: 1,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
  },
  backFace: { padding: spacing.xxl, gap: spacing.lg },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  topRight: { position: 'absolute', top: spacing.xl, right: spacing.xl },
  front: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.xxl,
    gap: spacing.xs,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  kind: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
  },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xxs,
  },
  // The chart takes the card's spare height, so the back has no empty band.
  elevation: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  elevationBar: { flex: 1, borderRadius: 2 },
  reason: {
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  activeDot: { width: 18 },
  track: { alignItems: 'center' },
});
