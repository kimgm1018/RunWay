import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { AppText, Backdrop, Icon, MistFill, useToast } from '../../components';
import { useRepositories, type RecommendedCourse } from '../../data';
import { formatKm, formatPace, withoutDistance } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, palette } from '../../theme';
import { useCourseSearch } from './CourseSearch';
import { recommendFailureNotice } from './recommendFailure';
import { useRequestTicket } from './requestTicket';
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
        <AppText style={styles.statUnit}>{` ${unit}`}</AppText>
      </AppText>
      <AppText style={styles.statLabel}>{label}</AppText>
    </View>
  );
}

// 구간 고도: a line over a 10% fill of the same color, with a dot on the highest tenth.
// It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
function ElevationLine({
  profile,
  color = palette.white,
}: {
  profile: number[];
  color?: string;
}) {
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
            fill={color}
            fillOpacity={0.1}
          />
          <Path d={line} fill="none" stroke={color} strokeWidth={1.8} />
          <Circle
            cx={points[peak].x}
            cy={points[peak].y}
            r={3.5}
            fill={color}
          />
        </Svg>
      ) : null}
    </View>
  );
}

// 이 코스로 달리기: the white button across the card's foot (runway-course-handoff 3.1b).
// On the front it floats over the card's foot; on the back it sits under the details.
function ChooseButton({
  onPress,
  inline = false,
}: {
  onPress: () => void;
  inline?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="이 코스로 달리기"
      onPress={onPress}
      style={({ pressed }) => [
        styles.choose,
        inline ? styles.chooseInline : styles.chooseFloating,
        pressed && styles.pressed,
      ]}
    >
      <AppText style={styles.chooseText}>이 코스로 달리기</AppText>
    </Pressable>
  );
}

