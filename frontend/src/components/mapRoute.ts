import { distanceM, type LngLat } from '../geo';

// How a course is coloured on the map (RunMap) and in the 2.0 legend.

// 2.0 구간 색 (runway-course-handoff): 빠름 black, 보통 navy, 느림 steel blue.
export const coursePaceColors = ['#060606', '#3A5A6C', '#8DACBA'];

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
