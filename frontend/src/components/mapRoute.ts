import { distanceM, routeLengthM, type LngLat } from '../geo';

// How a course is coloured on the map (RunMap) and in the 2.0 legend.

// 2.0 구간 색 (runway-course-handoff): 빠름 black, 보통 navy, 느림 steel blue.
export const coursePaceColors = ['#060606', '#3A5A6C', '#8DACBA'];

// Day-map marker, guide and progress tokens. The primary path now uses the shared community stroke below.
export const routeLook = {
  // The centre line of a course without paces, and of the run so far.
  ink: '#060606',
  ribbon: '#FFFFFF',
  // The part of the course already run.
  passed: '#B4BDC4',
  // The course under the run, as a guide.
  guide: '#8DACBA',
  // Opaque: the Naver path overlay on Android drew rgba(2,5,14,0.16) as solid black (emulator, S15P31E105-562),
  // so the shadow is the light grey that colour would make over the day map.
  shadow: '#C5CCD3',
  // Map widths in dp: the centre, the ribbon on each side of it, the shadow under the whole ribbon.
  centre: 2.2,
  edge: 2.4,
  shadowWidth: 10,
};

// The tilted city view and both RouteReplay modes share this palette. All map views now reuse its route stroke.
// Every colour is opaque: the Naver path overlay on Android drew part-see-through colours solid black (above).
// Fully transparent (`unpassed`) is the one exception, and draws nothing (S15P31E105-561's replay).
export const darkMapLook = {
  // Dark enough for the mint to glow, light enough that the NAVER logo still reads on the map.
  lightness: -0.3,
  // 코스 선 (담당자 지정): neon mint #4DFFD2 (RGB 77·255·210), the same as feedLook.route. The ribbon, shadow and
  // glows are the same hue (165°) at the lightness the earlier lime's ones had (S15P31E105-691).
  ink: '#4DFFD2',
  ribbon: '#B3FFEC',
  passed: '#B4BDC4',
  // The course under a run (heading · lean while running): dim and thin, so the mint run stays the one line
  // that reads.
  guide: '#687874',
  guideOutline: '#36403E',
  guideCentre: 2.2,
  guideEdge: 1.4,
  shadow: '#00785A',
  muted: '#9299A4',
  // Widths (S15P31E105-691): halfway between 672's lines and the running screen's 8.8 dp centre with a 1.6 dp
  // edge on each side; the border layers shrink together in their 672 proportions.
  centre: 6,
  edge: 1.9,
  shadowWidth: 12,
  // The replay's glowing trail: a wide dark halo, a narrower brighter one, then the mint core with a pale edge.
  glowOuter: '#003A2C',
  glowOuterWidth: 18,
  glowInner: '#00785A',
  glowInnerWidth: 12.2,
  coreWidth: 6.9,
  coreEdge: 1.2,
  // The whole course, thin and grey, over the opening overview only.
  outline: '#8C95A6',
  unpassed: 'rgba(0,0,0,0)',
};

// The run start map (2.0F · 2.0 · 3.1, S15P31E105-683): the tilted view at full brightness, the course a RunWay mint
// ribbon, and me as 6.9's mint pin.
export const mintMapLook = {
  ...darkMapLook,
  lightness: 0,
  // 담당자 경로 시안 (S15P31E105-683): a wide mint ribbon round a pale mint centre line, edged in deep teal.
  ink: '#B8FFEC',
  ribbon: '#4DFFD2',
  shadow: '#06231E',
  centre: 2.4,
  edge: 4,
  shadowWidth: 14,
  me: '#4DFFD2',
  meRing: '#02050E',
};

// S15P31E105-743: the community replay line approved on the device, shared by every route renderer.
// SVG draws the native path's outline as a separate stroke; small cards scale all four widths together.
export const routeStrokeLayers = [
  { color: darkMapLook.glowOuter, width: darkMapLook.glowOuterWidth },
  { color: darkMapLook.glowInner, width: darkMapLook.glowInnerWidth },
  {
    color: darkMapLook.ribbon,
    width: darkMapLook.coreWidth + 2 * darkMapLook.coreEdge,
  },
  { color: darkMapLook.ink, width: darkMapLook.coreWidth },
] as const;