// The darker foot of a 3.1b card: clear for its top 38%, then deepening to 45% near-black.
function CardFoot({ id, width }: { id: string; width: number }) {
  return (
    <View style={styles.foot} pointerEvents="none">
      <Svg width={width} height={footHeight}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor="#06080B" stopOpacity={0} />
            <Stop offset={0.38} stopColor="#06080B" stopOpacity={0} />
            <Stop offset={0.66} stopColor="#06080B" stopOpacity={0.25} />
            <Stop offset={1} stopColor="#06080B" stopOpacity={0.45} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={footHeight} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

// A small dark-glass pill on the card: the distance, the environment, the goal pace.
function Pill({ label, small = false }: { label: string; small?: boolean }) {
  return (
    <View style={[styles.pill, small && styles.pillSmall]}>
      <AppText style={[styles.pillText, small && styles.pillTextSmall]}>
        {label}
      </AppText>
    </View>
  );
}

// One 3.1b card: the course line on the front, the course detail on the back. Tapping turns it over.
// Both faces are course cards (DESIGN.md 2-7), so everything on them reads the dark tone.
function CourseCard({
  course,
  width,
  height,
  page,
  goalPace,
  onChoose,
  onToggleSave,
  onTurned,
}: {
  course: RecommendedCourse;
  width: number;
  height: number;
  // This card's place among the recommendations, for the dots on it.
  page: { index: number; count: number };
  // The pace asked for on 3.1, shown as 목표 6′00″/km.
  goalPace: number | null;
  onChoose: () => void;
  onToggleSave: () => void;
  // Tells the screen which face is up, so the page count can step aside for the back.
  onTurned: (back: boolean) => void;
}) {
  const [back, setBack] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => onTurned(back), [back, onTurned]);
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
        {/* runway-course-handoff 3.1b: the mist card with the bare course line, a darker foot and the details. */}
        <View style={[styles.faceCard, styles.mistCard]}>
          <MistFill id={`course${course.id}`} />
          <View style={styles.route}>
            <RouteLine route={course.route} thin />
          </View>
          <CardFoot id={`foot${course.id}`} width={width} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={course.saved ? '저장 해제' : '내 코스에 저장'}
            accessibilityState={{ selected: course.saved }}
            onPress={onToggleSave}
            hitSlop={6}
            style={[styles.save, course.saved && styles.saveOn]}
          >
            <Icon
              name="bookmark"
              color={k1.night}
              size={24}
              solid={course.saved}
            />
          </Pressable>
          <View style={styles.front}>
            <View
              style={styles.cardDots}
              importantForAccessibility="no-hide-descendants"
            >
              {Array.from({ length: page.count }, (_, position) => (
                <View
                  key={position}
                  style={[
                    styles.cardDot,
                    position === page.index && styles.cardDotOn,
                  ]}
                />
              ))}
            </View>
            <View style={styles.nameRow}>
              <AppText
                style={styles.name}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {withoutDistance(course.name)}
              </AppText>
              <Pill label={`${formatKm(course.distanceM, 1)}km`} />
            </View>
            <AppText style={styles.kind}>{`${course.shapeKind} 코스`}</AppText>
            <View style={styles.facts}>
              <View style={styles.fact}>
                <Icon name="clock" color="#FFFFFF" size={18} strokeWidth={2} />
                <AppText style={styles.factText}>{`약 ${minutes}분`}</AppText>
              </View>
              {course.elevationGainM ? (
                <View style={styles.fact}>
                  <Icon
                    name="mountain"
                    color="#FFFFFF"
                    size={18}
                    strokeWidth={2}
                  />
                  <AppText
                    style={styles.factText}
                  >{`오르막 ${course.elevationGainM}m`}</AppText>
                </View>
              ) : null}
            </View>
            <View style={styles.pills}>
              {course.environmentLabels.length > 0 ? (
                <Pill
                  small
                  label={course.environmentLabels.slice(0, 2).join(' · ')}
                />
              ) : null}
              {goalPace ? (
                <Pill small label={`목표 ${formatPace(goalPace)}/km`} />
              ) : null}
            </View>
          </View>
          <ChooseButton onPress={onChoose} />
        </View>
      </Animated.View>
      <Animated.View
        style={[styles.face, face('180deg', '360deg')]}
        pointerEvents={back ? 'auto' : 'none'}
      >
        <View style={[styles.faceCard, styles.mistCard]}>
          <MistFill id={`courseBack${course.id}`} />
          <CardFoot id={`backFoot${course.id}`} width={width} />
          <BackFace
            course={course}
            minutes={minutes}
            onTurn={() => setBack(false)}
            onChoose={onChoose}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
}

// The back of a 3.1b card, on the same mist as the front (담당자 요청, no mockup of its own). The light
// top half reads in ink: the course kind, the name and the climb chart. The dark foot reads in white: the
// figures, why it was picked and 이 코스로 달리기. 앞면으로 sits where the front keeps its save button.
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
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="앞면으로 돌아가기"
        onPress={onTurn}
        hitSlop={6}
        style={styles.save}
      >
        <Icon name="refresh" color={k1.night} size={22} />
      </Pressable>
      <View style={styles.back}>
        <View style={styles.backTags}>
          <View style={styles.inkPill}>
            <AppText style={styles.inkPillText}>{course.shapeKind}</AppText>
          </View>
          <AppText style={styles.inkNote} numberOfLines={1}>
            {course.environmentLabels.join(' · ')}
          </AppText>
        </View>
        <AppText
          style={[styles.name, styles.backName]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {withoutDistance(course.name)}
        </AppText>
        <View style={styles.chart}>
          <AppText style={styles.inkNote}>구간 고도</AppText>
          <ElevationLine profile={course.elevationProfile} color={backInk} />
        </View>
        <View style={styles.stats}>
          <Stat label="거리" value={formatKm(course.distanceM, 1)} unit="km" />
          <Stat label="예상" value={String(minutes)} unit="분" />
          <Stat
            label="고도"
            value={
              course.elevationGainM === null
                ? '– –'
                : `↑${course.elevationGainM}`
            }
            unit={course.elevationGainM === null ? '' : 'm'}
          />
        </View>
        <View style={styles.reason}>
          <AppText style={styles.reasonLabel}>추천 이유</AppText>
          <AppText style={styles.reasonText}>{course.reason}</AppText>
        </View>
        <ChooseButton onPress={onChoose} inline />
      </View>
    </>
  );
}

const backInk = '#0D171F';

