import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
// Kept out of components/index.ts: RunMap loads the Naver Map native module.
import { RunMap, type RunMapArea } from '../../components/RunMap';
import {
  AppText,
  Backdrop,
  Button,
  EmptyState,
  Icon,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type SavedCourse,
} from '../../data';
import { formatKm } from '../../format';
import type { LngLat } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, palette, spacing } from '../../theme';
import { CourseTabs } from './CourseTabs';

const loadSaved = (repositories: Repositories) =>
  repositories.courses.getSaved();

const isPoint = (point: unknown): point is [number, number] =>
  Array.isArray(point) &&
  point.length >= 2 &&
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]);

// Only the points that can be drawn. H01 · CMT02 summaries carry no route (shape []), and a broken point
// is dropped rather than guessed, so an unknown route draws nothing (S15P31E105-567).
export function drawableShape(
  shape: readonly [number, number][] | null | undefined,
): [number, number][] {
  return Array.isArray(shape) ? shape.filter(isPoint) : [];
}

// The whole kms along a course, as shares of its length: every km, or every 5 km past 10 km so a long
// course does not turn into a row of dots. A mark too close to the finish is left out.
export function kmMarks(km: number | undefined) {
  if (!km || !(km > 1)) {
    return [];
  }
  const step = km > 10 ? 5 : 1;
  const marks: number[] = [];
  for (let at = step; at < km - step / 4; at += step) {
    marks.push(at / km);
  }
  return marks;
}

// The point a share of the way along a line of points.
function pointAlong(route: [number, number][], share: number) {
  const lengths = route
    .slice(1)
    .map((point, index) =>
      Math.hypot(point[0] - route[index][0], point[1] - route[index][1]),
    );
  let left = share * lengths.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < lengths.length; index += 1) {
    if (left <= lengths[index] && lengths[index] > 0) {
      const t = left / lengths[index];
      const [from, to] = [route[index], route[index + 1]];
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    left -= lengths[index];
  }
  return route[route.length - 1];
}

// A start and finish closer than this (of the box) count as one place: a loop or an out-and-back.
const sameSpot = 0.06;

// The way the line leaves route[from], stepping by `step` (1 forward, -1 back) to the first point far enough
// to give a direction, as a unit vector; none when every point sits on top of it.
export function towards(
  route: [number, number][],
  from: number,
  step: 1 | -1,
): [number, number] {
  const [x, y] = route[from];
  for (let at = from + step; at >= 0 && at < route.length; at += step) {
    const dx = route[at][0] - x;
    const dy = route[at][1] - y;
    const length = Math.hypot(dx, dy);
    if (length > 0.02) {
      return [dx / length, dy / length];
    }
  }
  return [0, 0];
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);
// How far from its point a label sits, and the half height that centres it there, in the 100 box.
const labelGap = 10;
const labelHalf = 3;

// The S · F · SF label on the side away from the line, so it never sits on it: opposite the ways the line
// leaves the point, or beside the line where it runs straight through. Kept inside the box.
export function labelAt(
  [x, y]: [number, number],
  ways: [number, number][],
) {
  let [awayX, awayY] = ways.reduce(
    ([sumX, sumY], [wayX, wayY]) => [sumX - wayX, sumY - wayY],
    [0, 0],
  );
  if (Math.hypot(awayX, awayY) < 0.3) {
    // Straight through (or no way at all): the side to the left of the line, or below a lone point.
    const [wayX, wayY] = ways[0] ?? [0, 0];
    [awayX, awayY] = wayX || wayY ? [wayY, -wayX] : [0, 1];
  }
  const length = Math.hypot(awayX, awayY);
  return {
    x: clamp(x * 100 + (awayX / length) * labelGap, 7, 93),
    y: clamp(y * 100 + (awayY / length) * labelGap + labelHalf, 9, 97),
  };
}

const glyphInk = { ink: '#060606', white: palette.white };
const glyphHalo = { ink: palette.white, white: '#060606' };

