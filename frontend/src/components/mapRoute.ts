import { distanceM, type LngLat } from '../geo';

// How a course is coloured on the map (RunMap) and in the 2.0 legend.

// 2.0 구간 색 (runway-course-handoff): 빠름 black, 보통 navy, 느림 steel blue.
export const coursePaceColors = ['#060606', '#3A5A6C', '#8DACBA'];

// How a course is drawn, on the map and in its thumbnail (S15P31E105-562 G안 · 떠 있는 리본): a white ribbon
// with a thin centre line over a soft shadow, the start and finish standing on a pole.
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

// The tilted city view and both RouteReplay modes share this look. Flat maps keep routeLook above.
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

// A course that ends where it starts carries one SF mark; otherwise S at the start and F at the end.
export const loopWithinM = 60;
export const isLoop = (route: LngLat[]) =>
  route.length >= 2 && distanceM(route[0], route[route.length - 1]) <= loopWithinM;

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
