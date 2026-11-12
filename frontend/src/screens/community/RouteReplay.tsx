import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  NaverMapMarkerOverlay,
  NaverMapPathOverlay,
  NaverMapView,
} from '@mj-studio/react-native-naver-map';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import { darkMapLook, routeStrokeLayers } from '../../components/mapRoute';
import type { Post } from '../../data';
import {
  bearingOf,
  distanceM as legLengthM,
  routeLengthM,
  routeSections,
  type LngLat,
} from '../../geo';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { feedLook, MapBackdrop } from './FeedPage';
import { Avatar, recordLabel, stamp } from './parts';
import { useReplayShare } from './replayShare';
import { postShareUrl } from '../../navigation/shareLinks';

// 코스 재생 (S15P31E105-561, 담당자 레퍼런스): from 7.2 the run plays back on a close-up map that follows the runner
// from the start, the path drawn behind them, with the distance counting up and the pace, time and steps under it.
// A tap pauses and resumes; at the end a tap plays it again.

// What a replay plays (S15P31E105-690): a community post's run (7.2), or my own run from 4.5 러닝 결과 and the 5.1
// record card. Made once per post or record, so the playback does not restart as the screen re-renders.
export type ReplayRun = {
  // Seeds the drawn map when there are no real points.
  key: string;
  // 코스 재생 for a shared course, 경로 재생 for my measured run: the replay's buttons say which.
  kind: '코스' | '경로';
  title: string;
  byline: string;
  startedAt: string;
  shareMessage: string;
  // The link 공유 sends with the picture (S15P31E105-704): a post's page, or my run's link made on the server when
  // shared. null, or a failure, shares without one.
  link: (() => Promise<string | null>) | null;
  runner: {
    nickname: string;
    userId: string;
    photo: string | null;
    mine: boolean;
  };
  distanceM: number;
  durationSec: number;
  averagePaceSecPerKm: number | null;
  // Steps per minute, for the 걸음 count; null without a watch.
  cadence: number | null;
  // The run's shape in a 0–1 box, for the drawn map.
  shape: [number, number][];
  // The real points: a post's course as one line, or a measured run in parts that are never joined across their
  // breaks. null plays the shape on the drawn map.
  parts: LngLat[][] | null;
};

export function replayOfPost(post: Post): ReplayRun {
  const record = post.record;
  return {
    key: post.id,
    kind: '코스',
    title: recordLabel(record, post.courseShared),
    byline: post.author.handle,
    startedAt: record.startedAt,
    shareMessage: `${post.author.handle}님의 러닝 · ${recordLabel(
      record,
      post.courseShared,
    )} · 평균 페이스 ${formatPace(record.averagePaceSecPerKm)}/km`,
    link: () => Promise.resolve(postShareUrl(post.id)),
    runner: {
      nickname: post.author.nickname,
      userId: post.author.userId,
      photo: post.author.profileImageUrl ?? null,
      mine: post.isMine,
    },
    distanceM: record.distanceM,
    durationSec: record.durationSec,
    averagePaceSecPerKm: record.averagePaceSecPerKm,
    cadence: record.cadence,
    shape: record.shape,
    parts: record.route && record.route.length >= 2 ? [record.route] : null,
  };
}

// The whole route spans this many screens, so the camera has somewhere to follow.
const zoom = 3;
// One playback grows with the run (S15P31E105-672): 6 s plus 1 ms per metre, kept between 8 s and 15 s, so a
// short jog does not rush past and a long run does not drag.
const minPlayMs = 8000;
const maxPlayMs = 15000;
export function replayPlayMs(distanceM: number) {
  const metres = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  return Math.round(Math.min(maxPlayMs, Math.max(minPlayMs, 6000 + metres)));
}
// The runner stays at this height on the screen while the map moves under them.
const markerAt = 0.42;

type Point = [number, number];

// The route's points on the zoomed canvas and the distance to each along the path.
function lay(shape: [number, number][], width: number, height: number) {
  const box = Math.min(width, height) * 0.8;
  const left = (width - box) / 2;
  const top = (height - box) / 2;
  const points: Point[] = shape.map(([x, y]) => [
    left + x * box,
    top + y * box,
  ]);
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(bx - ax, by - ay));
  }
  return { points, lengths, total: lengths[lengths.length - 1] || 1 };
}