// The course's outline (S15P31E105-562 G안): a thin line with a dot on each whole km, the start dot and its
// S · F labels — one SF where the course ends where it started. `tone` follows what the outline sits on: ink
// on the light top of a card (3.1c, the light post photo), white on a dark one.
// No drawable point draws nothing; a single point draws only the start dot.
export function CourseGlyph({
  shape,
  km,
  tone = 'white',
}: {
  shape: [number, number][];
  // The course's length, for the km dots. Left out, none are drawn.
  km?: number;
  tone?: keyof typeof glyphInk;
}) {
  const route = drawableShape(shape);
  if (route.length === 0) {
    return null;
  }
  const color = glyphInk[tone];
  const points = route.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  const [startX, startY] = route[0];
  const line = route.length > 1;
  const end = route[route.length - 1];
  const loop =
    Math.hypot(end[0] - startX, end[1] - startY) <= sameSpot;
  const last = route.length - 1;
  // A loop's SF has the line leaving and coming back; S and F each have one side of it.
  const start = labelAt(
    route[0],
    loop ? [towards(route, 0, 1), towards(route, last, -1)] : [towards(route, 0, 1)],
  );
  const finish = labelAt(end, [towards(route, last, -1)]);
  const label = (at: { x: number; y: number }, text: string) => (
    <SvgText
      key={text}
      x={at.x}
      y={at.y}
      fontSize={9}
      fontWeight="700"
      textAnchor="middle"
      fill={color}
    >
      {text}
    </SvgText>
  );
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      {/* A faint halo in the other tone keeps the line clear where the card turns dark under it. */}
      {line ? (
        <Polyline
          points={points}
          fill="none"
          stroke={glyphHalo[tone]}
          strokeOpacity={0.35}
          strokeWidth={4.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {line ? (
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {line
        ? kmMarks(km).map(share => {
            const [x, y] = pointAlong(route, share);
            return (
              <Circle
                key={share}
                cx={x * 100}
                cy={y * 100}
                r={2}
                fill={color}
              />
            );
          })
        : null}
      <Circle cx={startX * 100} cy={startY * 100} r={3.5} fill={color} />
      {line
        ? loop
          ? label(start, 'S·F')
          : [label(start, 'S'), label(finish, 'F')]
        : null}
    </Svg>
  );
}

// The plain day map's ground, under the card while the map or its points load.
const mapGround = '#F3F5F6';

// A course card on the real Naver map (S15P31E105-562, 담당자 요청: 썸네일의 색을 빼고 지도로): the course as the
// map's ribbon with small S · F poles, in `area` (fractions of the card's height, between the card's chips and its
// words), and a dark fade from `shadeFrom` down so the white words below stay readable over any map. It takes no
// touches, so the card keeps them. Until there are points (H01 records carry none, so `load` asks for them) the
// ground shows the outline drawn from `shape`.
export function CourseMapThumb({
  route,
  load,
  shape,
  km,
  area,
  shadeFrom,
}: {
  route?: LngLat[] | null;
  load?: () => Promise<LngLat[] | null>;
  shape: [number, number][];
  km?: number;
  area: RunMapArea;
  shadeFrom: number;
}) {
  const given = route && route.length >= 2 ? route : null;
  const [loaded, setLoaded] = useState<LngLat[] | null>(null);
  const wants = !given && !!load;
  useEffect(() => {
    if (!wants || !load) {
      return;
    }
    let live = true;
    load()
      .then(points => {
        if (live) {
          setLoaded(points);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // load is rebuilt every render; the card asks once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants]);
  const points = given ?? (loaded && loaded.length >= 2 ? loaded : null);
  const shadeId = `mapShade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={styles.mapThumb}>
      {points ? (
        <RunMap
          route={points}
          compact
          interactive={false}
          rotatable={false}
          area={area}
          // The NAVER logo sits just over the dark fade, where it can be seen.
          logo={{ above: 1 - shadeFrom, side: 'right' }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          style={[
            styles.mapThumbGlyph,
            { top: `${area.top * 100}%`, bottom: `${(1 - area.bottom) * 100}%` },
          ]}
        >
          <CourseGlyph shape={shape} km={km} tone="ink" />
        </View>
      )}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={shadeFrom} stopColor="#060606" stopOpacity={0} />
            <Stop
              offset={Math.min(shadeFrom + 0.22, 1)}
              stopColor="#060606"
              stopOpacity={0.82}
            />
            <Stop offset={1} stopColor="#060606" stopOpacity={0.94} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${shadeId})`} />
      </Svg>
    </View>
  );
}

// Android breaks Korean between any two letters, so a title too long for one line (about 8 letters on the
// 175 card) is split at the space nearest its middle, as in the mockup's APEC / 나루공원 루프.
export function splitTitle(title: string) {
  if (title.length <= 8) {
    return title;
  }
  const middle = title.length / 2;
  let best = -1;
  for (let at = title.indexOf(' '); at >= 0; at = title.indexOf(' ', at + 1)) {
    if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) {
      best = at;
    }
  }
  return best < 0 ? title : `${title.slice(0, best)}\n${title.slice(best + 1)}`;
}

// One saved course: the course on its small map, the title, distance and time, and 이 코스로 달리기. The whole card
// opens the course run; the mockup has no unsave control, so a small glass bookmark keeps that action.
function SavedCard({
  course,
  height,
  onOpen,
  onUnsave,
}: {
  course: SavedCourse;
  height: number;
  onOpen: () => void;
  onUnsave: () => void;
}) {
  const title = course.myAlias ?? course.name;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatKm(course.distanceM, 1)}km ${
        course.expectedMinutes
      }분`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { height },
        pressed && styles.pressed,
      ]}
    >
      {/* The course on the real map (S15P31E105-562) between the bookmark and the words, the fade under the
          words starting 140 above the foot. */}
      <CourseMapThumb
        route={course.route}
        shape={course.shape}
        km={course.distanceM / 1000}
        area={{ top: 44 / height, bottom: (height - 128) / height }}
        shadeFrom={(height - 150) / height}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 저장 해제`}
        hitSlop={8}
        onPress={onUnsave}
        style={styles.bookmark}
      >
        <Icon name="bookmark" color="#111111" size={13} solid />
      </Pressable>
      <View style={styles.text}>
        <AppText style={styles.cardTitle} numberOfLines={2}>
          {splitTitle(title)}
        </AppText>
        <AppText style={styles.meta}>
          {`${formatKm(course.distanceM, 1)} km · ${course.expectedMinutes}분`}
        </AppText>
      </View>
      <View style={styles.run}>
        <AppText style={styles.runText}>이 코스로 달리기</AppText>
      </View>
    </Pressable>
  );
}

// 3.1c 저장한 코스: my bookmarked courses, titled with my own nickname. runway-course-handoff: the glass
// tabs in the same place as 3.1, then two columns of three cards that fill the screen.
export function SavedCoursesScreen() {
  const navigation = useNavigation();
  const { courses } = useRepositories();
  const toast = useToast();
  const resource = useResource(useCallback(loadSaved, []));
  const [area, setArea] = useState(0);
  // Three rows fit the screen: 15 under the tabs and at the bottom, 10 between.
  const cardHeight = area ? Math.max(200, (area - 15 * 2 - 10 * 2) / 3) : 245;
  const [items, setItems] = useState<SavedCourse[] | null>(null);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data);
    }
  }, [resource.status, resource.data]);

  const open = async (course: SavedCourse) => {
    // SYS-002: MERGED·BLOCKED are kept on the list for status guidance, not started as a normal run.
    if (course.status === 'BLOCKED') {
      toast('이 코스는 사용할 수 없어요. 다른 코스를 골라 주세요');
      return;
    }
    if (course.status === 'MERGED') {
      toast(
        course.mergedIntoCourseId
          ? '이 코스는 다른 코스로 합쳐졌어요. 대표 코스를 다시 골라 주세요'
          : '이 코스는 다른 코스로 합쳐졌어요. 다른 코스를 골라 주세요',
      );
      return;
    }
    await courses.choose(course.id);
    navigateTo(navigation, 'CourseRun');
  };
  const unsave = async (course: SavedCourse) => {
    const before = items ?? [];
    setItems(before.filter(item => item.id !== course.id));
    try {
      await courses.unsave(course.id);
    } catch {
      // The server kept the course, so it goes back on the list.
      setItems(before);
      toast('저장을 해제하지 못했어요. 잠시 후 다시 시도해 주세요');
      return;
    }
    toast('저장을 해제했어요', {
      actionLabel: '되돌리기',
      onAction: async () => {
        await courses.save(course.id);
        setItems(before);
      },
    });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <CourseTabs current="SavedCourses" />
      <ScrollView
        contentContainerStyle={styles.content}
        onLayout={event => setArea(event.nativeEvent.layout.height)}
      >
        {resource.status === 'loading' ? (
          <ActivityIndicator />
        ) : resource.status === 'error' ? (
          <View style={styles.error}>
            <AppText tone="danger">저장한 코스를 불러오지 못했어요</AppText>
            <Button
              title="다시 시도"
              variant="secondary"
              size="small"
              onPress={resource.reload}
            />
          </View>
        ) : items?.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title="저장한 코스가 없어요"
            description="추천 코스에서 북마크를 누르면 여기에 모여요."
            actionLabel="코스 추천 받기"
            onAction={() => navigateTo(navigation, 'TodayRun')}
          />
        ) : (
          <View style={styles.grid}>
            {items?.map(course => (
              <SavedCard
                key={course.id}
                course={course}
                height={cardHeight}
                onOpen={() => open(course)}
                onUnsave={() => unsave(course)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 15, paddingVertical: 15, gap: spacing.xl },
  pressed: { opacity: 0.85 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two per row (175 wide on a 390 screen), corners of 22.
  card: {
    width: '48.6%',
    borderRadius: 22,
    overflow: 'hidden',
    boxShadow: '0 14px 30px rgba(2,5,14,0.22)',
  },
  mapThumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: mapGround,
  },
  mapThumbGlyph: { position: 'absolute', left: '20%', right: '20%' },
  bookmark: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The title and figures sit on the black lower part, 14 above the button.
  text: { position: 'absolute', left: 12, right: 10, bottom: 60, gap: 4 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  meta: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.42)',
  },
  run: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#EEEEEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#111111',
  },
  error: { alignItems: 'center', gap: spacing.md },
});