// 3.1b 추천 코스: swipe through the recommendations, turn a card over for its detail, then start.
// runway-course-handoff: the title in the middle of the top bar with the page count, cards 20 from the
// left with the next one showing 12 at the right, on the light-to-dark backdrop.
export function RecommendedCoursesScreen() {
  const navigation = useNavigation();
  const { courses } = useRepositories();
  const toast = useToast();
  const { search, results, notices, nextSeed, setSearch, setResults } =
    useCourseSearch();
  const [loadingMore, setLoadingMore] = useState(false);
  // Set at once on a tap, so a second tap in the same frame does not start another C01.
  const askingMore = useRef(false);
  // A 다른 코스 answer that comes back after the search changed or 3.1b closed is dropped.
  const moreTicket = useRequestTicket(search);
  const window = useWindowDimensions();
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  // Courses turned to their back; the page count hides while the one in view is turned.
  const [turned, setTurned] = useState<string[]>([]);
  // Unchanged lists come back as they are, so a card reporting the same face does not re-render the screen.
  const markTurned = useCallback(
    (id: string, back: boolean) =>
      setTurned(current =>
        back === current.includes(id)
          ? current
          : back
          ? [...current, id]
          : current.filter(item => item !== id),
      ),
    [],
  );
  const scrollX = useRef(new Animated.Value(0)).current;
  // 350 wide on a 390 screen: 20 to the left, 8 between, the next card 12 in view. The height fills
  // what is left under the top bar, 16 below it and 24 above the bottom.
  const cardWidth = window.width - 40;
  const [area, setArea] = useState(0);
  const cardHeight = area
    ? area - 16 - 24
    : Math.round(cardWidth * (680 / 350));
  const gap = 8;
  const step = cardWidth + gap;
  const side = 20;
  // 3.1 asked for a pace, or a finish time that gives one.
  const goalPace =
    search?.targetPaceSecPerKm ??
    (search?.targetDurationSec
      ? search.targetDurationSec / (search.targetDistanceM / 1000)
      : null);

  // Opened without going through 3.1: ask with the default conditions.
  useEffect(() => {
    if (results) {
      return;
    }
    const asked = search ?? defaultSearch;
    courses.recommend(asked).then(
      found => setSearch(asked, found),
      () => setFailed(true),
    );
  }, [courses, results, search, setSearch]);

  // 다른 코스: the same conditions with the nextSeed of the last answer.
  const showMore = async () => {
    if (!search || nextSeed === null || askingMore.current) {
      return;
    }
    const next = { ...search, seed: nextSeed };
    const ticket = moreTicket.take();
    askingMore.current = true;
    setLoadingMore(true);
    try {
      const found = await courses.recommend(next);
      if (!moreTicket.isCurrent(ticket)) {
        return;
      }
      if (found.courses.length === 0) {
        toast('다른 코스를 찾지 못했어요. 조건을 바꿔 보세요');
        return;
      }
      setTurned([]);
      setIndex(0);
      setSearch(next, found);
    } catch (error) {
      if (moreTicket.isCurrent(ticket)) {
        toast(recommendFailureNotice(error).title);
      }
    } finally {
      askingMore.current = false;
      setLoadingMore(false);
    }
  };

  // A route C01 just made has no course id until 371 saves it.
  const notYet = () => toast('새로 만든 코스의 저장과 시작은 준비 중이에요');

  const toggleSave = async (course: RecommendedCourse) => {
    if (course.generated) {
      notYet();
      return;
    }
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
    if (course.generated) {
      notYet();
      return;
    }
    await courses.choose(course.id);
    navigateTo(navigation, 'CourseRun');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      {/* The page count sits in the bar, not on the card (README 알려진 문제). The mockup has no back
          button or 조건 변경: the system back returns to 3.1 with the conditions. */}
      <View style={styles.header}>
        <AppText accessibilityRole="header" style={styles.title}>
          추천 코스
        </AppText>
        {results && !turned.includes(results[index]?.id) ? (
          <AppText style={styles.count}>
            {`${index + 1} / ${results.length}`}
          </AppText>
        ) : null}
        {results && nextSeed !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다른 코스 추천받기"
            accessibilityState={{ busy: loadingMore }}
            disabled={loadingMore}
            onPress={showMore}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <AppText style={styles.moreText}>
              {loadingMore ? '찾는 중…' : '다른 코스'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {/* Route's notes about the whole answer, as plain text. */}
      {results && notices.length > 0 ? (
        <AppText style={styles.notice}>{notices.join('\n')}</AppText>
      ) : null}
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
                      // The next card waits smaller and fainter (600 high at 0.85 in the mockup), its near
                      // edge kept where it is so 12 of it stays in view.
                      transform: [
                        {
                          translateX: scrollX.interpolate({
                            inputRange: range,
                            outputRange: [
                              (-cardWidth * (1 - sideScale)) / 2,
                              0,
                              (cardWidth * (1 - sideScale)) / 2,
                            ],
                            extrapolate: 'clamp',
                          }),
                        },
                        {
                          scale: scrollX.interpolate({
                            inputRange: range,
                            outputRange: [sideScale, 1, sideScale],
                            extrapolate: 'clamp',
                          }),
                        },
                      ],
                      opacity: scrollX.interpolate({
                        inputRange: range,
                        outputRange: [0.85, 1, 0.85],
                        extrapolate: 'clamp',
                      }),
                    }}
                  >
                    <CourseCard
                      course={course}
                      width={cardWidth}
                      height={cardHeight}
                      page={{ index: position, count: results.length }}
                      goalPace={goalPace}
                      onChoose={() => choose(course)}
                      onToggleSave={() => toggleSave(course)}
                      onTurned={back => markTurned(course.id, back)}
                    />
                  </Animated.View>
                );
              })}
            </Animated.ScrollView>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const footHeight = 330;
