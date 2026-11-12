import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  type CourseBasemap,
  type CourseMapData,
  type Repositories,
  type SavedCourse,
} from '../../data';
import { RunMap } from '../../components/RunMap';
import { formatKm } from '../../format';
import { routeSections, shapeOfRoute, type LngLat } from '../../geo';
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
export function labelAt([x, y]: [number, number], ways: [number, number][]) {
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
  unmeasuredEdges = [],
}: {
  shape: [number, number][];
  // The course's length, for the km dots. Left out, none are drawn.
  km?: number;
  tone?: keyof typeof glyphInk;
  unmeasuredEdges?: number[];
}) {
  const route = drawableShape(shape);
  if (route.length === 0) {
    return null;
  }
  const color = glyphInk[tone];
  const points = route.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  const sections = routeSections(route, unmeasuredEdges);
  const toPoints = (line: LngLat[]) => line.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  const [startX, startY] = route[0];
  const line = route.length > 1;
  const end = route[route.length - 1];
  const loop = Math.hypot(end[0] - startX, end[1] - startY) <= sameSpot;
  const last = route.length - 1;
  // A loop's SF has the line leaving and coming back; S and F each have one side of it.
  const start = labelAt(
    route[0],
    loop
      ? [towards(route, 0, 1), towards(route, last, -1)]
      : [towards(route, 0, 1)],
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
      {line ? (unmeasuredEdges.length ? (
        <>
          {sections.measured.map((part, index) => (
            <Polyline key={`measured-${index}`} points={toPoints(part)} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {sections.connectors.map((part, index) => (
            <Polyline key={`gap-${index}`} points={toPoints(part)} fill="none" stroke="#8A979E" strokeWidth={1.8} strokeDasharray="3 2" />
          ))}
        </>
      ) : (
        <Polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      )) : null}
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

// The light map's ground under the plain outline (and under the map image while it loads).
const mapGround = '#F3F5F6';

// Where the outline sits on a card, as fractions of the card's height (0 top, 1 bottom).
export type CourseThumbArea = { top: number; bottom: number };

// The outline's 0–100 box on a card of this size: the square CourseGlyph's Svg fits in its band (20% in from each
// side, `area` from top to bottom, centred, as `meet` does), in dp.
export function glyphBox(width: number, height: number, area: CourseThumbArea) {
  const [left, bandWidth] = [width * 0.2, width * 0.6];
  const [top, bandHeight] = [
    height * area.top,
    height * (area.bottom - area.top),
  ];
  const side = Math.max(0, Math.min(bandWidth, bandHeight));
  return {
    x: left + (bandWidth - side) / 2,
    y: top + (bandHeight - side) / 2,
    scale: side / 100,
  };
}

// The C03 map image (S15P31E105-612): 600×900 (2:3 portrait), its course centred at (0.5, 0.30) of the image with
// the longer side about 0.42 of the image's width.
export const basemapImage = {
  aspect: 900 / 600,
  courseX: 0.5,
  courseY: 0.3,
  courseSpan: 0.42,
} as const;

// Where the map image goes on a card of this size, in dp: the image's course centre on the centre of the outline's
// square (glyphBox) and its course as wide as the outline's (0.8 of the square's side, 0.1–0.9). Where that would
// leave an edge of the card bare (a short band makes a small image), the image grows about the same centre until it
// covers the card, so the course is then drawn a little larger than the outline would be. The card cuts what runs
// past it.
export function basemapImageFrame(
  width: number,
  height: number,
  area: CourseThumbArea,
) {
  const box = glyphBox(width, height, area);
  const side = box.scale * 100;
  const [centreX, centreY] = [box.x + side / 2, box.y + side / 2];
  const { aspect, courseX, courseY, courseSpan } = basemapImage;
  const imageWidth = Math.max(
    (0.8 * side) / courseSpan,
    // The left and right edges.
    centreX / courseX,
    (width - centreX) / (1 - courseX),
    // The top and bottom edges.
    centreY / courseY / aspect,
    (height - centreY) / (1 - courseY) / aspect,
  );
  const imageHeight = imageWidth * aspect;
  return {
    left: centreX - imageWidth * courseX,
    top: centreY - imageHeight * courseY,
    width: imageWidth,
    height: imageHeight,
  };
}

// S15P31E105-715: a card with no server image (a private course made from a free run) or with grey connectors (the
// server's single-colour image cannot draw them) is drawn on a real compact RunMap. Native maps are heavy, so only a
// few cards on screen hold one at a time; the rest keep the outline, and a card gives its place back when it leaves.
const maxCardMaps = 3;
let cardMapsInUse = 0;
export function useCardMapSlot(wanted: boolean) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!wanted || cardMapsInUse >= maxCardMaps) {
      setHeld(false);
      return;
    }
    cardMapsInUse += 1;
    setHeld(true);
    return () => {
      cardMapsInUse -= 1;
    };
  }, [wanted]);
  return held;
}

// A course card's map (S15P31E105-612, replacing S15P31E105-562's Naver map). With a C03 basemap the card is the
// server's map image, which already has the course drawn on it, placed so its course sits where the outline would
// (basemapImageFrame), with © OpenStreetMap at the top right; no outline is drawn over it. Without a basemap, or when
// the image fails to load, the card is the plain outline (G안 CourseGlyph) in `area` (fractions of the card's height,
// between the card's chips and its words) on the light ground. A dark fade from `shadeFrom` down keeps the white
// words below readable. It takes no touches, so the card keeps them. Without points or a basemap (H01 records carry
// none) `load` is asked once for them, and the outline is drawn from `shape` meanwhile. The © OpenStreetMap label sits in
// the top left corner, clear of the controls at the top right and the words below.
export function CourseMapThumb({
  route,
  basemap,
  unmeasuredEdges,
  load,
  shape,
  km,
  area,
  shadeFrom,
}: {
  route?: LngLat[] | null;
  basemap?: CourseBasemap | null;
  unmeasuredEdges?: number[];
  load?: () => Promise<CourseMapData | null>;
  shape: [number, number][];
  km?: number;
  area: CourseThumbArea;
  shadeFrom: number;
}) {
  const given = route && route.length >= 2 ? route : null;
  const [loaded, setLoaded] = useState<CourseMapData | null>(null);
  const wants = !given && !basemap && !!load;
  useEffect(() => {
    if (!wants || !load) {
      return;
    }
    let live = true;
    load()
      .then(answer => {
        if (live) {
          setLoaded(answer);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // load is rebuilt every render; the card asks once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants]);
  const points =
    given ??
    (loaded && Array.isArray(loaded.route) && loaded.route.length >= 2
      ? loaded.route
      : null);
  const map = basemap ?? loaded?.basemap ?? null;
  // An image that failed is not asked again; the card keeps the outline (a new address tries again).
  const [failed, setFailed] = useState<string | null>(null);
  const image = map && failed !== map.imageUrl && !(unmeasuredEdges ?? loaded?.unmeasuredEdges)?.length
    ? map.imageUrl : null;
  // The outline stays until the image has loaded, so a slow image never leaves the card without its course.
  const [shown, setShown] = useState<string | null>(null);
  // The server thumbnail is a single-colour route; use the SVG until it supports grey connectors.
  const imageShown = !!image && shown === image && !(unmeasuredEdges ?? loaded?.unmeasuredEdges)?.length;
  const gaps = unmeasuredEdges ?? loaded?.unmeasuredEdges;
  // No usable server image: a real map under the course, while a slot is free (see useCardMapSlot).
  const mapWanted = !!points && !image;
  const mapHeld = useCardMapSlot(mapWanted);
  const [mapShown, setMapShown] = useState(false);
  const mapOn = mapHeld && !!points;
  const outline = useMemo(
    () => (points ? shapeOfRoute(points) : shape),
    [points, shape],
  );
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const frame = size ? basemapImageFrame(size.width, size.height, area) : null;
  const shadeId = `mapShade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View
      testID="course-thumb"
      pointerEvents="none"
      style={styles.mapThumb}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setSize(now =>
          now && now.width === width && now.height === height
            ? now
            : { width, height },
        );
      }}
    >
      {image && frame ? (
        // Placed once the card has a size; the outline shows until it has loaded.
        <Image
          testID="course-basemap"
          source={{ uri: image }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          onLoad={() => setShown(image)}
          onError={() => setFailed(image)}
          style={[styles.mapImage, frame]}
        />
      ) : null}
      {mapOn && points ? (
        <RunMap
          route={points}
          unmeasuredEdges={gaps}
          compact
          mintLine
          interactive={false}
          area={area}
          style={StyleSheet.absoluteFill}
          onShown={() => setMapShown(true)}
        />
      ) : null}
      {imageShown || (mapOn && mapShown) ? null : (
        <View
          style={[
            styles.mapThumbGlyph,
            {
              top: `${area.top * 100}%`,
              bottom: `${(1 - area.bottom) * 100}%`,
            },
          ]}
        >
          <CourseGlyph shape={outline} km={km} tone="ink" unmeasuredEdges={unmeasuredEdges ?? loaded?.unmeasuredEdges} />
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
      {imageShown ? (
        // ODbL: the map's data is OpenStreetMap contributors' (8 설정 > 데이터 라이선스 has the full notice).
        <View
          testID="course-basemap-attribution"
          style={styles.attribution}
        >
          <AppText
            style={styles.attributionText}
            accessibilityLabel="지도 데이터 © OpenStreetMap 기여자"
          >
            © OpenStreetMap
          </AppText>
        </View>
      ) : null}
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

// One saved course: the course on its small light map, the title, distance and time, and 이 코스로 달리기. The whole card
// opens the course run; the mockup has no unsave control, so a small glass bookmark keeps that action.
function SavedCard({
  course,
  height,
  width,
  onOpen,
  onUnsave,
}: {
  course: SavedCourse;
  height: number;
  // The grid's measured per-card width (S15P31E105-749): null until known, so the first paint falls
  // back to styles.card's percentage width rather than collapsing to 0.
  width: number | null;
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
        width != null && { width },
        pressed && styles.pressed,
      ]}
    >
      {/* The course on its map (S15P31E105-612) between the bookmark and the words, the fade under the words
          starting 150 above the foot; © OpenStreetMap sits left of the bookmark. */}
      <CourseMapThumb
        route={course.route}
        basemap={course.basemap}
        unmeasuredEdges={course.unmeasuredEdges}
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

// Opening a saved course, from 3.1c and from 7.4b (S15P31E105-682): it becomes the course run on 2.0C.
export function useOpenSavedCourse() {
  const navigation = useNavigation();
  const { courses } = useRepositories();
  const toast = useToast();
  return async (course: SavedCourse) => {
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
  // The grid's own measured width (S15P31E105-749): styles.card's fixed '48.6%' plus the grid's fixed
  // 10dp gap only adds up to two per row on wide-enough screens, so narrower phones wrapped to one
  // column. Two cards' width is computed from the real container width instead, same as cardHeight.
  const [gridWidth, setGridWidth] = useState(0);
  const cardWidth = gridWidth ? (gridWidth - 10) / 2 : null;
  const [items, setItems] = useState<SavedCourse[] | null>(null);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data);
    }
  }, [resource.status, resource.data]);

  const open = useOpenSavedCourse();
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
          <View
            style={styles.grid}
            onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
          >
            {items?.map(course => (
              <SavedCard
                key={course.id}
                course={course}
                height={cardHeight}
                width={cardWidth}
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
  // Two per row, corners of 22. '48.6%' is only the fallback before the grid's width is measured
  // (SavedCoursesScreen computes the real per-card width from it, S15P31E105-749); the gap's 10dp was
  // not accounted for here, so it alone broke to one column on narrower screens.
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
  mapImage: { position: 'absolute' },
  // A small white pill at the card's top right, level with the bookmark (S15P31E105-612).
  // As quiet as a map credit can be and still be read (사용자 요청): small grey words straight on the light map, no
  // badge behind them.
  attribution: {
    position: 'absolute',
    top: 14,
    left: 16,
  },
  attributionText: {
    fontSize: 7.5,
    lineHeight: 10,
    color: 'rgba(0,0,0,0.42)',
  },
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
