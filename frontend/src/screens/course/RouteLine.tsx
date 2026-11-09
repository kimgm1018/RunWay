import React from 'react';
import Svg, { Circle, Polyline, Text } from 'react-native-svg';
import { k1, palette } from '../../theme';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// A course as a white line with a faint white halo and the S·F start dot, fitted into its box
// (DESIGN.md 2-7 코스 카드: 3.1b 앞면, 4.5·4.5F 경로). It takes GeoJSON [longitude, latitude] points.
// thin: runway-course-handoff 3.1b, a bare 1.5px white line with a white start dot and S·F.
// color draws the line, halo, dot and S·F in one colour instead (6.7 on the mist in mint, S15P31E105-563).
export function RouteLine({
  route,
  thin = false,
  color,
}: {
  route: [number, number][];
  thin?: boolean;
  color?: string;
}) {
  if (route.length < 2) {
    return null;
  }
  const lngs = route.map(point => point[0]);
  const lats = route.map(point => point[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squeeze = Math.cos(toRadians(midLat));
  const spanX = Math.max(
    (Math.max(...lngs) - Math.min(...lngs)) * squeeze,
    1e-6,
  );
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 1e-6);
  const scale = 76 / Math.max(spanX, spanY);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const project = ([lng, lat]: [number, number]) => ({
    x: 50 + (lng - midLng) * squeeze * scale,
    y: 50 - (lat - midLat) * scale,
  });
  const points = route
    .map(point => {
      const { x, y } = project(point);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const start = project(route[0]);
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      {thin ? null : (
        <Polyline
          points={points}
          fill="none"
          stroke={color ?? palette.white}
          strokeOpacity={0.18}
          strokeWidth={6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <Polyline
        points={points}
        fill="none"
        stroke={color ?? palette.white}
        strokeWidth={thin ? 0.6 : 2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle
        cx={start.x}
        cy={start.y}
        r={thin ? 1.8 : 3}
        fill={color ?? (thin ? palette.white : k1.ice)}
      />
      <Text
        x={start.x + (thin ? 3.2 : 4.5)}
        y={start.y + (thin ? 1.3 : 1.6)}
        fontSize={thin ? 3.6 : 4.6}
        fontWeight="700"
        fill={color ?? (thin ? palette.white : k1.ice)}
      >
        S·F
      </Text>
    </Svg>
  );
}