// A run's measured route (S11 parts, or the app's own trail) is shown on a map and played back only when its parts
// of two or more points cover at least this much (S15P31E105-690): an indoor run, or one that never found GPS, has
// none or only a few metres of drift, and gets the 경로 없음 notice instead of an empty map.
export const shortRouteM = 50;

// GPS wanders a few metres either side of the way actually run, so a raw trace zigzags and now and then jumps out
// and back. The map and the replay draw a calmer line (S15P31E105-690); the stored points, the distance and the pace
// are untouched. A point is a spike when both its legs are longer than spikeM and its neighbours lie much closer to
// each other than to it; the rest is averaged with smoothReach points on either side, the ends kept where they are.
export const spikeM = 20;
const spikeShare = 0.5;
const smoothReach = 2;

export function calmRunPart(part: LngLat[]): LngLat[] {
  const kept: LngLat[] = [];
  part.forEach((point, index) => {
    const before = kept[kept.length - 1];
    const after = part[index + 1];
    if (before && after) {
      const out = distanceM(before, point);
      const back = distanceM(point, after);
      const shortest = Math.min(out, back);
      if (
        shortest > spikeM &&
        distanceM(before, after) < shortest * spikeShare
      ) {
        return;
      }
    }
    kept.push(point);
  });
  return kept.map((point, index) => {
    if (index === 0 || index === kept.length - 1) {
      return point;
    }
    const reach = Math.min(smoothReach, index, kept.length - 1 - index);
    let lng = 0;
    let lat = 0;
    for (let at = index - reach; at <= index + reach; at += 1) {
      lng += kept[at][0];
      lat += kept[at][1];
    }
    const count = reach * 2 + 1;
    return [lng / count, lat / count];
  });
}

// The parts kept for the map, calmed and never joined across their breaks, and the same points in order as one line
// for the camera and the S · F poles. null when there is nothing worth drawing.
export type RunRoute = { parts: LngLat[][]; route: LngLat[] };
export function runRouteOf(
  parts: LngLat[][] | null | undefined,
): RunRoute | null {
  const kept = (parts ?? []).filter(part => part.length >= 2);
  const length = kept.reduce((sum, part) => sum + routeLengthM(part), 0);
  if (length < shortRouteM) {
    return null;
  }
  const calm = kept.map(calmRunPart);
  return { parts: calm, route: calm.length === 1 ? calm[0] : calm.flat() };
}

// A course that ends where it starts carries one SF mark; otherwise S at the start and F at the end.
export const loopWithinM = 60;
export const isLoop = (route: LngLat[]) =>
  route.length >= 2 &&
  distanceM(route[0], route[route.length - 1]) <= loopWithinM;

// Picks the colour of one km from where its pace sits between the fastest and the slowest km.
export function paceColor(
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

// Splits a route into equal-length parts (one per km) and returns each part's points.
export function paceLabelPositions(route: LngLat[], count: number, planDistanceM: number) {
  const lengths = route.slice(1).map((point, index) => distanceM(route[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!(total > 0) || !(planDistanceM > (count - 1) * 1000)) return [];
  let edge = 0;
  let walked = 0;
  return Array.from({ length: count }, (_, index): LngLat => {
    const start = index * 1000;
    const end = Math.min(start + 1000, planDistanceM);
    const target = ((start + end) / 2 / planDistanceM) * total;
    while (edge < lengths.length - 1 && walked + lengths[edge] <= target) {
      walked += lengths[edge];
      edge++;
    }
    const from = route[edge];
    const to = route[edge + 1];
    const ratio = lengths[edge] > 0 ? (target - walked) / lengths[edge] : 0;
    return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
  });
}

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
