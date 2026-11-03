import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Rect, Text } from 'react-native-svg';
import { distanceM, type LngLat } from '../../geo';
import { k1, palette } from '../../theme';
import { courseMapSize } from './courseMapArt';
import { coursePaceColors, CourseMockMap } from './CourseMockMap';

// Stand-in for the real map until the map SDK is chosen (S15P31E105-180). It draws a fixed street
// pattern and projects GeoJSON [longitude, latitude] points onto it, so screens already pass the
// same course and position data a real map will need.

const viewWidth = 360;
const viewHeight = 760;
// Where a course sits on the 390×844 day map: the mockup's loop, above the 2.0 sheet.
const courseRouteArea = { top: 160, bottom: 470 };
// 4.2 by day: the run so far between the stat strip and the pace card (runway-running-handoff RunMap).
const runRouteArea = { top: 330, bottom: 470 };

const looks = {
  day: {
    land: '#E6EAE8',
    park: '#D4E3D6',
    water: '#C5D3D8',
    road: '#FFFFFF',
    minor: '#F4F6F5',
    label: '#8C949C',
  },
  night: {
    land: '#16191E',
    park: '#1B231F',
    water: '#0C0E11',
    road: '#2A2F37',
    minor: '#20242A',
    label: '#4B5260',
  },
  // The day map in K1 hues (DESIGN.md 2-6 지도 위): no park green.
  k1: {
    land: '#D5DEE7',
    park: '#D5DEE7',
    water: '#B9C8D6',
    road: '#FFFFFF',
    minor: '#E9EEF3',
    label: k1.mid,
  },
  // After sunset: the dark map of DESIGN.md 2-7 (4.2와 같은 지도).
  k1Night: {
    land: '#0A111D',
    park: '#0A111D',
    water: k1.night,
    road: '#1A2432',
    minor: '#131C29',
    label: k1.mid,
  },
};

// The sea along the right edge and a park, roughly where 민락수변공원 sits on the prototype map.
const water =
  'M240 0 L360 0 L360 760 L170 760 C200 640 230 560 250 470 C262 410 300 360 320 300 C340 240 300 180 280 120 C268 80 250 40 240 0 Z';
const park = 'M40 90 L120 70 L150 140 L90 190 L30 160 Z';
const roads = [
  'M0 250 L360 210',
  'M0 420 L250 380',
  'M60 0 L110 760',
  'M180 0 L200 300 L150 760',
  'M0 600 L220 560',
];
const minorRoads = [
  'M0 120 L240 90',
  'M0 330 L260 300',
  'M0 510 L230 470',
  'M20 0 L50 760',
  'M140 0 L140 760',
  'M0 690 L200 660',
];

// Faster segments are a deeper mint, slower ones paler (2.0 범례 빠름 ↔ 느림).
export const paceColors = ['#1F8F80', '#3FB6A5', '#7FD8CB', '#B8EDE5'];

