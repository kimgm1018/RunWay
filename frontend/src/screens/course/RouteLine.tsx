import React from 'react';
import Svg, { Circle, Polyline, Text } from 'react-native-svg';
import { k1, palette } from '../../theme';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// A course as a white line with a faint white halo and the S·F start dot, fitted into its box
// (DESIGN.md 2-7 코스 카드: 3.1b 앞면, 4.5·4.5F 경로). It takes GeoJSON [longitude, latitude] points.
export function RouteLine({ route }: { route: [number, number][] }) {
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
      <Polyline
        points={points}
        fill="none"
        stroke={palette.white}
        strokeOpacity={0.18}
        strokeWidth={6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Polyline
        points={points}
        fill="none"
        stroke={palette.white}
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={start.x} cy={start.y} r={3} fill={k1.ice} />
      <Text
        x={start.x + 4.5}
        y={start.y + 1.6}
        fontSize={4.6}
        fontWeight="700"
        fill={k1.ice}
      >
        S·F
      </Text>
    </Svg>
  );
}
