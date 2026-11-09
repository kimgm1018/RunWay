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
import type { Post } from '../../data';
import { bearingOf, routeLengthM, walkAlong, type LngLat } from '../../geo';
import { formatPace } from '../../format';
import { fontFamily } from '../../theme';
import { feedLook, MapBackdrop } from './FeedPage';
import { Avatar, recordLabel, stamp } from './parts';

// 코스 재생 (S15P31E105-561, 담당자 레퍼런스): from 7.2 the run plays back on a close-up map that follows the runner
// from the start, the path drawn behind them, with the distance counting up and the pace, time and steps under it.
// A tap pauses and resumes; at the end a tap plays it again.

// The whole route spans this many screens, so the camera has somewhere to follow.
const zoom = 3;
// One playback takes this long, whatever the run's length.
const playMs = 9000;
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
    [camera, draw],
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
  // of the route, at its share of the distance.
  const steps = route.lengths
    .map((length, index) => ({
      at: length / route.total,
      point: route.points[index],
    }))
    .filter((item, index, all) => index === 0 || item.at > all[index - 1].at);
  const follow =
    steps.length > 1
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
  const dashOffset = draw.interpolate({
    inputRange: [0, 1],
    outputRange: [route.total, 0],
  });
  const line = route.points.map(([px, py]) => `${px},${py}`).join(' ');
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
              fill={feedLook.route}
              stroke={feedLook.ground}
              strokeWidth={3}
            />
            {/* The whole route, revealed from the start as the dash slides back. */}
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={feedLook.route}
              strokeOpacity={0.25}
              strokeWidth={22}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[route.total, route.total]}
              strokeDashoffset={dashOffset}
            />
            <AnimatedPolyline
              points={line}
              fill="none"
              stroke={feedLook.route}
              strokeWidth={9}
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
        />
      </Pressable>
    </Modal>
  );
}

// The real map's camera over the run (S15P31E105-561, 담당자 요청: 실제 지도): zoomed in, leaning back, turned so the
// way ahead points up.
const close = { zoom: 16.6, tilt: 50 };
// On the light real map the path is the deep navy (담당자 요청: 민트 말고 진한 네이비).
const replayNavy = '#02050E';
// The opening view: the whole course from above, flat and north up, before the camera swoops in to the start
// (레퍼런스 시작 부분).
const flat = { tilt: 0, bearing: 0 };
const introMs = 2200;
// The overview holds this long once the map is ready, so its tiles draw and it is seen before the swoop.
const holdMs = 1500;
// A map that never says it is ready still starts after this long.
const readyLimitMs = 4000;
const tickMs = 100;
// How far ahead (share of the run) the camera looks to choose its heading, and how quickly it turns to it.
const lookAhead = 0.025;
const turnRate = 0.3;

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

// The point `progress` (0–1) of the way along the route, by distance.
function pointAt(route: LngLat[], progress: number): LngLat {
  const total = routeLengthM(route);
  const path = walkAlong(route, total * Math.min(1, Math.max(0, progress)));
  return path[path.length - 1] ?? route[0];
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
  const coords = useMemo(
    () => route.map(([longitude, latitude]) => ({ latitude, longitude })),
    [route],
  );
  const size = useRef({ width, height });
  size.current = { width, height };
  const [camera, setCamera] = useState(() =>
    overviewOf(route, width, height),
  );
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
    const swoop = setTimeout(() => {
      setOutline(false);
      setMotion({ duration: introMs, easing: 'EaseOut' });
      setCamera({
        latitude: first[1],
        longitude: first[0],
        ...close,
        bearing: heading.current,
      });
    }, holdMs);
    const go = setTimeout(() => {
      setIntro(false);
      setPlaying(true);
    }, holdMs + introMs);
    return () => {
      clearTimeout(swoop);
      clearTimeout(go);
    };
  }, [visible, ready]);

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
  }, [visible, playing]);

  const toggle = () => {
    if (intro || Date.now() - openedAt.current < 500) {
      return;
    }
    if (done) {
      at.current = 0;
      heading.current = headingAt(route, 0);
      setShown(0);
      setDone(false);
      setPlaying(true);
      return;
    }
    setPlaying(value => !value);
  };

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
            // The camera's middle sits where the runner's pin is, above the numbers.
            mapPadding={{ bottom: height * (1 - 2 * markerAt) }}
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
            {/* The whole course, shown only up to the runner: the passed part in the route colour. */}
            <NaverMapPathOverlay
              coords={coords}
              width={14}
              color="rgba(0,0,0,0)"
              passedColor="rgba(2,5,14,0.22)"
              progress={shown}
            />
            {outline ? (
              // The whole course, thin and grey (an opaque colour: the map drew the see-through one solid black).
              <NaverMapPathOverlay
                coords={coords}
                width={4}
                color="#8C95A6"
                outlineWidth={0}
              />
            ) : null}
            <NaverMapPathOverlay
              coords={coords}
              width={6}
              color="rgba(0,0,0,0)"
              passedColor={replayNavy}
              progress={shown}
            />
          </NaverMapView>
        </View>
        <ReplayChrome
          post={post}
          shown={shown}
          playing={playing || intro}
          done={done}
          onClose={onClose}
          accent={replayNavy}
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

// What both replays draw over their map: the dark bands, the runner's pin, the title with 공유 · 닫기, and at the
// foot the average pace big with the distance, time and steps counting up (담당자 요청: 페이스가 주).
function ReplayChrome({
  post,
  shown,
  playing,
  done,
  onClose,
  accent = feedLook.route,
}: {
  post: Post;
  shown: number;
  playing: boolean;
  done: boolean;
  onClose: () => void;
  // The path's colour, for the dot under the pin.
  accent?: string;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const record = post.record;
  const km = ((record.distanceM * shown) / 1000).toFixed(2);
  const seconds = record.durationSec * shown;
  const strides =
    record.cadence === null
      ? null
      : Math.round((record.cadence * seconds) / 60);
  const share = () =>
    Share.share({
      message: `${post.author.handle}님의 러닝 · ${recordLabel(
        record,
        post.courseShared,
      )} · 평균 페이스 ${formatPace(record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);
  return (
    <>
      {/* Darker toward the foot, so the counters read over the map (레퍼런스). */}
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

      {/* The runner: their avatar in a pin over the end of the path. */}
      <View
        pointerEvents="none"
        style={[
          styles.pin,
          { left: width / 2 - 26, top: height * markerAt - 66 },
        ]}
      >
        <View style={styles.pinHead}>
          <Avatar
            nickname={post.author.nickname}
            userId={post.author.userId}
            mine={post.isMine}
            size={44}
          />
        </View>
        <View style={styles.pinTip} />
        <View style={[styles.pinDot, { backgroundColor: accent }]} />
      </View>

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
  hint: {
    marginTop: 22,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: feedLook.sub,
  },
});