function paceColor(
  pace: number,
  fastest: number,
  slowest: number,
  scale: string[],
) {
  if (slowest === fastest) {
    return scale[1];
  }
  const step = Math.round(
    ((pace - fastest) / (slowest - fastest)) * (scale.length - 1),
  );
  return scale[step];
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Splits a route into equal-length parts (one per km) and returns each part's points.
export function splitRoute(route: LngLat[], parts: number) {
  const lengths = route
    .slice(1)
    .map((point, index) => distanceM(route[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const target = total / parts;
  const result: LngLat[][] = [[route[0]]];
  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const [start, end] = [route[index], route[index + 1]];
    let from = start;
    let left = lengths[index];
    while (result.length < parts && walked + left >= target * result.length) {
      const need = target * result.length - walked;
      const t = need / left;
      const cut: LngLat = [
        from[0] + (end[0] - from[0]) * t,
        from[1] + (end[1] - from[1]) * t,
      ];
      result[result.length - 1].push(cut);
      result.push([cut]);
      walked += need;
      left -= need;
      from = cut;
    }
    walked += left;
    result[result.length - 1].push(end);
  }
  return result;
}

function projector(
  points: LngLat[],
  area: { top: number; bottom: number },
  frameWidth = viewWidth,
) {
  const lngs = points.map(point => point[0]);
  const lats = points.map(point => point[1]);
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const midLat = (minLat + maxLat) / 2;
  const spanX = Math.max((maxLng - minLng) * Math.cos(toRadians(midLat)), 1e-4);
  const spanY = Math.max(maxLat - minLat, 1e-4);
  const box = { left: 50, right: frameWidth - 50, ...area };
  const scale = Math.min(
    (box.right - box.left) / spanX,
    (box.bottom - box.top) / spanY,
  );
  const offsetX = (box.left + box.right) / 2;
  const offsetY = (box.top + box.bottom) / 2;
  const midLng = (minLng + maxLng) / 2;
  return ([lng, lat]: LngLat) => ({
    x: offsetX + (lng - midLng) * Math.cos(toRadians(midLat)) * scale,
    y: offsetY - (lat - midLat) * scale,
  });
}

export function MockMap({
  night = false,
  position,
  route,
  segmentPaces,
  showPaceLabels = false,
  routeArea = { top: 140, bottom: 420 },
  positionY = 300,
  formatLabel,
  trail,
  muted = false,
  markers,
  k1Style = false,
}: {
  night?: boolean;
  position?: LngLat;
  route?: LngLat[];
  segmentPaces?: number[];
  showPaceLabels?: boolean;
  // Where the course sits on screen, in the 360×760 frame, above the bottom card.
  routeArea?: { top: number; bottom: number };
  // Height in the 360×760 frame where a lone position dot sits.
  positionY?: number;
  formatLabel?: (km: number, pace: number) => string;
  // 4.2: the path run so far. It is drawn solid with the runner at its end, and the course left to run is dashed.
  trail?: LngLat[];
  // 6.4e 취소된 그룹런: the course in grey instead of mint.
  muted?: boolean;
  // 6.6 그룹런: the other members, drawn as dots with name tags.
  markers?: { position: LngLat; label: string; color: string }[];
  // 2.0F·2.0: the K1 maps. By day a black position dot and dark pace labels; after sunset the
  // 2-7 dark map with a white course line and a white dot.
  k1Style?: boolean;
}) {
  const k1Day = k1Style && !night;
  const k1Night = k1Style && night;
  if (k1Day) {
    // 2.0·2.0F·3.1·4.2 by day: the thin-line map of runway-course-handoff, in its 390×844 frame.
    const running = trail && trail.length > 0;
    const fit = projector(
      [...(route ?? []), ...(trail ?? []), ...(position ? [position] : [])],
      running
        ? runRouteArea
        : route
        ? courseRouteArea
        : { top: positionY, bottom: positionY },
      courseMapSize.width,
    );
    // While running, the course is only a guide under the run; its pace colors belong to 2.0.
    const pieces = route
      ? !running && segmentPaces && segmentPaces.length > 0
        ? splitRoute(route, segmentPaces.length)
        : [route]
      : [];
    const fastestPace = segmentPaces ? Math.min(...segmentPaces) : 0;
    const slowestPace = segmentPaces ? Math.max(...segmentPaces) : 0;
    return (
      <CourseMockMap
        project={fit}
        parts={pieces}
        colors={pieces.map((_, index) =>
          running
            ? coursePaceColors[2]
            : segmentPaces
            ? paceColor(
                segmentPaces[index],
                fastestPace,
                slowestPace,
                coursePaceColors,
              )
            : coursePaceColors[1],
        )}
        paceLabels={
          showPaceLabels && segmentPaces
            ? segmentPaces.map((pace, index) =>
                formatLabel ? formatLabel(index + 1, pace) : String(index + 1),
              )
            : null
        }
        position={position}
        trail={running ? trail : undefined}
      />
    );
  }
  const look =
    looks[night ? (k1Night ? 'k1Night' : 'night') : k1Day ? 'k1' : 'day'];
  const scale = paceColors;
  const project = projector(
    [...(route ?? []), ...(trail ?? []), ...(position ? [position] : [])],
    route || (trail && trail.length > 1)
      ? routeArea
      : { top: positionY, bottom: positionY },
  );
  const toPoints = (line: LngLat[]) =>
    line
      .map(point => {
        const { x, y } = project(point);
        return `${x},${y}`;
      })
      .join(' ');
  const runner =
    trail && trail.length > 0 ? project(trail[trail.length - 1]) : null;
  const parts = trail
    ? []
    : route && segmentPaces && segmentPaces.length > 0
    ? splitRoute(route, segmentPaces.length)
    : route
    ? [route]
    : [];
  const fastest = segmentPaces ? Math.min(...segmentPaces) : 0;
  const slowest = segmentPaces ? Math.max(...segmentPaces) : 0;
  const start = route ? project(route[0]) : null;
  const here = position ? project(position) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Rect width={viewWidth} height={viewHeight} fill={look.land} />
        <Path d={park} fill={look.park} />
        <Path d={water} fill={look.water} />
        {minorRoads.map(d => (
          <Path key={d} d={d} stroke={look.minor} strokeWidth={4} fill="none" />
        ))}
        {roads.map(d => (
          <Path key={d} d={d} stroke={look.road} strokeWidth={8} fill="none" />
        ))}
        {parts.map((part, index) => {
          const points = part
            .map(point => {
              const { x, y } = project(point);
              return `${x},${y}`;
            })
            .join(' ');
          const color = muted
            ? look.label
            : night
            ? k1Night
              ? palette.white
              : palette.mint
            : segmentPaces
            ? paceColor(segmentPaces[index], fastest, slowest, scale)
            : scale[1];
          return (
            <G key={`part-${index}`}>
              {night && !muted && !k1Night ? (
                <Polyline
                  points={points}
                  stroke={palette.mint}
                  strokeOpacity={0.25}
                  strokeWidth={14}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              <Polyline
                points={points}
                stroke={color}
                strokeWidth={night ? 5 : 7}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </G>
          );
        })}
        {trail && route ? (
          <Polyline
            points={toPoints(route)}
            stroke={
              k1Night ? palette.white : night ? palette.mint : paceColors[1]
            }
            strokeOpacity={k1Night ? 0.45 : night ? 0.45 : 0.7}
            strokeWidth={5}
            strokeDasharray="2 9"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {trail && trail.length > 1 ? (
          <G>
            <Polyline
              points={toPoints(trail)}
              stroke={k1Night ? palette.white : palette.mint}
              strokeOpacity={k1Night ? 0.18 : 0.3}
              strokeWidth={16}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Polyline
              points={toPoints(trail)}
              stroke={
                k1Night ? palette.white : night ? palette.mint : paceColors[0]
              }
              strokeWidth={6}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </G>
        ) : null}
        {(markers ?? []).map((marker, index) => {
          const at = project(marker.position);
          const width = 14 + marker.label.length * 12;
          // Members close together get their tags stacked so the names stay readable.
          const lift = [0, 22, 44][index % 3];
          return (
            <G key={marker.label}>
              <Circle
                cx={at.x}
                cy={at.y}
                r={6}
                fill={marker.color}
                stroke={palette.white}
                strokeWidth={2}
              />
              <Rect
                x={at.x - width / 2}
                y={at.y - 30 - lift}
                width={width}
                height={18}
                rx={6}
                fill={k1Night ? k1.night : night ? palette.card : palette.white}
                opacity={k1Night ? 0.62 : 0.92}
              />
              <Rect
                x={at.x - width / 2 + 5}
                y={at.y - 26 - lift}
                width={2.5}
                height={10}
                rx={1}
                fill={marker.color}
              />
              <Text
                x={at.x + 3}
                y={at.y - 17 - lift}
                fontSize={11}
                fontWeight="700"
                fill={k1Night ? k1.ice : night ? palette.white : palette.ink}
                textAnchor="middle"
              >
                {marker.label}
              </Text>
            </G>
          );
        })}
        {runner ? (
          <G>
            <Circle
              cx={runner.x}
              cy={runner.y}
              r={18}
              fill={k1Night ? palette.white : palette.mint}
              opacity={k1Night ? 0.12 : 0.3}
            />
            {/* On the K1 dark map the runner is a black dot in a white ring. */}
            <Circle
              cx={runner.x}
              cy={runner.y}
              r={8}
              fill={k1Night ? k1.night : palette.mintDeep}
              stroke={palette.white}
              strokeWidth={3}
            />
          </G>
        ) : null}
        {showPaceLabels && segmentPaces && !night && !trail
          ? parts.map((part, index) => {
              const middle = project(part[Math.floor(part.length / 2)]);
              const label = formatLabel
                ? formatLabel(index + 1, segmentPaces[index])
                : String(index + 1);
              return (
                <G key={`label-${index}`}>
                  <Rect
                    x={middle.x - 34}
                    y={middle.y - 12}
                    width={68}
                    height={24}
                    rx={12}
                    fill={k1Day ? k1.night : palette.white}
                  />
                  <Circle
                    cx={middle.x - 22}
                    cy={middle.y}
                    r={8}
                    fill={k1Day ? k1.mid : palette.ink}
                  />
                  <Text
                    x={middle.x - 22}
                    y={middle.y + 3.5}
                    fontSize={10}
                    fontWeight="700"
                    fill={k1Day ? k1.night : palette.white}
                    textAnchor="middle"
                  >
                    {index + 1}
                  </Text>
                  <Text
                    x={middle.x + 8}
                    y={middle.y + 4}
                    fontSize={11}
                    fontWeight="700"
                    fill={k1Day ? palette.white : palette.ink}
                    textAnchor="middle"
                  >
                    {label}
                  </Text>
                </G>
              );
            })
          : null}
        {start ? (
          <G>
            <Circle
              cx={start.x}
              cy={start.y}
              r={10}
              fill={palette.ink}
              stroke={palette.white}
              strokeWidth={2}
            />
            <Text
              x={start.x}
              y={start.y + 3}
              fontSize={8}
              fontWeight="700"
              fill={palette.white}
              textAnchor="middle"
            >
              SF
            </Text>
          </G>
        ) : null}
        {here && !route && !trail ? (
          <G>
            <Circle
              cx={here.x}
              cy={here.y}
              r={22}
              fill={k1Day ? k1.night : k1Night ? palette.white : palette.mint}
              opacity={k1Style ? 0.12 : 0.25}
            />
            <Circle
              cx={here.x}
              cy={here.y}
              r={k1Night ? 9 : 8}
              fill={
                k1Day ? k1.night : k1Night ? palette.white : palette.mintDeep
              }
              stroke={palette.white}
              strokeWidth={3}
            />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
