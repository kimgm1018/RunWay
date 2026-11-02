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
import Svg, { Circle, Path } from 'react-native-svg';
import {
  AppText,
  Backdrop,
  Button,
  Card,
  Icon,
  IconButton,
  useToast,
} from '../../components';
import { useRepositories, type RecommendedCourse } from '../../data';
import { formatKm } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  k1,
  palette,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { useCourseSearch } from './CourseSearch';
import { RouteLine } from './RouteLine';

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

// One of the three figures on the back, between the 14% lines (DESIGN.md 2-7 3.1b 뒷면).
function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.stat}>
      <AppText style={styles.statValue}>
        {value}
        <AppText variant="label" tone="textSecondary">
          {` ${unit}`}
        </AppText>
      </AppText>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

// 구간 고도: a white line over a 10% white fill, with a dot on the highest tenth.
// It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
function ElevationLine({ profile }: { profile: number[] }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const peak = profile.indexOf(Math.max(...profile));
  const points = box
    ? profile.map((level, index) => ({
        x: (index / Math.max(profile.length - 1, 1)) * box.width,
        y: box.height - 6 - (Math.max(level, 4) / 100) * (box.height - 12),
      }))
    : [];
  const line = points
    .map(
      ({ x, y }, index) =>
        `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`,
    )
    .join(' ');
  return (
    <View
      style={styles.elevation}
      accessibilityLabel="구간 고도"
      onLayout={event => setBox(event.nativeEvent.layout)}
    >
      {box && points.length > 1 ? (
        <Svg width={box.width} height={box.height}>
          <Path
            d={`${line} L${box.width} ${box.height} L0 ${box.height} Z`}
            fill={palette.white}
            fillOpacity={0.1}
          />
          <Path d={line} fill="none" stroke={palette.white} strokeWidth={1.8} />
          <Circle
            cx={points[peak].x}
            cy={points[peak].y}
            r={3.5}
            fill={palette.white}
          />
        </Svg>
      ) : null}
    </View>
  );
}

// 코스 선택 ›: a light pill as wide as its label (dark tone, so the accent is light).
function ChooseButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      title="코스 선택  ›"
      accessibilityLabel="코스 선택"
      onPress={onPress}
      style={styles.choose}
    />
  );
}

