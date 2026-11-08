// Small GeoJSON helpers for routes given as [longitude, latitude] points.

export type LngLat = [number, number];

const earthM = 6371000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthM * Math.asin(Math.sqrt(h));
}

export function routeLengthM(route: LngLat[]) {
  return route
    .slice(1)
    .reduce((sum, point, index) => sum + distanceM(route[index], point), 0);
}

// The part of the route covered after `walkedM` metres, ending at the exact point reached.
export function walkAlong(route: LngLat[], walkedM: number): LngLat[] {
  if (route.length < 2 || walkedM <= 0) {
    return route.slice(0, 1);
  }
  const path: LngLat[] = [route[0]];
  let left = walkedM;
  for (let index = 1; index < route.length; index += 1) {
    const [from, to] = [route[index - 1], route[index]];
    const length = distanceM(from, to);
    if (left <= length) {
      const t = length === 0 ? 0 : left / length;
      path.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ]);
      return path;
    }
    path.push(to);
    left -= length;
  }
  return path;
}

// Fits a route into the 0–1 box the list thumbnails draw (north up, the longer side 0.1–0.9).
export function shapeOfRoute(route: LngLat[]): [number, number][] {
  const xs = route.map(point => point[0]);
  const ys = route.map(point => point[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  return route.map(([x, y]) => [
    0.1 + ((x - minX) / span) * 0.8,
    0.9 - ((y - minY) / span) * 0.8,
  ]);
}
