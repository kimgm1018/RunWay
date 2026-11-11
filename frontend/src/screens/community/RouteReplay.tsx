import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  Share,
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
  NaverMapPathOverlay,
  NaverMapView,
} from '@mj-studio/react-native-naver-map';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import { darkMapLook } from '../../components/mapRoute';
import type { Post } from '../../data';
import {
  bearingOf,
  distanceM as legLengthM,
  routeLengthM,
  type LngLat,
} from '../../geo';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { feedLook, MapBackdrop } from './FeedPage';
import { Avatar, recordLabel, stamp } from './parts';

// 코스 재생 (S15P31E105-561, 담당자 레퍼런스): from 7.2 the run plays back on a close-up map that follows the runner
// from the start, the path drawn behind them, with the distance counting up and the pace, time and steps under it.
// A tap pauses and resumes; at the end a tap plays it again.

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
// How many times faster than the run the playback goes, shown as ×N 배속 so the speed-up is plain.
export function replaySpeedup(durationSec: number, playMs: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || playMs <= 0) {
    return null;
  }
  return Math.max(1, Math.round((durationSec * 1000) / playMs));
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
  post,
  visible,
  onClose,
}: {
  post: Post;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const canvas = { width: width * zoom, height: height * zoom };
  const route = useMemo(
    () => lay(post.record.shape, canvas.width, canvas.height),
    [post.record.shape, canvas.width, canvas.height],
  );
  const playMs = replayPlayMs(post.record.distanceM);
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const at = useRef(0);
  // Two clocks over the same playback: the camera moves on the native thread, so the map glides at full frame
  // rate; the drawn path and the numbers follow the JS one (담당자 요청: 레퍼런스처럼 매끄럽게).
  const camera = useRef(new Animated.Value(0)).current;
  const draw = useRef(new Animated.Value(0)).current;
  const run = useRef<Animated.CompositeAnimation | null>(null);

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
      run.current = Animated.parallel([
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
      run.current.start(({ finished }) => {
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
      run.current?.stop();
      return;
    }
    openedAt.current = Date.now();
    setShown(0);
    start(0);
    return () => run.current?.stop();
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
      run.current?.stop();
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
          done ? '코스 다시 재생' : playing ? '재생 일시정지' : '재생 계속'
        }
        onPress={toggle}
        style={styles.root}
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
            seed={post.id}
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
            {/* The run glows as it is drawn: a soft wide halo, a pale edge, then the mint core. */}
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={darkMapLook.ink}
              strokeOpacity={0.18}
              strokeWidth={26}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={darkMapLook.ribbon}
              strokeWidth={13}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={darkMapLook.ink}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        </Animated.View>

        <ReplayChrome
          post={post}
          shown={shown}
          playing={playing}
          done={done}
          onClose={onClose}
          speedup={replaySpeedup(post.record.durationSec, playMs)}
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
// The overview holds this long once the map is ready, so its tiles draw and it is seen before the swoop.
const holdMs = 1500;
// A map that never says it is ready still starts after this long.
const readyLimitMs = 4000;
// A restart swoops back in from the closing overview after this short pause.
const againMs = 300;
// At the end the camera waits a beat on the finish, then pulls back to the whole course.
const outroDelayMs = 600;
const outroMs = 2400;
const tickMs = 100;
// How far ahead (share of the run) the camera looks to choose its heading, and how quickly it turns to it: a
// gentle rate, so corners turn the map over several ticks instead of snapping.
const lookAhead = 0.025;
const turnRate = 0.22;

// The camera that fits the whole course in the part of the screen above the numbers (the camera's middle sits at
// `markerAt` of the height, see mapPadding).
function overviewOf(route: LngLat[], width: number, height: number) {
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
    fit(height * 2 * markerAt * 0.62, spanY),
    16,
  );
  return { latitude, longitude, zoom: fitted, ...flat };
}

// Each leg's length and the whole length, measured once per route (S15P31E105-686): the playback asks for a
// point and two headings ten times a second, and measuring every leg again each time slowed long runs.
const measured = new WeakMap<LngLat[], { legs: number[]; total: number }>();
function measure(route: LngLat[]) {
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
export function pointAt(route: LngLat[], progress: number): LngLat {
  const { legs, total } = measure(route);
  let left = total * Math.min(1, Math.max(0, progress));
  if (route.length < 2 || left <= 0) {
    return route[0];
  }
  for (let index = 1; index < route.length; index += 1) {
    const [from, to] = [route[index - 1], route[index]];
    const length = legs[index - 1];
    if (left <= length) {
      const t = length === 0 ? 0 : left / length;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    left -= length;
  }
  return route[route.length - 1];
}

// The heading `progress` of the way along, looking a little ahead (back from the end).
function headingAt(route: LngLat[], progress: number) {
  const from = pointAt(route, Math.min(progress, 1 - lookAhead));
  const to = pointAt(route, Math.min(1, progress + lookAhead));
  return bearingOf(from, to);
}

// Turns `current` part of the way to `target` the short way round.
function turnToward(current: number, target: number, rate: number) {
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta * rate;
}

function MapReplay({
  post,
  route,
  visible,
  onClose,
}: {
  post: Post;
  route: LngLat[];
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const playMs = replayPlayMs(post.record.distanceM);
  const coords = useMemo(
    () => route.map(([longitude, latitude]) => ({ latitude, longitude })),
    [route],
  );
  const size = useRef({ width, height });
  size.current = { width, height };
  const [camera, setCamera] = useState(() => overviewOf(route, width, height));
  const [motion, setMotion] = useState<{
    duration: number;
    easing: 'EaseOut' | 'Linear';
  }>({ duration: 0, easing: 'Linear' });
  const [shown, setShown] = useState(0);
  const [intro, setIntro] = useState(true);
  const [ready, setReady] = useState(false);
  // The whole course shows faintly over the overview, until the swoop.
  const [outline, setOutline] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  // Each play from the start: 0 on opening, one more on every restart, so the swoop runs again.
  const [round, setRound] = useState(0);
  const at = useRef(0);
  const heading = useRef(0);
  const openedAt = useRef(0);
  // The post reloads under the replay (a new array each time); the timeline keys on opening, not on that.
  const path = useRef(route);
  path.current = route;

  // Every opening: the overview at once, then the swoop in to the start, turned to the way ahead.
  useEffect(() => {
    if (!visible) {
      return;
    }
    openedAt.current = Date.now();
    at.current = 0;
    heading.current = headingAt(path.current, 0);
    setShown(0);
    setDone(false);
    setPlaying(false);
    setIntro(true);
    setOutline(true);
    setRound(0);
    setMotion({ duration: 0, easing: 'Linear' });
    setCamera(
      overviewOf(path.current, size.current.width, size.current.height),
    );
    // The map is made anew on every opening and its tiles stay blank until it is ready; the swoop waits for
    // that (or for the limit) so it is not spent over an empty map.
    const limit = setTimeout(() => setReady(true), readyLimitMs);
    return () => {
      clearTimeout(limit);
      setReady(false);
    };
  }, [visible]);

  // The swoop: from the overview down to the start, leaning back and turning to the way ahead, then the run.
  useEffect(() => {
    if (!visible || !ready) {
      return;
    }
    const [first] = path.current;
    // The first play holds on the overview so it is seen; a restart is already looking at it.
    const wait = round === 0 ? holdMs : againMs;
    const swoop = setTimeout(() => {
      setOutline(false);
      setMotion({ duration: introMs, easing: 'EaseOut' });
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
    }, wait + introMs);
    return () => {
      clearTimeout(swoop);
      clearTimeout(go);
    };
  }, [visible, ready, round]);

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
      at.current = progress;
      heading.current = turnToward(
        heading.current,
        headingAt(path.current, progress),
        turnRate,
      );
      const [longitude, latitude] = pointAt(path.current, progress);
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
  }, [visible, playing, playMs]);

  // The outro: a beat on the finish, then the camera rises, levels and turns north to the whole course, now drawn.
  useEffect(() => {
    if (!visible || !done) {
      return;
    }
    const outro = setTimeout(() => {
      setMotion({ duration: outroMs, easing: 'EaseOut' });
      setCamera(
        overviewOf(path.current, size.current.width, size.current.height),
      );
    }, outroDelayMs);
    return () => clearTimeout(outro);
  }, [visible, done]);

  const toggle = () => {
    if (intro || Date.now() - openedAt.current < 500) {
      return;
    }
    if (done) {
      // Again from the start: the course is wiped and the camera swoops back in from the overview.
      at.current = 0;
      heading.current = headingAt(route, 0);
      setShown(0);
      setDone(false);
      setIntro(true);
      setOutline(true);
      setRound(value => value + 1);
      return;
    }
    setPlaying(value => !value);
  };

  // Every replay line draws only the part already run: the rest is fully transparent (a part-see-through colour
  // drew solid black on Android), and all of them share `progress`.
  const reveal = { color: darkMapLook.unpassed, progress: shown };

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
            ? '코스 다시 재생'
            : playing || intro
            ? '재생 일시정지'
            : '재생 계속'
        }
        onPress={toggle}
        style={styles.root}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <NaverMapView
            style={StyleSheet.absoluteFill}
            camera={camera}
            // The plain Naver map, like every tilted map (S15P31E105-521): its buildings stand up, K1's stay
            // flat. With no custom style to load, the map is ready once made.
            onInitialized={() => setReady(true)}
            animationDuration={motion.duration}
            animationEasing={motion.easing}
            mapType="Basic"
            lightness={darkMapLook.lightness}
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
            // The camera's middle sits where the runner's pin is, above the numbers.
            mapPadding={{ bottom: height * (1 - 2 * markerAt) }}
            // The NAVER logo stays shown, by the SDK's own placement: top left under the title, where the map is
            // still bright, instead of the foot where the dark band and the numbers cover it.
            logoAlign="TopLeft"
            logoMargin={{ left: 18, top: insets.top + 86 }}
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
                {outline ? (
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
                <NaverMapPathOverlay
                  coords={coords}
                  width={darkMapLook.glowOuterWidth}
                  {...reveal}
                  passedColor={darkMapLook.glowOuter}
                  outlineWidth={0}
                  zIndex={1}
                />
                <NaverMapPathOverlay
                  coords={coords}
                  width={darkMapLook.glowInnerWidth}
                  {...reveal}
                  passedColor={darkMapLook.glowInner}
                  outlineWidth={0}
                  zIndex={2}
                />
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
              </>
            ) : null}
          </NaverMapView>
        </View>
        <ReplayChrome
          post={post}
          shown={shown}
          playing={playing || intro}
          done={done}
          onClose={onClose}
          accent={darkMapLook.ink}
          speedup={replaySpeedup(post.record.durationSec, playMs)}
        />
      </Pressable>
    </Modal>
  );
}

// 코스 재생: on the real map when the post brings its course's points, on the drawn map otherwise.
export function RouteReplay(props: {
  post: Post;
  visible: boolean;
  onClose: () => void;
}) {
  const route = props.post.record.route;
  return route && route.length >= 2 ? (
    <MapReplay {...props} route={route} />
  ) : (
    <ShapeReplay {...props} />
  );
}

// The runner's pulse: one ring this wide, spreading every this long.
const pulseSize = 28;
const pulseMs = 1400;

// What both replays draw over their map: the dark bands, the runner's pin, the title with 공유 · 닫기, and at the
// foot the average pace big with the distance, time and steps counting up (담당자 요청: 페이스가 주).
// The playback re-renders this many times a second, so only the counters follow `shown`: the bands, the pin and
// the title are kept apart and drawn again only when what they show changes (S15P31E105-686).
function ReplayChrome({
  post,
  shown,
  playing,
  done,
  onClose,
  accent = darkMapLook.ink,
  speedup = null,
}: {
  post: Post;
  shown: number;
  playing: boolean;
  done: boolean;
  onClose: () => void;
  // The path's colour, for the dot under the pin.
  accent?: string;
  // How many times faster than the run this plays (×N 배속); null when the run's time is unknown.
  speedup?: number | null;
}) {
  const insets = useSafeAreaInsets();
  const percent = Math.round(Math.min(1, Math.max(0, shown)) * 100);
  const record = post.record;
  const km = ((record.distanceM * shown) / 1000).toFixed(2);
  const seconds = record.durationSec * shown;
  const strides =
    record.cadence === null
      ? null
      : Math.round((record.cadence * seconds) / 60);
  return (
    <>
      <ReplayBands />
      <ReplayPin
        nickname={post.author.nickname}
        userId={post.author.userId}
        photo={post.author.profileImageUrl}
        mine={post.isMine}
        playing={playing}
        accent={accent}
      />
      <ReplayHeader post={post} onClose={onClose} />

      <View
        style={[styles.foot, { paddingBottom: insets.bottom + 24 }]}
        pointerEvents="none"
      >
        {/* 페이스가 주인공 (담당자 요청): the run's average pace big, the distance counting up beside time and steps. */}
        <AppText style={styles.pace}>
          {formatPace(record.averagePaceSecPerKm)}
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
        {/* How far through the replay, and honestly how sped up it is. */}
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
          {speedup ? (
            <AppText style={styles.speed}>{`×${speedup} 배속`}</AppText>
          ) : null}
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
  nickname: Post['author']['nickname'];
  userId: Post['author']['userId'];
  photo: Post['author']['profileImageUrl'];
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

// The title with 공유 · 닫기.
const ReplayHeader = memo(function Header({
  post,
  onClose,
}: {
  post: Post;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const record = post.record;
  const share = () =>
    Share.share({
      message: `${post.author.handle}님의 러닝 · ${recordLabel(
        record,
        post.courseShared,
      )} · 평균 페이스 ${formatPace(record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);
  return (
    <View
      style={[styles.header, { top: insets.top + 10 }]}
      pointerEvents="box-none"
    >
      <View style={styles.headerText} pointerEvents="none">
        <AppText style={styles.title} numberOfLines={1}>
          {recordLabel(record, post.courseShared)}
        </AppText>
        <AppText style={styles.byline} numberOfLines={1}>
          {post.author.handle}
        </AppText>
        <AppText style={styles.date} numberOfLines={1}>
          {stamp(record.startedAt)}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유"
        onPress={share}
        hitSlop={6}
        style={({ pressed }) => [styles.round, pressed && styles.pressed]}
      >
        <Icon name="share" color={feedLook.white} size={18} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="코스 재생 닫기"
        onPress={onClose}
        hitSlop={6}
        style={({ pressed }) => [styles.round, pressed && styles.pressed]}
      >
        <Icon name="close" color={feedLook.white} size={18} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: feedLook.ground },
  pressed: { opacity: 0.6 },
  canvas: { position: 'absolute', left: 0, top: 0 },
  pin: { position: 'absolute', width: 52, alignItems: 'center' },
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
  speed: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.sub,
  },
  hint: {
    marginTop: 14,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: feedLook.sub,
  },
});
