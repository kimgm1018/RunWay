import React from 'react';
import Svg, { Circle, Text } from 'react-native-svg';
import { RouteStroke } from '../../components/RouteStroke';
import { k1, palette } from '../../theme';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// A course in the shared layered community stroke, fitted into its box from GeoJSON [longitude, latitude].
// `thin` scales every layer together for a small tile; `color` controls only the start dot and S·F label.
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
      <RouteStroke points={points} scale={thin ? 0.12 : 0.3} />
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