// 2m 15s, or 0m at the start (레퍼런스의 TIME).
function clock(seconds: number) {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

// The map does not change while the camera moves, so it draws once.
const StillMap = memo(MapBackdrop);
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// Without the route's real points: the run's shape on a drawn map.
function ShapeReplay({
  run,
  visible,
  onClose,
}: {
  run: ReplayRun;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const shot = useRef<View>(null);
  const { capturing, share } = useReplayShare(
    shot,
    run.shareMessage,
    run.link,
    visible,
  );
  const canvas = { width: width * zoom, height: height * zoom };
  const route = useMemo(
    () => lay(run.shape, canvas.width, canvas.height),
    [run.shape, canvas.width, canvas.height],
  );
  const playMs = replayPlayMs(run.distanceM);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const at = useRef(0);
  // Two clocks over the same playback: the camera moves on the native thread, so the map glides at full frame
  // rate; the drawn path and the numbers follow the JS one (담당자 요청: 레퍼런스처럼 매끄럽게).
  const camera = useRef(new Animated.Value(0)).current;
  const draw = useRef(new Animated.Value(0)).current;
  const motion = useRef<Animated.CompositeAnimation | null>(null);

  const start = useCallback(
    (from: number) => {
      const duration = Math.max(1, (1 - from) * playMs);
      // Both clocks restart from the same point: the camera's value lives on the native side while it runs, so
      // without this it would start again from where JS last saw it and drift away from the drawn path.
      camera.setValue(from);
      draw.setValue(from);
      at.current = from;
      setPlaying(true);
      setDone(false);
      motion.current = Animated.parallel([
        Animated.timing(camera, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(draw, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      ]);
      motion.current.start(({ finished }) => {
        if (finished) {
          at.current = 1;
          setShown(1);
          setPlaying(false);
          setDone(true);
        }
      });
    },
    [camera, draw, playMs],
  );

  // The numbers read the path's clock a few times a second; the motion itself never waits for React.
  useEffect(() => {
    let last = 0;
    const id = draw.addListener(({ value }) => {
      at.current = value;
      if (Math.abs(value - last) >= 0.004 || value >= 1) {
        last = value;
        setShown(value);
      }
    });
    return () => draw.removeListener(id);
  }, [draw]);

  // Every opening plays from the start; closing stops it.
  useEffect(() => {
    if (!visible) {
      motion.current?.stop();
      return;
    }
    openedAt.current = Date.now();
    setShown(0);
    start(0);
    return () => motion.current?.stop();
  }, [visible, camera, draw, start]);

  // When it opened: the finger that pressed 코스 재생 lifts over this screen, and that is not a tap on it.
  const openedAt = useRef(0);
  const toggle = () => {
    if (Date.now() - openedAt.current < 500) {
      return;
    }
    if (done) {
      setShown(0);
      start(0);
      return;
    }
    if (playing) {
      motion.current?.stop();
      // Holds the map exactly where the path stopped.
      camera.setValue(at.current);
      setPlaying(false);
      setShown(at.current);
      return;
    }
    start(at.current);
  };

  // The camera keeps the runner's point at the middle of the screen, a little above centre: one step per point
  // of the route, at its share of the distance. Made once per route and screen size (S15P31E105-686): the
  // numbers re-render this screen many times a second, and new interpolations each time re-wired the native
  // camera and redrew the path.
  const follow = useMemo(() => {
    const steps = route.lengths
      .map((length, index) => ({
        at: length / route.total,
        point: route.points[index],
      }))
      .filter((item, index, all) => index === 0 || item.at > all[index - 1].at);
    return steps.length > 1
      ? {
          x: camera.interpolate({
            inputRange: steps.map(item => item.at),
            outputRange: steps.map(item => width / 2 - item.point[0]),
          }),
          y: camera.interpolate({
            inputRange: steps.map(item => item.at),
            outputRange: steps.map(item => height * markerAt - item.point[1]),
          }),
        }
      : { x: 0, y: 0 };
  }, [route, camera, width, height]);
  const dashOffset = useMemo(
    () =>
      draw.interpolate({
        inputRange: [0, 1],
        outputRange: [route.total, 0],
      }),
    [draw, route.total],
  );
  const line = useMemo(
    () => route.points.map(([px, py]) => `${px},${py}`).join(' '),
    [route.points],
  );
  const [startX, startY] = route.points[0] ?? [0, 0];

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          done
            ? `${run.kind} 다시 재생`
            : playing
            ? '재생 일시정지'
            : '재생 계속'
        }
        onPress={toggle}
        style={styles.root}
        ref={shot}
        collapsable={false}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.canvas,
            {
              width: canvas.width,
              height: canvas.height,
              transform: [{ translateX: follow.x }, { translateY: follow.y }],
            },
          ]}
        >
          <StillMap
            seed={run.key}
            width={canvas.width}
            height={canvas.height}
            scale={1.6}
          />
          <Svg
            width={canvas.width}
            height={canvas.height}
            style={StyleSheet.absoluteFill}
          >
            <Circle
              cx={startX}
              cy={startY}
              r={9}
              fill={darkMapLook.ink}
              stroke={darkMapLook.ribbon}
              strokeWidth={3}
            />
            {/* The same opaque outer and inner outlines as the native community route. */}
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={routeStrokeLayers[0].color}
              strokeWidth={routeStrokeLayers[0].width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={routeStrokeLayers[1].color}
              strokeWidth={routeStrokeLayers[1].width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={darkMapLook.ribbon}
              strokeWidth={routeStrokeLayers[2].width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={darkMapLook.ink}
              strokeWidth={routeStrokeLayers[3].width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        </Animated.View>

        <ReplayChrome
          run={run}
          shown={shown}
          playing={playing}
          done={done}
          onClose={onClose}
          onShare={share}
          capturing={capturing}
        />
      </Pressable>
    </Modal>
  );
}

// The real map's camera over the run (S15P31E105-561, 담당자 요청: 실제 지도): zoomed in, leaning back, turned so the
// way ahead points up.
// Leaning back about 60° (S15P31E105-672) so the buildings stand up around the runner; the Naver map allows that
// tilt at this zoom.
const close = { zoom: 16.6, tilt: 60 };
// The opening view: the whole course from above, flat and north up, before the camera swoops in to the start
// (레퍼런스 시작 부분).
const flat = { tilt: 0, bearing: 0 };
const introMs = 2200;
// The run starts a beat after the swoop's own animation, so the camera has come to rest on the start first and
// the first step does not cut the swoop short (작업 요청자: 시작할 때 뚝 끊김).
const swoopSettleMs = 300;
// A camera move's length goes to the map this long before the move itself.
const motionLeadMs = 120;
// The overview holds this long once the map is ready, so its tiles draw and it is seen before the swoop.
const holdMs = 1500;
// The feed's page fades its map in first, so it holds the whole course a little longer.
const inlineHoldMs = 2000;
// A map that never says it is ready still starts after this long.
const readyLimitMs = 4000;
// S15P31E105-719: the intro waits until the map has drawn its first tiles (onMapLoaded), so it is not played over a
// blank map; a map that never says so still starts after this long.
const drawnLimitMs = 8000;
// A restart swoops back in from the closing overview after this short pause.
const againMs = 300;
// At the end the camera waits a beat on the finish, then pulls back to the whole course.
const outroDelayMs = 600;
// 공유: how long the map gets to draw the overview before its picture is taken.
const pictureSettleMs = 900;
const outroMs = 2400;
// Each playback step: the camera glides over it, so a shorter step keeps the pin and the line closer together.
const tickMs = 50;
// How far ahead (share of the run) the camera looks to choose its heading, and how quickly it turns to it: a
// gentle rate, so corners turn the map over several ticks instead of snapping.
const lookAhead = 0.025;
const turnRate = 0.22;

// The camera that fits the whole course in the part of the screen above the numbers (the camera's middle sits at
// `markerAt` of the height, see mapPadding).
// `share`: how much of the room above and below the camera's middle the course may fill. The feed keeps it
// between the author row and the run's words (작업 요청자), so it fills less there.
function overviewOf(
  route: LngLat[],
  width: number,
  height: number,
  share = 0.62,
) {
  const lngs = route.map(([lng]) => lng);
  const lats = route.map(([, lat]) => lat);
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const latitude = (south + north) / 2;
  const longitude = (west + east) / 2;
  const metresPerDegree = 111320;
  const spanX = Math.max(
    (east - west) * metresPerDegree * Math.cos((latitude * Math.PI) / 180),
    1,
  );
  const spanY = Math.max((north - south) * metresPerDegree, 1);
  // Metres per screen point at zoom 0 at this latitude: the Naver map's zoom is one level above the 256-point
  // web tiles (on the emulator the course came out twice too big without the halving).
  const base = (156543.03 / 2) * Math.cos((latitude * Math.PI) / 180);
  const fit = (points: number, metres: number) =>
    Math.log2((points * base) / metres);
  const fitted = Math.min(
    fit(width * 0.72, spanX),
    fit(height * 2 * markerAt * share, spanY),
    16,
  );
  return { latitude, longitude, zoom: fitted, ...flat };
}

// Each leg's length and the whole length, measured once per route (S15P31E105-686): the playback asks for a
// point and two headings ten times a second, and measuring every leg again each time slowed long runs.
const measured = new WeakMap<LngLat[], { legs: number[]; total: number }>();
const measuredWithGaps = new WeakMap<
  LngLat[],
  Map<string, { legs: number[]; total: number }>
>();
function measure(route: LngLat[], unmeasuredEdges: number[] = []) {
  if (unmeasuredEdges.length) {
    const key = unmeasuredEdges.join(',');
    const cached = measuredWithGaps.get(route)?.get(key);
    if (cached) return cached;
    const gaps = new Set(unmeasuredEdges);
    const legs = route
      .slice(1)
      .map((point, index) =>
        gaps.has(index) ? 0 : legLengthM(route[index], point),
      );
    const result = {
      legs,
      total: legs.reduce((sum, length) => sum + length, 0),
    };
    const routes = measuredWithGaps.get(route) ?? new Map();
    routes.set(key, result);
    measuredWithGaps.set(route, routes);
    return result;
  }
  let found = measured.get(route);
  if (!found) {
    const legs = route
      .slice(1)
      .map((point, index) => legLengthM(route[index], point));
    found = { legs, total: routeLengthM(route) };
    measured.set(route, found);
  }
  return found;
}

// The point `progress` (0–1) of the way along the route, by distance: the end of walkAlong's path, from the
// measured legs.
export function pointAt(
  route: LngLat[],
  progress: number,
  unmeasuredEdges: number[] = [],
): LngLat {
  const { legs, total } = measure(route, unmeasuredEdges);
  let left = total * Math.min(1, Math.max(0, progress));
  if (route.length < 2 || left <= 0) {
    return route[0];
  }
  for (let index = 1; index < route.length; index += 1) {
    const [from, to] = [route[index - 1], route[index]];
    const length = legs[index - 1];
    if (length > 0 && left <= length) {
      const t = length === 0 ? 0 : left / length;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    left -= length;
  }
  return route[route.length - 1];
}

// A run in parts as one line for the replay (S15P31E105-690): the parts joined in order, and the edges that join
// one part to the next as unmeasured edges, so the pin crosses a break at once and no line is drawn over it. Parts
// of fewer than two points are left out.
const noEdges: number[] = [];
export function lineOfParts(parts: LngLat[][]): {
  route: LngLat[];
  unmeasuredEdges: number[];
} {
  const kept = parts.filter(part => part.length >= 2);
  if (kept.length <= 1) {
    return { route: kept[0] ?? [], unmeasuredEdges: noEdges };
  }
  const unmeasuredEdges: number[] = [];
  let count = 0;
  kept.forEach((part, index) => {
    count += part.length;
    if (index < kept.length - 1) {
      unmeasuredEdges.push(count - 1);
    }
  });
  return { route: kept.flat(), unmeasuredEdges };
}

// The heading `progress` of the way along, looking a little ahead (back from the end).
function headingAt(
  route: LngLat[],
  progress: number,
  unmeasuredEdges: number[] = [],
) {
  const from = pointAt(
    route,
    Math.min(progress, 1 - lookAhead),
    unmeasuredEdges,
  );
  const to = pointAt(route, Math.min(1, progress + lookAhead), unmeasuredEdges);
  return bearingOf(from, to);
}

// Turns `current` part of the way to `target` the short way round.
function turnToward(current: number, target: number, rate: number) {
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta * rate;
}

function MapReplay({
  run,
  route,
  unmeasuredEdges,
  drawConnectors,
  visible,
  onClose,
  inline = false,
  hold = false,
  onShown,
}: {
  run: ReplayRun;
  route: LngLat[];
  unmeasuredEdges: number[];
  // 7.2 joins a course's unmeasured edges with a thin grey line (S15P31E105-552); my run's breaks stay empty
  // (S15P31E105-690).
  drawConnectors: boolean;
  visible: boolean;
  onClose: () => void;
  // 7.0 피드 (S15P31E105-721, 704에서 처리): the same playback drawn in the page itself, as the page's only map, under
  // the feed's own words — no window, no buttons or numbers, no taps.
  inline?: boolean;
  // The feed's pages around the one on screen: their map is made and holds the whole course, ready to play the
  // moment the page comes on screen, without loading again (작업 요청자: 다시 로딩).
  hold?: boolean;
  // Once, when the map has drawn its tiles, so the feed can lift its cover.
  onShown?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const shot = useRef<View>(null);
  const playMs = replayPlayMs(run.distanceM);
  const coords = useMemo(
    () => route.map(([longitude, latitude]) => ({ latitude, longitude })),
    [route],
  );
  const replaySections = useMemo(() => {
    if (!unmeasuredEdges.length) return null;
    const { measured: parts, connectors } = routeSections(
      route,
      unmeasuredEdges,
    );
    const total = measure(route, unmeasuredEdges).total;
    let start = 0;
    return {
      total,
      parts: parts.map(part => {
        const length = routeLengthM(part);
        const result = {
          part: part.map(([longitude, latitude]) => ({ latitude, longitude })),
          start,
          length,
        };
        start += length;
        return result;
      }),
      connectors: connectors.map(part =>
        part.map(([longitude, latitude]) => ({ latitude, longitude })),
      ),
    };
  }, [route, unmeasuredEdges]);
  const size = useRef({ width, height });
  size.current = { width, height };
  // The whole course keeps clear of the title above and the big pace (or the feed's author row and words) below,
  // so its start and finish pins are not covered (작업 요청자).
  const fitShare = 0.45;
  const [camera, setCamera] = useState(() =>
    overviewOf(route, width, height, fitShare),
  );
  const [motion, setMotion] = useState<{
    duration: number;
    easing: 'EaseOut' | 'Linear';
  }>({ duration: 0, easing: 'Linear' });
  const [shown, setShown] = useState(0);
  // Where the line ends while it plays: halfway along the step the camera is gliding over, so the runner's pin
  // and the end of the line stay together (작업 요청자); the line ahead of the step would lead the pin.
  const [trail, setTrail] = useState(0);
  const [intro, setIntro] = useState(true);
  // How much of the course the opening draws: all of it over the overview, none once the camera leans in, so the run
  // starts from a clear start (작업 요청자).
  const [whole, setWhole] = useState(1);
  const [ready, setReady] = useState(false);
  // Whether the map has drawn its tiles (S15P31E105-719): until then a loading cover stands over it (or, in the
  // feed, the page's own map) and the timeline does not start.
  const [mapDrawn, setMapDrawn] = useState(false);
  // The feed lifts its cover over the page once the map has drawn.
  const shownSaid = useRef(false);
  useEffect(() => {
    if (mapDrawn && !shownSaid.current) {
      shownSaid.current = true;
      onShown?.();
    }
  }, [mapDrawn, onShown]);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  // Each play from the start: 0 on opening, one more on every restart, so the swoop runs again.
  const [round, setRound] = useState(0);
  const at = useRef(0);
  const heading = useRef(0);
  const openedAt = useRef(0);
  // The post reloads under the replay (a new run each time); the timeline keys on opening, not on that.
  const path = useRef(route);
  path.current = route;
  const edges = useRef(unmeasuredEdges);
  edges.current = unmeasuredEdges;
  // Set while 공유 holds the finished overview for its picture: the opening swoop waits instead of moving in.
  const [still, setStill] = useState(false);
  // 공유's picture is the whole route on the overview (작업 요청자), wherever the replay was: playback stops at its
  // end, the camera goes straight to the overview, and the map gets a moment to draw it.
  const finishForPicture = useCallback(async () => {
    setStill(true);
    setIntro(false);
    setPlaying(false);
    at.current = 1;
    setShown(1);
    setDone(true);
    setMotion({ duration: 0, easing: 'Linear' });
    setCamera(
      overviewOf(
        path.current,
        size.current.width,
        size.current.height,
        fitShare,
      ),
    );
    await new Promise<void>(resolve => setTimeout(resolve, pictureSettleMs));
  }, [fitShare]);
  const { capturing, share } = useReplayShare(
    shot,
    run.shareMessage,
    run.link,
    visible,
    finishForPicture,
  );

  // Every opening: the overview at once, then the swoop in to the start, turned to the way ahead.
  useEffect(() => {
    if (!visible) {
      return;
    }
    openedAt.current = Date.now();
    at.current = 0;
    heading.current = headingAt(path.current, 0, edges.current);
    setShown(0);
    setDone(false);
    setPlaying(false);
    setIntro(true);
    setWhole(1);
    setRound(0);
    setStill(false);
    setMotion({ duration: 0, easing: 'Linear' });
    setCamera(
      overviewOf(
        path.current,
        size.current.width,
        size.current.height,
        fitShare,
      ),
    );
    // The map is made anew on every opening and its tiles stay blank until it is ready; the swoop waits for
    // that (or for the limit) so it is not spent over an empty map.
    const limit = setTimeout(() => setReady(true), readyLimitMs);
    // The overview stays still until its tiles are in (the map says so only once its camera rests), or the limit.
    const drawnLimit = setTimeout(() => setMapDrawn(true), drawnLimitMs);
    return () => {
      clearTimeout(limit);
      clearTimeout(drawnLimit);
      setReady(false);
      setMapDrawn(false);
    };
  }, [visible, fitShare]);

  // A feed page leaving the screen goes back to the whole course, ready to play again when it comes back.
  useEffect(() => {
    if (!hold) {
      return;
    }
    at.current = 0;
    heading.current = headingAt(path.current, 0, edges.current);
    setShown(0);
    setDone(false);
    setPlaying(false);
    setIntro(true);
    setWhole(1);
    setRound(0);
    setMotion({ duration: 0, easing: 'Linear' });
    setCamera(
      overviewOf(
        path.current,
        size.current.width,
        size.current.height,
        fitShare,
      ),
    );
  }, [hold, fitShare]);

  // The swoop: from the overview down to the start, leaning back and turning to the way ahead, then the run.
  useEffect(() => {
    if (!visible || !ready || !mapDrawn || still || hold) {
      return;
    }
    const [first] = path.current;
    // The first play holds on the overview so it is seen; a restart is already looking at it.
    const wait = round === 0 ? (inline ? inlineHoldMs : holdMs) : againMs;
    // The swoop's length is set first and the camera moves a step later (작업 요청자: 기울어진 화면으로 뚝 바뀜): set
    // together, the map took the new camera before the new length and jumped there at once.
    const lean = setTimeout(
      () => setMotion({ duration: introMs, easing: 'EaseOut' }),
      Math.max(0, wait - motionLeadMs),
    );
    const swoop = setTimeout(() => {
      // The course clears as the camera starts to lean in (작업 요청자: 선 없이 전환).
      setWhole(0);
      setCamera({
        latitude: first[1],
        longitude: first[0],
        ...close,
        bearing: heading.current,
      });
    }, wait);
    const go = setTimeout(() => {
      setIntro(false);
      setPlaying(true);
    }, wait + introMs + swoopSettleMs);
    return () => {
      clearTimeout(lean);
      clearTimeout(swoop);
      clearTimeout(go);
    };
  }, [visible, ready, mapDrawn, round, still, inline, hold]);

  // Playback: each tick moves the camera to the next point over the tick's length, so the moves join into one
  // glide; progress follows the clock, so a slow phone keeps the same pace.
  useEffect(() => {
    if (!visible || !playing) {
      return;
    }
    const from = at.current;
    const began = Date.now();
    setMotion({ duration: tickMs, easing: 'Linear' });
    const step = () => {
      const progress = Math.min(1, from + (Date.now() - began) / playMs);
      if (replaySections) {
        const partAt = (value: number) =>
          replaySections.parts.findIndex(
            part => value * replaySections.total <= part.start + part.length,
          );
        setMotion({
          duration: partAt(at.current) === partAt(progress) ? tickMs : 0,
          easing: 'Linear',
        });
      }
      setTrail((at.current + progress) / 2);
      at.current = progress;
      heading.current = turnToward(
        heading.current,
        headingAt(path.current, progress, unmeasuredEdges),
        turnRate,
      );
      const [longitude, latitude] = pointAt(
        path.current,
        progress,
        unmeasuredEdges,
      );
      setCamera({ latitude, longitude, ...close, bearing: heading.current });
      setShown(progress);
      if (progress >= 1) {
        setPlaying(false);
        setDone(true);
      }
    };
    step();
    const timer = setInterval(step, tickMs);
    return () => clearInterval(timer);
  }, [visible, playing, playMs, replaySections, unmeasuredEdges]);

  // The outro: a beat on the finish, then the camera rises, levels and turns north to the whole course, now drawn.
  useEffect(() => {
    if (!visible || !done) {
      return;
    }
    // Like the swoop: the length first, the camera a step later, so the pull back glides instead of cutting.
    const rise = setTimeout(
      () => setMotion({ duration: outroMs, easing: 'EaseOut' }),
      outroDelayMs - motionLeadMs,
    );
    const outro = setTimeout(() => {
      setCamera(
        overviewOf(
          path.current,
          size.current.width,
          size.current.height,
          fitShare,
        ),
      );
    }, outroDelayMs);
    return () => {
      clearTimeout(rise);
      clearTimeout(outro);
    };
  }, [visible, done, fitShare]);

  const toggle = () => {
    if (intro || Date.now() - openedAt.current < 500) {
      return;
    }
    if (done) {
      // Again from the start: the course is wiped and the camera swoops back in from the overview.
      at.current = 0;
      heading.current = headingAt(route, 0, unmeasuredEdges);
      setShown(0);
      setDone(false);
      setIntro(true);
      setWhole(1);
      setStill(false);
      setRound(value => value + 1);
      return;
    }
    setPlaying(value => !value);
  };

  // Every replay line draws only the part already run: the rest is fully transparent (a part-see-through colour
  // drew solid black on Android).
  // The opening overview shows the whole course drawn with the runner on its start (작업 요청자); it clears as the
  // camera leans in, and the line draws again as the runner moves.
  const drawn = intro ? whole : playing ? trail : shown;
  const reveal = { color: darkMapLook.unpassed, progress: drawn };
  // The runner stands on the map where they are while the camera moves over the course (작업 요청자): on the start
  // until the run, on the finish after it (so 공유's picture shows where the run ended); while it plays the camera
  // keeps them in the middle of the screen.
  const runnerOnMap = intro ? route[0] : done ? route[route.length - 1] : null;

  const mapLayer = (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <NaverMapView
        style={StyleSheet.absoluteFill}
        camera={camera}
        // The plain Naver map, like every tilted map (S15P31E105-521): its buildings stand up, K1's stay
        // flat. With no custom style to load, the map is ready once made.
        onInitialized={() => setReady(true)}
        // S15P31E105-719: the first tiles are in (the Naver map's load, patched in), so the intro can start.
        onMapLoaded={() => setMapDrawn(true)}
        animationDuration={motion.duration}
        animationEasing={motion.easing}
        mapType="Basic"
        layerGroups={{
          BUILDING: true,
          TRAFFIC: false,
          TRANSIT: false,
          BICYCLE: false,
          MOUNTAIN: false,
          CADASTRAL: false,
        }}
        buildingHeight={1}
        isLiteModeEnabled={false}
        // 공유 takes a picture of this screen (S15P31E105-704): a TextureView map is in it, a SurfaceView one
        // comes out black.
        isUseTextureViewAndroid
        // The camera's middle sits where the runner's pin is, above the numbers.
        mapPadding={{ bottom: height * (1 - 2 * markerAt) }}
        // The NAVER logo stays shown, by the SDK's own placement: top left under the title, where the map is
        // still bright, instead of the foot where the dark band and the numbers cover it.
        // In the feed the author row sits there, so the logo goes where the feed's own map puts it: just over
        // the run's words (feedMapArea's foot at 60% of the page), counted from above the map's bottom padding.
        logoAlign={inline ? 'BottomLeft' : 'TopLeft'}
        logoMargin={
          inline
            ? { left: 18, bottom: height * (2 * markerAt - 0.6) + 6 }
            : { left: 18, top: insets.top + 86 }
        }
        isScrollGesturesEnabled={false}
        isZoomGesturesEnabled={false}
        isTiltGesturesEnabled={false}
        isRotateGesturesEnabled={false}
        isShowLocationButton={false}
        isShowZoomControls={false}
        isShowScaleBar={false}
        isShowCompass={false}
        locale="ko"
      >
        {/* Overlays only once the native map is ready (S15P31E105-692): before that the Naver map adds them
            later, and removing them first (a feed switch) crashed in its getChildAt. */}
        {ready ? (
          <>
            {drawConnectors &&
              replaySections?.connectors.map((part, index) => (
                <NaverMapPathOverlay
                  key={`connector-${index}`}
                  coords={part}
                  width={3}
                  color="#8A979E"
                  outlineWidth={0}
                  zIndex={0}
                />
              ))}
            {intro && whole === 1 && !replaySections ? (
              // The whole course, thin and grey, over the opening overview; under the run's lines.
              <NaverMapPathOverlay
                coords={coords}
                width={3}
                color={darkMapLook.outline}
                outlineWidth={0}
                zIndex={0}
              />
            ) : null}
            {/* The run so far glows: a wide dark halo, a brighter narrower one, then the mint core. */}
            {!replaySections ? (
              <NaverMapPathOverlay
                coords={coords}
                width={darkMapLook.glowOuterWidth}
                {...reveal}
                passedColor={darkMapLook.glowOuter}
                outlineWidth={0}
                zIndex={1}
              />
            ) : null}
            {!replaySections ? (
              <NaverMapPathOverlay
                coords={coords}
                width={darkMapLook.glowInnerWidth}
                {...reveal}
                passedColor={darkMapLook.glowInner}
                outlineWidth={0}
                zIndex={2}
              />
            ) : null}
            {!replaySections ? (
              <NaverMapPathOverlay
                coords={coords}
                width={darkMapLook.coreWidth}
                {...reveal}
                passedColor={darkMapLook.ink}
                outlineColor={darkMapLook.unpassed}
                passedOutlineColor={darkMapLook.ribbon}
                outlineWidth={darkMapLook.coreEdge}
                zIndex={3}
              />
            ) : null}
            {replaySections?.parts.map((part, index) => {
              const progress =
                part.length > 0
                  ? Math.max(
                      0,
                      Math.min(
                        1,
                        (drawn * replaySections.total - part.start) /
                          part.length,
                      ),
                    )
                  : 0;
              return (
                <React.Fragment key={`measured-${index}`}>
                  {[0, 1].map(layer => (
                    <NaverMapPathOverlay
                      key={layer}
                      coords={part.part}
                      width={routeStrokeLayers[layer].width}
                      color={darkMapLook.unpassed}
                      passedColor={routeStrokeLayers[layer].color}
                      progress={progress}
                      outlineWidth={0}
                      zIndex={layer + 1}
                    />
                  ))}
                  <NaverMapPathOverlay
                    coords={part.part}
                    width={darkMapLook.coreWidth}
                    color={darkMapLook.unpassed}
                    progress={progress}
                    passedColor={darkMapLook.ink}
                    outlineColor={darkMapLook.unpassed}
                    passedOutlineColor={darkMapLook.ribbon}
                    outlineWidth={darkMapLook.coreEdge}
                    zIndex={3}
                  />
                </React.Fragment>
              );
            })}
            {runnerOnMap ? (
              <NaverMapMarkerOverlay
                latitude={runnerOnMap[1]}
                longitude={runnerOnMap[0]}
                width={52}
                height={76}
                // The dot under the pin stands on the point.
                anchor={{ x: 0.5, y: 66 / 76 }}
                zIndex={4}
              >
                <RunnerOnMap run={run} />
              </NaverMapMarkerOverlay>
            ) : null}
          </>
        ) : null}
      </NaverMapView>
    </View>
  );
  if (inline) {
    return visible ? (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {mapLayer}
        {runnerOnMap ? null : (
          <ReplayPin
            nickname={run.runner.nickname}
            userId={run.runner.userId}
            photo={run.runner.photo}
            mine={run.runner.mine}
            playing={playing}
            accent={darkMapLook.ink}
          />
        )}
      </View>
    ) : null;
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          done
            ? `${run.kind} 다시 재생`
            : playing || intro
            ? '재생 일시정지'
            : '재생 계속'
        }
        onPress={toggle}
        style={styles.root}
        ref={shot}
        collapsable={false}
      >
        {mapLayer}
        {mapDrawn ? null : (
          // Until the map has drawn, a quiet cover in the feed's ground with a spinner, instead of an empty map
          // with the intro already moving over it (S15P31E105-719).
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.loading]}
            testID="replay-map-loading"
          >
            <View style={[styles.loadingMark, { top: height * markerAt + 24 }]}>
              <ActivityIndicator color={feedLook.white} />
              <AppText style={styles.loadingText}>
                지도를 불러오는 중이에요
              </AppText>
            </View>
          </View>
        )}
        <ReplayChrome
          run={run}
          shown={shown}
          playing={playing || intro}
          done={done}
          onClose={onClose}
          onShare={share}
          capturing={capturing}
          accent={darkMapLook.ink}
          pin={!runnerOnMap}
        />
      </Pressable>
    </Modal>
  );
}

// 코스 재생 · 경로 재생: on the real map when the run brings its points, on the drawn map otherwise. 7.2 passes its
// post (and a derived course's unmeasured edges, S15P31E105-552); 4.5 and 5.1 pass my run in its parts
// (S15P31E105-690), played as one line whose breaks are unmeasured edges, never drawn.
export function RouteReplay({
  visible,
  onClose,
  ...source
}: { visible: boolean; onClose: () => void } & (
  | { post: Post; unmeasuredEdges?: number[] }
  | { run: ReplayRun }
)) {
  const post = 'post' in source ? source.post : null;
  const given = 'run' in source ? source.run : null;
  const postEdges = 'post' in source ? source.unmeasuredEdges : undefined;
  const run = useMemo(() => given ?? replayOfPost(post as Post), [given, post]);
  const line = useMemo(() => lineOfParts(run.parts ?? []), [run]);
  const edges = useMemo(
    () => (post ? postEdges ?? noEdges : line.unmeasuredEdges),
    [post, postEdges, line],
  );
  return line.route.length >= 2 ? (
    <MapReplay
      run={run}
      route={line.route}
      unmeasuredEdges={edges}
      drawConnectors={!!post}
      visible={visible}
      onClose={onClose}
    />
  ) : (
    <ShapeReplay run={run} visible={visible} onClose={onClose} />
  );
}

// 7.0 피드 (S15P31E105-721, 704에서 처리, 작업 요청자): the page on screen plays its course in place — the whole course
// for a moment, then the swoop and the run — without opening 7.2. `route` is the course the page read (the list
// carries no points); `playing` is false off screen, which takes the map away.
export function FeedRouteReplay({
  post,
  route,
  unmeasuredEdges,
  playing,
  onShown,
}: {
  post: Post;
  route: LngLat[];
  unmeasuredEdges: number[];
  // false for the pages around the one on screen: their map waits on the whole course.
  playing: boolean;
  onShown?: () => void;
}) {
  const run = useMemo(
    () => replayOfPost({ ...post, record: { ...post.record, route } }),
    [post, route],
  );
  return route.length >= 2 ? (
    <MapReplay
      run={run}
      route={route}
      unmeasuredEdges={unmeasuredEdges}
      drawConnectors
      visible
      hold={!playing}
      onClose={noop}
      onShown={onShown}
      inline
    />
  ) : null;
}
// A draft uses the feed's bright map, camera and profile pin before a post exists.
export function InlineRunReplay({
  run,
  onShown,
}: {
  run: ReplayRun;
  onShown?: () => void;
}) {
  const line = useMemo(() => lineOfParts(run.parts ?? []), [run.parts]);
  return line.route.length >= 2 ? (
    <MapReplay
      run={run}
      route={line.route}
      unmeasuredEdges={line.unmeasuredEdges}
      drawConnectors={false}
      visible
      onClose={noop}
      onShown={onShown}
      inline
    />
  ) : null;
}

const noop = () => undefined;

// The runner's pulse: one ring this wide, spreading every this long.
const pulseSize = 28;
const pulseMs = 1400;

// What both replays draw over their map: the dark bands, the runner's pin, the title with 공유 · 닫기, and at the
// foot the average pace big with the distance, time and steps counting up (담당자 요청: 페이스가 주).
// The playback re-renders this many times a second, so only the counters follow `shown`: the bands, the pin and
// the title are kept apart and drawn again only when what they show changes (S15P31E105-686).
function ReplayChrome({
  run,
  shown,
  playing,
  done,
  onClose,
  onShare,
  capturing,
  accent = darkMapLook.ink,
  pin = true,
}: {
  run: ReplayRun;
  shown: number;
  playing: boolean;
  done: boolean;
  onClose: () => void;
  onShare: () => void;
  // While the picture is taken: no buttons in it.
  capturing: boolean;
  // The path's colour, for the dot under the pin.
  accent?: string;
  // false while the runner stands on the map instead (the start before the run, the finish after it).
  pin?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const percent = Math.round(Math.min(1, Math.max(0, shown)) * 100);
  const km = ((run.distanceM * shown) / 1000).toFixed(2);
  const seconds = run.durationSec * shown;
  const strides =
    run.cadence === null ? null : Math.round((run.cadence * seconds) / 60);
  return (
    <>
      <ReplayBands />
      {pin ? (
        <ReplayPin
          nickname={run.runner.nickname}
          userId={run.runner.userId}
          photo={run.runner.photo}
          mine={run.runner.mine}
          playing={playing}
          accent={accent}
        />
      ) : null}
      <ReplayHeader
        title={run.title}
        byline={run.byline}
        startedAt={run.startedAt}
        closeLabel={`${run.kind} 재생 닫기`}
        onClose={onClose}
        onShare={onShare}
        hideActions={capturing}
      />

      <View
        style={[styles.foot, { paddingBottom: insets.bottom + 24 }]}
        pointerEvents="none"
      >
        {/* 페이스가 주인공 (담당자 요청): the run's average pace big, the distance counting up beside time and steps. */}
        <AppText style={styles.pace}>
          {run.averagePaceSecPerKm === null
            ? '– –'
            : formatPace(run.averagePaceSecPerKm)}
        </AppText>
        <AppText style={styles.paceUnit}>평균 페이스 (/KM)</AppText>
        <View style={styles.row}>
          <View style={styles.cell}>
            <AppText
              style={styles.cellValue}
              accessibilityLabel={`거리 ${km}km`}
            >
              {km}
            </AppText>
            <AppText style={styles.cellLabel}>거리 (KM)</AppText>
          </View>
          <View style={styles.cell}>
            <AppText style={styles.cellValue}>{clock(seconds)}</AppText>
            <AppText style={styles.cellLabel}>시간</AppText>
          </View>
          <View style={styles.cell}>
            <AppText style={styles.cellValue}>
              {strides === null ? '–' : String(strides)}
            </AppText>
            <AppText style={styles.cellLabel}>걸음</AppText>
          </View>
        </View>
        {/* How far through the replay. */}
        <View
          style={styles.progress}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`재생 진행 ${percent}%`}
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${percent}%` as `${number}%`,
                  backgroundColor: accent,
                },
              ]}
            />
          </View>
        </View>
        <AppText style={styles.hint}>
          {done
            ? '탭하면 다시 재생'
            : playing
            ? '탭하면 일시정지'
            : '일시정지됨 · 탭하면 계속'}
        </AppText>
      </View>
    </>
  );
}

// Darker toward the foot, so the counters read over the map (레퍼런스).
const ReplayBands = memo(function Bands() {
  const { width, height } = useWindowDimensions();
  return (
    <Svg
      pointerEvents="none"
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
    >
      <Defs>
        <LinearGradient id="replayTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000000" stopOpacity={0.6} />
          <Stop offset={1} stopColor="#000000" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="replayFoot" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000000" stopOpacity={0} />
          <Stop offset={1} stopColor="#000000" stopOpacity={0.92} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={180} fill="url(#replayTop)" />
      <Rect
        y={height * 0.55}
        width={width}
        height={height * 0.45}
        fill="url(#replayFoot)"
      />
    </Svg>
  );
});

// The runner: their avatar in a pin over the end of the path, and a soft ring that keeps spreading from under
// it while the run plays.
const ReplayPin = memo(function Pin({
  nickname,
  userId,
  photo,
  mine,
  playing,
  accent,
}: {
  nickname: string;
  userId: string;
  photo: string | null;
  mine: boolean;
  playing: boolean;
  accent: string;
}) {
  const { width, height } = useWindowDimensions();
  // The runner's dot pulses while the replay plays; the loop stops when it pauses, ends or closes.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) {
      pulse.setValue(0);
      return;
    }
    const beat = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: pulseMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    beat.start();
    return () => beat.stop();
  }, [playing, pulse]);
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pulse,
          {
            left: width / 2 - pulseSize / 2,
            top: height * markerAt - pulseSize / 2,
            backgroundColor: accent,
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [playing ? 0.55 : 0, 0],
            }),
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 2.4],
                }),
              },
            ],
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.pin,
          { left: width / 2 - 26, top: height * markerAt - 66 },
        ]}
      >
        <View style={styles.pinHead}>
          <Avatar
            nickname={nickname}
            userId={userId}
            photo={photo}
            mine={mine}
            size={44}
          />
        </View>
        <View style={styles.pinTip} />
        <View style={[styles.pinDot, { backgroundColor: accent }]} />
      </View>
    </>
  );
});

// The feed's runner standing on the map (on the start or the finish): the same pin as ReplayPin, drawn by the map.
function RunnerOnMap({ run }: { run: ReplayRun }) {
  return (
    <View style={styles.pinOnMap}>
      <View style={styles.pinHead}>
        <Avatar
          nickname={run.runner.nickname}
          userId={run.runner.userId}
          photo={run.runner.photo}
          mine={run.runner.mine}
          size={44}
        />
      </View>
      <View style={styles.pinTip} />
      <View style={[styles.pinDot, { backgroundColor: darkMapLook.ink }]} />
    </View>
  );
}

// The title with 공유 · 닫기.
const ReplayHeader = memo(function Header({
  title,
  byline,
  startedAt,
  closeLabel,
  onClose,
  onShare,
  hideActions,
}: {
  title: string;
  byline: string;
  startedAt: string;
  closeLabel: string;
  onClose: () => void;
  onShare: () => void;
  hideActions: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.header, { top: insets.top + 10 }]}
      pointerEvents="box-none"
    >
      <View style={styles.headerText} pointerEvents="none">
        <AppText style={styles.title} numberOfLines={1}>
          {title}
        </AppText>
        <AppText style={styles.byline} numberOfLines={1}>
          {byline}
        </AppText>
        <AppText style={styles.date} numberOfLines={1}>
          {stamp(startedAt)}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유"
        onPress={onShare}
        hitSlop={6}
        style={({ pressed }) => [
          styles.round,
          pressed && styles.pressed,
          hideActions && styles.hidden,
        ]}
      >
        <Icon name="share" color={feedLook.white} size={18} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        hitSlop={6}
        style={({ pressed }) => [
          styles.round,
          pressed && styles.pressed,
          hideActions && styles.hidden,
        ]}
      >
        <Icon name="close" color={feedLook.white} size={18} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: feedLook.ground },
  pressed: { opacity: 0.6 },
  hidden: { opacity: 0 },
  canvas: { position: 'absolute', left: 0, top: 0 },
  loading: { backgroundColor: feedLook.ground },
  loadingMark: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: feedLook.sub,
  },
  pin: { position: 'absolute', width: 52, alignItems: 'center' },
  pinOnMap: { width: 52, height: 76, alignItems: 'center' },
  pinHead: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 4,
    borderColor: feedLook.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: feedLook.white,
  },
  pinTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: feedLook.white,
  },
  pinDot: {
    marginTop: 2,
    width: 14,
    height: 8,
    borderRadius: 4,
    backgroundColor: feedLook.route,
    borderWidth: 1.5,
    borderColor: feedLook.white,
  },
  header: {
    position: 'absolute',
    left: 18,
    right: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerText: { flex: 1 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    color: feedLook.white,
  },
  byline: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: feedLook.sub,
  },
  date: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 1,
    color: feedLook.faint,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pace: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 72,
    lineHeight: 80,
    color: feedLook.white,
  },
  paceUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: feedLook.sub,
  },
  row: { marginTop: 18, flexDirection: 'row', alignSelf: 'stretch' },
  cell: { flex: 1, alignItems: 'center' },
  cellValue: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 26,
    lineHeight: 30,
    color: feedLook.white,
  },
  cellLabel: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 1,
    color: feedLook.sub,
  },
  pulse: {
    position: 'absolute',
    width: pulseSize,
    height: pulseSize,
    borderRadius: pulseSize / 2,
  },
  progress: {
    marginTop: 20,
    alignSelf: 'stretch',
    marginHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  fill: { height: 3, borderRadius: 1.5 },
  hint: {
    marginTop: 14,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: feedLook.sub,
  },
});
