import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import {
  NaverMapMarkerOverlay,
  NaverMapMultiPathOverlay,
  NaverMapPathOverlay,
  NaverMapPolylineOverlay,
  NaverMapView,
  NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import type { LngLat } from '../geo';
import { fontFamily, k1, palette } from '../theme';
import { coursePaceColors, paceColor, splitRoute } from './mapRoute';

// Kept out of components/index.ts: it loads the Naver Map native module, so screens import it directly.

export type RunMapRef = NaverMapViewRef;

// 6.6 · 6.6r: another member of the group run, a dot with their name beside it.
export type RunMapMember = { position: LngLat; label: string; color: string };

// Where on the map the things shown should sit, as fractions of the map's height (0 top, 1 bottom):
// the part left visible between the screen's chips and sheets. A lone point sits at `top`.
export type RunMapArea = { top: number; bottom: number };

type RunMapProps = {
  // A course or record as GeoJSON [longitude, latitude] points (코스 API route).
  route?: LngLat[];
  // 0–1 of the route already run, drawn faded (지도 확인).
  progress?: number;
  // One pace per km (sec/km). By day each km gets its own colour, fast black to slow steel blue (2.0).
  segmentPaces?: number[];
  // One label per km, set on the middle of that km (코스 러닝 구간 페이스 알약).
  paceLabels?: string[];
  // 4.2: the path run so far, with the runner at its end. The course stays under it as a guide.
  trail?: LngLat[];
  // A point the screen sets, not the GPS: the found place (자유 러닝, 2.0F) or the meeting place (6.4·6.9).
  position?: LngLat;
  // 6.6 · 6.6r: the other members.
  members?: RunMapMember[];
  // 6.4 취소된 그룹런: the course in grey.
  muted?: boolean;
  // 3.1·4.2·5.2·6.x after sunset use the dark map; by day the light one (DESIGN.md 2-6·2-7).
  dark?: boolean;
  // Shows the GPS location dot. Turn it on with location tracking, after the permission is granted.
  showLocation?: boolean;
  // A style from the NAVER Cloud Style Editor (ADR-0018: K1 day and night maps, S15P31E105-325). Until the
  // K1 styles exist, the dark map falls back to Naver's night navigation map.
  customStyleId?: string;
  area?: RunMapArea;
  // The points the camera fits instead of everything shown (6.6: me and the members, not the whole
  // course), zoomed in closer.
  fitTo?: LngLat[];
  // Off where the map only illustrates (5.2 in a scroll view, 6.4 under its fade): no pan or zoom.
  interactive?: boolean;
  // 6.9: a tap on the map picks that point.
  onTapMap?: (point: LngLat) => void;
  // 6.9: the centre of the visible part once the camera stops (after following my location).
  onCameraIdle?: (center: LngLat) => void;
  style?: StyleProp<ViewStyle>;
};

const toCoord = ([longitude, latitude]: LngLat) => ({ latitude, longitude });

// By day the course is a hollow line: the km colour outside a thin near-white core (runway-course-handoff).
const core = '#F9F9F9';
const ink = '#060606';
// After sunset it is a white line with a faint white halo; the part already run fades.
const halo = 'rgba(255, 255, 255, 0.18)';
const passed = 'rgba(232, 238, 244, 0.42)';
// Only roads and places: no subway lines, bike paths or buildings competing with the course.
const layerGroups = {
  BUILDING: false,
  TRAFFIC: false,
  TRANSIT: false,
  BICYCLE: false,
  MOUNTAIN: false,
  CADASTRAL: false,
};
// The GPS location is a white dot (18) in a 12% white circle (DESIGN.md 2-7 지도).
// The Android side reads isVisible as required, so it is always passed with these.
const locationLook = {
  image: require('../../assets/images/location-dot.png'),
  imageWidth: 18,
  imageHeight: 18,
  circleRadius: 28,
  circleColor: 'rgba(255, 255, 255, 0.12)',
};

// A member's dot and the height of its name tag.
const memberDot = 12;
const memberHeight = 20;

// Seoul City Hall, when the screen has nothing to show yet.
const fallback: LngLat = [126.9784, 37.5666];

// The camera fits every point with a little margin. The library's Region starts at the south-west
// corner, not the centre.
function regionFor(points: LngLat[], minDelta = 0.01) {
  const all = points.length ? points : [fallback];
  const lngs = all.map(point => point[0]);
  const lats = all.map(point => point[1]);
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const latitudeDelta = Math.max((maxLat - minLat) * 1.4, minDelta);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.4, minDelta);
  return {
    latitude: (minLat + maxLat) / 2 - latitudeDelta / 2,
    longitude: (minLng + maxLng) / 2 - longitudeDelta / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

// Points closer than ~10 m count as the same view, so a growing run does not shake the camera.
const regionKey = (region: ReturnType<typeof regionFor>) =>
  [
    region.latitude,
    region.longitude,
    region.latitudeDelta,
    region.longitudeDelta,
  ]
    .map(value => value.toFixed(4))
    .join(',');

// The camera's padding that puts the area's middle (or a lone point) where the screen wants it.
function paddingFor(area: RunMapArea | undefined, height: number) {
  if (!area || !height) {
    return undefined;
  }
  if (area.bottom - area.top < 0.05) {
    // Centre a point at `top`: pad the far side so the middle of what is left lands there.
    const y = area.top;
    return y < 0.5
      ? { top: 0, bottom: (1 - 2 * y) * height }
      : { top: (2 * y - 1) * height, bottom: 0 };
  }
  return { top: area.top * height, bottom: (1 - area.bottom) * height };
}

// A dot drawn as a marker: an optional soft circle around a solid dot with a ring.
function Dot({
  size,
  fill,
  ring,
  ringWidth,
  glow,
  glowSize = 0,
}: {
  size: number;
  fill: string;
  ring: string;
  ringWidth: number;
  glow?: string;
  glowSize?: number;
}) {
  const box = Math.max(size, glowSize);
  return (
    <View style={[styles.center, { width: box, height: box }]}>
      {glow ? (
        <View
          style={[
            styles.glow,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              backgroundColor: glow,
            },
          ]}
        />
      ) : null}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: fill,
          borderColor: ring,
          borderWidth: ringWidth,
        }}
      />
    </View>
  );
}