// One 3.1b card: the course line on the front, the course detail on the back. Tapping turns it over.
// Both faces are course cards (DESIGN.md 2-7), so everything on them reads the dark tone.
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
        style={[styles.face, face('0deg', '180deg')]}
        pointerEvents={back ? 'none' : 'auto'}
      >
        <Card variant="course" style={styles.faceCard}>
          <View style={styles.route}>
            <RouteLine route={course.route} />
          </View>
          <View style={styles.topRow}>
            <View style={styles.tag}>
              <AppText variant="labelStrong">
                {course.environmentLabels.slice(0, 2).join(' · ')}
              </AppText>
            </View>
            {/* The bookmark sits in a white circle (DESIGN.md 2-7 코스 카드). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={course.saved ? '저장 해제' : '내 코스에 저장'}
              accessibilityState={{ selected: course.saved }}
              onPress={onToggleSave}
              hitSlop={6}
              style={styles.save}
            >
              <Icon name="bookmark" color={k1.night} size={18} />
            </Pressable>
          </View>
          <View style={styles.front}>
            <AppText style={styles.name}>{course.name}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {`${formatKm(course.distanceM, 1)}km · ${minutes}분`}
            </AppText>
            <AppText variant="label" tone="textSecondary">
              카드를 누르면 코스 정보를 볼 수 있어요
            </AppText>
            <ChooseButton onPress={onChoose} />
          </View>
        </Card>
      </Animated.View>
      <Animated.View
        style={[styles.face, face('180deg', '360deg')]}
        pointerEvents={back ? 'auto' : 'none'}
      >
        <Card variant="course" style={[styles.faceCard, styles.backFace]}>
          <BackFace
            course={course}
            minutes={minutes}
            onTurn={() => setBack(false)}
            onChoose={onChoose}
          />
        </Card>
      </Animated.View>
    </Pressable>
  );
}

function BackFace({
  course,
  minutes,
  onTurn,
  onChoose,
}: {
  course: RecommendedCourse;
  minutes: number;
  onTurn: () => void;
  onChoose: () => void;
}) {
  const { colors } = useTheme();
  const rule = { borderColor: colors.border };
  return (
    <>
      <View style={styles.between}>
        <View style={styles.tags}>
          <View style={[styles.kind, { backgroundColor: colors.surfaceMuted }]}>
            <AppText variant="labelStrong">{course.shapeKind}</AppText>
          </View>
          <AppText variant="label" tone="textSecondary">
            {course.environmentLabels.join(' · ')}
          </AppText>
        </View>
        <IconButton
          icon="refresh"
          accessibilityLabel="앞면으로 돌아가기"
          onPress={onTurn}
        />
      </View>
      <AppText style={styles.name}>{course.name}</AppText>
      <View style={[styles.stats, rule]}>
        <Stat label="거리" value={formatKm(course.distanceM, 1)} unit="km" />
        <Stat label="예상" value={String(minutes)} unit="분" />
        <Stat
          label="고도"
          value={
            course.elevationGainM === null ? '– –' : `↑${course.elevationGainM}`
          }
          unit={course.elevationGainM === null ? '' : 'm'}
        />
      </View>
      <AppText variant="label" tone="textSecondary">
        구간 고도
      </AppText>
      <ElevationLine profile={course.elevationProfile} />
      <View style={styles.reason}>
        <AppText variant="label" tone="textSecondary">
          추천 이유
        </AppText>
        <AppText variant="body">{course.reason}</AppText>
      </View>
      <AppText variant="label" tone="textSecondary">
        카드를 누르면 앞면으로 돌아가요
      </AppText>
      <ChooseButton onPress={onChoose} />
    </>
  );
}

function PageDots({ count, index }: { count: number; index: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }, (_, position) => (
        <View
          key={position}
          style={[
            styles.dot,
            position === index
              ? [styles.activeDot, { backgroundColor: colors.accent }]
              : { backgroundColor: colors.borderStrong },
          ]}
        />
      ))}
    </View>
  );
}

// 3.1b 추천 코스: swipe through the recommendations, turn a card over for its detail, then start.
export function RecommendedCoursesScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { courses } = useRepositories();
  const toast = useToast();
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
    try {
      if (course.saved) {
        await courses.unsave(course.id);
      } else {
        await courses.save(course.id);
      }
    } catch {
      toast('코스를 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
      return;
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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={navigation.goBack}
        />
        <AppText accessibilityRole="header" style={[styles.flex, styles.title]}>
          추천 코스
        </AppText>
        {results ? (
          <AppText tone="textSecondary" style={styles.count}>
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
        <AppText variant="captionStrong" style={styles.underline}>
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
          {/* The dots sit on the black lower part, so they are white. */}
          <ThemeProvider tone="dark">
            <PageDots count={results.length} index={index} />
          </ThemeProvider>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  title: { fontFamily: fontFamily.medium, fontSize: 19, lineHeight: 26 },
  count: { fontFamily: fontFamily.numberRegular, fontSize: 13 },
  change: { alignSelf: 'flex-end', paddingHorizontal: spacing.screen },
  underline: { textDecorationLine: 'underline' },
  carousel: { flex: 1 },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backfaceVisibility: 'hidden',
  },
  faceCard: { flex: 1, borderRadius: 28 },
  backFace: { gap: spacing.lg },
  // The course line fills the upper part of the front.
  route: {
    position: 'absolute',
    top: 64,
    left: 36,
    right: 36,
    bottom: 200,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  tag: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  save: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: k1.ice,
    alignItems: 'center',
    justifyContent: 'center',
  },
  front: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    gap: spacing.xs,
  },
  name: {
    fontFamily: fontFamily.regular,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  choose: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    marginTop: spacing.md,
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
    borderRadius: 999,
  },
  // The three figures sit between a line above and below.
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: spacing.lg,
  },
  stat: { flex: 1, gap: 2 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 28,
    lineHeight: 34,
  },
  // The chart takes the card's spare height, so the back has no empty band.
  elevation: { flex: 1, minHeight: 48 },
  reason: { gap: spacing.xs },
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