// The cards beside the current one.
const sideScale = 0.88;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85 },
  header: {
    height: 76,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 7,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: '#02050E',
  },
  count: {
    position: 'absolute',
    right: 24,
    bottom: 10,
    fontFamily: fontFamily.numberRegular,
    fontSize: 14,
    color: '#67696E',
  },
  more: {
    position: 'absolute',
    left: 16,
    bottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  moreText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    color: '#02050E',
  },
  notice: {
    marginHorizontal: 24,
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#67696E',
    textAlign: 'center',
  },
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
  mistCard: {
    borderRadius: 30,
    overflow: 'hidden',
    boxShadow: '0 14px 34px rgba(0,0,0,0.22)',
  },
  // The course line fills the upper part of the front.
  route: {
    position: 'absolute',
    top: 70,
    left: 50,
    right: 50,
    bottom: 340,
  },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // A round 62 glass button (the mockup's 65×62 oval, README 알려진 문제).
  save: {
    position: 'absolute',
    top: 11,
    right: 8,
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveOn: { backgroundColor: 'rgba(255,255,255,0.8)' },
  // From the foot up: the button, then 16 · pills · 16 · facts · 14 · kind · 2 · name · 16 · dots.
  front: {
    position: 'absolute',
    left: 22,
    right: 18,
    bottom: 14 + 58 + 16,
  },
  cardDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 16,
  },
  cardDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  cardDotOn: { backgroundColor: '#FFFFFF' },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  name: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  pill: {
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  pillSmall: { paddingHorizontal: 14 },
  pillText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  pillTextSmall: { fontSize: 13 },
  kind: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.55)',
  },
  facts: { flexDirection: 'row', gap: 18, marginTop: 14 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  factText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  pills: { flexDirection: 'row', gap: 8, marginTop: 16 },
  choose: {
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F8F9FA',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
  },
  chooseText: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: '#111111',
  },
  chooseFloating: { position: 'absolute', left: 14, right: 14, bottom: 14 },
  chooseInline: { alignSelf: 'stretch' },
  // The back fills the card, 22 from the sides and 14 above the bottom like the front's button.
  back: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    paddingTop: 24,
    paddingHorizontal: 22,
    paddingBottom: 14,
  },
  backTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 64,
  },
  inkPill: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.55)',
    justifyContent: 'center',
  },
  inkPillText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: backInk,
  },
  inkNote: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(13,23,31,0.6)',
  },
  backName: { marginTop: 22, color: backInk },
  // The chart takes the space between the name and the figures.
  chart: { flex: 1, marginTop: 18, marginBottom: 14, gap: 6 },
  // The three figures side by side, without rules (담당자 결정).
  stats: { flexDirection: 'row', paddingVertical: 12 },
  stat: { flex: 1, gap: 2 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 28,
    lineHeight: 34,
    color: '#FFFFFF',
  },
  statUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.55)',
  },
  elevation: { flex: 1, minHeight: 48 },
  // 14 under the figures and 16 over the button, like the front's last row.
  reason: { gap: 4, marginTop: 14, marginBottom: 16 },
  reasonLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.55)',
  },
  reasonText: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  track: { alignItems: 'center' },
});