function DotMarker({
  at,
  dot,
}: {
  at: LngLat;
  dot: React.ComponentProps<typeof Dot>;
}) {
  const box = Math.max(dot.size, dot.glowSize ?? 0);
  return (
    <NaverMapMarkerOverlay
      {...toCoord(at)}
      width={box}
      height={box}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Dot {...dot} />
    </NaverMapMarkerOverlay>
  );
}

// The shared map for 2.0·3.x·4.2·5.2·6.x (ADR-0018, S15P31E105-415): the course, the run so far, the
// places the screen sets and the members, on the Naver map.
export const RunMap = forwardRef<RunMapRef, RunMapProps>(function NaverRunMap(
  {
    route,
    progress = 0,
    segmentPaces,
    paceLabels,
    trail,
    position,
    members,
    muted = false,
    dark = true,
    showLocation = false,
    customStyleId,
    area,
    fitTo,
    interactive = true,
    onTapMap,
    onCameraIdle,
    style,
  },
  ref,
) {
  const map = useRef<NaverMapViewRef>(null);
  useImperativeHandle(ref, () => map.current as NaverMapViewRef, []);
  const [height, setHeight] = useState(0);
  const padding = paddingFor(area, height);

  const running = !!trail && trail.length > 0;
  const hasRoute = !!route && route.length >= 2;

  // The camera follows whatever the screen shows; it moves only when that changes.
  const region = fitTo?.length
    ? regionFor(fitTo, 0.002)
    : regionFor([
        ...(route ?? []),
        ...(trail ?? []),
        ...(position ? [position] : []),
        ...(members ?? []).map(member => member.position),
      ]);
  // The padding is known only after layout, so it moves the camera as well.
  const key = `${regionKey(region)}|${padding?.top ?? 0},${
    padding?.bottom ?? 0
  }`;
  const shownKey = useRef('');
  // Camera calls sent before the native map is ready are dropped, so they wait for it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || !height || shownKey.current === key) {
      return;
    }
    // One frame later, so the new padding reaches the native map before the camera moves.
    const frame = requestAnimationFrame(() => {
      shownKey.current = key;
      map.current?.animateRegionTo({ ...region, duration: 300 });
    });
    return () => cancelAnimationFrame(frame);
    // region is rebuilt every render; key says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, height]);

  // The course per km while it carries paces; one piece otherwise. While running it is only a guide.
  const pieces = hasRoute
    ? !running && segmentPaces && segmentPaces.length > 0
      ? splitRoute(route, segmentPaces.length)
      : [route]
    : [];
  const fastest = segmentPaces?.length ? Math.min(...segmentPaces) : 0;
  const slowest = segmentPaces?.length ? Math.max(...segmentPaces) : 0;
  const pieceColor = (index: number) =>
    muted
      ? k1.mid
      : running
      ? coursePaceColors[2]
      : segmentPaces?.length
      ? paceColor(segmentPaces[index], fastest, slowest, coursePaceColors)
      : coursePaceColors[1];

  const nightFallback = dark && !customStyleId;
  return (
    <NaverMapView
      ref={map}
      style={[{ backgroundColor: dark ? k1.night : palette.white }, style]}
      onLayout={event => setHeight(event.nativeEvent.layout.height)}
      onInitialized={() => setReady(true)}
      initialRegion={region}
      customStyleId={customStyleId}
      mapType={nightFallback ? 'Navi' : 'Basic'}
      isNightModeEnabled={nightFallback}
      layerGroups={layerGroups}
      locationOverlay={{ ...locationLook, isVisible: showLocation }}
      mapPadding={padding}
      onTapMap={
        onTapMap
          ? ({ latitude, longitude }) => onTapMap([longitude, latitude])
          : undefined
      }
      onCameraIdle={
        onCameraIdle
          ? ({ latitude, longitude }) => onCameraIdle([longitude, latitude])
          : undefined
      }
      isScrollGesturesEnabled={interactive}
      isZoomGesturesEnabled={interactive}
      isTiltGesturesEnabled={false}
      isRotateGesturesEnabled={interactive}
      isExtentBoundedInKorea
      isShowLocationButton={false}
      isShowZoomControls={false}
      isShowScaleBar={false}
      isShowCompass={false}
      locale="ko"
    >
      {/* The course: by day a hollow line in the km colours, after sunset a white line. While running
          after sunset it is a dashed guide under the run. */}
      {pieces.length > 0 && !(dark && running) ? (
        <NaverMapMultiPathOverlay
          pathParts={pieces.map((piece, index) => {
            const color = dark ? (muted ? k1.mid : palette.white) : core;
            const outline = dark
              ? muted
                ? 'transparent'
                : halo
              : pieceColor(index);
            return {
              coords: piece.map(toCoord),
              color,
              outlineColor: outline,
              passedColor: dark ? passed : core,
              passedOutlineColor: dark ? halo : outline,
            };
          })}
          width={dark ? 3 : 2}
          outlineWidth={dark ? 2 : 2.5}
          progress={progress}
        />
      ) : null}
      {hasRoute && dark && running ? (
        <NaverMapPolylineOverlay
          coords={route.map(toCoord)}
          width={3}
          color="rgba(255, 255, 255, 0.45)"
          pattern={[4, 10]}
          capType="Round"
        />
      ) : null}
      {/* The run so far: by day a black hollow line from a white start, after sunset a bright white one. */}
      {trail && trail.length >= 2 ? (
        <NaverMapPathOverlay
          coords={trail.map(toCoord)}
          width={dark ? 5 : 2}
          outlineWidth={dark ? 5 : 2}
          color={dark ? palette.white : core}
          outlineColor={dark ? halo : ink}
        />
      ) : null}
      {trail && trail.length >= 2 && !dark ? (
        <DotMarker
          at={trail[0]}
          dot={{ size: 10, fill: palette.white, ring: ink, ringWidth: 2.5 }}
        />
      ) : null}
      {/* SF: where the course starts and ends. */}
      {hasRoute && !running ? (
        <NaverMapMarkerOverlay
          {...toCoord(route[0])}
          width={24}
          height={24}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.start}>
            <Text style={styles.startText}>SF</Text>
          </View>
        </NaverMapMarkerOverlay>
      ) : null}
      {/* 구간 페이스 알약: black, a pale number circle on the left, on the middle of each km. */}
      {paceLabels && !running
        ? pieces.map((piece, index) => {
            const label = paceLabels[index];
            if (!label) {
              return null;
            }
            const width = 40 + label.length * 9.5;
            return (
              <NaverMapMarkerOverlay
                key={`pace-${index}`}
                {...toCoord(piece[Math.floor(piece.length / 2)])}
                width={width}
                height={26}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={[styles.pill, { width }]}>
                  <View style={styles.pillNumber}>
                    <Text style={styles.pillNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.pillText}>{label}</Text>
                </View>
              </NaverMapMarkerOverlay>
            );
          })
        : null}
      {/* Me: at the end of the run, or on the place the screen set when there is no course. */}
      {running || (position && !hasRoute) ? (
        <DotMarker
          at={running ? trail[trail.length - 1] : (position as LngLat)}
          dot={
            dark
              ? running
                ? {
                    size: 16,
                    fill: k1.night,
                    ring: palette.white,
                    ringWidth: 3,
                    glow: 'rgba(255, 255, 255, 0.12)',
                    glowSize: 36,
                  }
                : {
                    size: 18,
                    fill: palette.white,
                    ring: palette.white,
                    ringWidth: 3,
                    glow: 'rgba(255, 255, 255, 0.12)',
                    glowSize: 44,
                  }
              : {
                  size: 17,
                  fill: ink,
                  ring: palette.white,
                  ringWidth: 3,
                  glow: 'rgba(58, 90, 108, 0.16)',
                  glowSize: 48,
                }
          }
        />
      ) : null}
      {/* The other members: a dot in their colour, the name on its right over a light halo. The name is
          drawn in the marker itself: the marker caption does not show on a marker drawn from a view. */}
      {(members ?? []).map(member => {
        const width = memberDot + 6 + member.label.length * 13 + 4;
        return (
          <NaverMapMarkerOverlay
            key={member.label}
            {...toCoord(member.position)}
            width={width}
            height={memberHeight}
            anchor={{ x: memberDot / 2 / width, y: 0.5 }}
            zIndex={1}
          >
            <View style={[styles.member, { width }]}>
              <Dot
                size={memberDot}
                fill={member.color}
                ring={palette.white}
                ringWidth={2}
              />
              <Text
                style={[
                  styles.memberName,
                  dark ? styles.memberNameDark : styles.memberNameLight,
                ]}
              >
                {member.label}
              </Text>
            </View>
          </NaverMapMarkerOverlay>
        );
      })}
    </NaverMapView>
  );
});

const styles = StyleSheet.create({
  member: {
    height: memberHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    includeFontPadding: false,
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 0 },
  },
  memberNameLight: { color: '#253649', textShadowColor: '#F3F5F6' },
  memberNameDark: { color: k1.ice, textShadowColor: k1.night },
  center: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute' },
  start: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ink,
    borderColor: palette.white,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: {
    color: palette.white,
    fontFamily: fontFamily.bold,
    fontSize: 8,
    includeFontPadding: false,
  },
  pill: {
    height: 26,
    borderRadius: 13,
    backgroundColor: ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    gap: 6,
  },
  pillNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#C4D4DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillNumberText: {
    color: ink,
    fontFamily: fontFamily.bold,
    fontSize: 11,
    includeFontPadding: false,
  },
  pillText: {
    color: palette.white,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    includeFontPadding: false,
  },
});
