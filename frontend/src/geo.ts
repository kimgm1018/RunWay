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

// Compass bearing (0 north, clockwise) from one point to another.
export function bearingOf([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) {
  const y = Math.sin(toRadians(lng2 - lng1)) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.cos(toRadians(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

// How a route is fitted into the 0–1 box the list thumbnails draw (north up, the longer side 0.1–0.9, y grows
// downward, the course's box centred at 0.5, 0.5 so the shorter side sits in the middle), as a function any other
// [longitude, latitude] point can go through too. The course card's map image (S15P31E105-612) is rendered round
// the same centre, so the outline and the image's course meet. Points off the route may fall outside 0–1.
export function routeProjector(
  route: LngLat[],
): (point: LngLat) => [number, number] {
  const xs = route.map(point => point[0]);
  const ys = route.map(point => point[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  // The shorter side is moved in by half of what it lacks; the longer side gets 0 and keeps exactly 0.1–0.9.
  const padX = ((span - (maxX - minX)) / span) * 0.4;
  const padY = ((span - (maxY - minY)) / span) * 0.4;
  return ([x, y]) => [
    0.1 + padX + ((x - minX) / span) * 0.8,
    0.9 - padY - ((y - minY) / span) * 0.8,
  ];
}

// Fits a route into the 0–1 box the list thumbnails draw (north up, the longer side 0.1–0.9, centred).
export function shapeOfRoute(route: LngLat[]): [number, number][] {
  const project = routeProjector(route);
  return route.map(point => project(point));
}
