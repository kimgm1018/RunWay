import type { RunSplit } from '../../data';

// 2.1 홈 최근 러닝의 페이스·심박 미리보기와 목표 페이스 유지율 (S15P31E105-615). H02 · H03 give one pace and one average
// heart rate per km, so both are worked out from the splits and drawn by distance; there are no per-second samples.

// A short last stretch joins the km before it, so 5.02km reads as five bands, not five and a sliver.
const sliverM = 200;

// The run's whole kms (담당자 요청: 1km 구간이 보이게; 분은 빼고 거리로), each as the band the preview shades and labels,
// in metres from the start. They come from the total distance, not from the splits, so a mock's 500m splits still
// show 1km bands.
export function kmBands(splits: RunSplit[]) {
  const totalM = splits[splits.length - 1]?.endDistanceM ?? 0;
  const bands: { km: number; startM: number; endM: number }[] = [];
  for (let from = 0; from < totalM; from += 1000) {
    const to = Math.min(from + 1000, totalM);
    if (to - from < sliverM && bands.length) {
      bands[bands.length - 1].endM = to;
      continue;
    }
    bands.push({ km: bands.length + 1, startM: from, endM: to });
  }
  return bands;
}

// How far from the target pace still counts as keeping it (담당자 결정: ±10초/km).
export const keepToleranceSec = 10;

// 러닝 분석 뒷면 "목표와 비교" (S15P31E105-615, 담당자 요청서): each split with a pace is compared with the target,
// within ±keepToleranceSec counting as 목표 범위; faster or slower is only that, never 성공·실패. Splits are the API's
// own (H03), a split without a pace is left out and counted as missing, and a short last split keeps its distance so
// the card can name it. Nothing here is a per-second rate: it is split averages against the target.
export type SplitSide = 'faster' | 'within' | 'slower';

export type ComparedSplit = {
  startM: number;
  endM: number;
  // A last split shorter than a km, which the card names by its distance.
  short: boolean;
  side: SplitSide;
};

export function sideOf(pace: number, target: number): SplitSide {
  if (pace < target - keepToleranceSec) {
    return 'faster';
  }
  if (pace > target + keepToleranceSec) {
    return 'slower';
  }
  return 'within';
}

export function compareSplits(splits: RunSplit[], target: number) {
  const compared: ComparedSplit[] = [];
  let missing = 0;
  splits.forEach((split, index) => {
    if (split.paceSecPerKm === null) {
      missing += 1;
      return;
    }
    const length = split.endDistanceM - split.startDistanceM;
    compared.push({
      startM: split.startDistanceM,
      endM: split.endDistanceM,
      short: index === splits.length - 1 && length < 1000,
      side: sideOf(split.paceSecPerKm, target),
    });
  });
  return {
    compared,
    within: compared.filter(item => item.side === 'within').length,
    missing,
  };
}

// What the run measured: pace and heart rate at all, and whether some split lacks one the run otherwise has.
export function measured(splits: RunSplit[]) {
  const pace = splits.some(split => split.paceSecPerKm !== null);
  const heart = splits.some(split => split.averageHeartRate !== null);
  const gap = splits.some(
    split =>
      (pace && split.paceSecPerKm === null) ||
      (heart && split.averageHeartRate === null),
  );
  return { pace, heart, gap };
}

// 19초 or 1분 50초.
function gapText(seconds: number) {
  const rounded = Math.round(Math.abs(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)}분 ${rounded % 60}초`
    : `${rounded}초`;
}

// 0, 1, 4.02: a distance in km without trailing zeros.
const kmText = (meters: number) => String(Number((meters / 1000).toFixed(2)));

// 0~1km, or 마지막 0.02km for a short last split.
function splitName(split: ComparedSplit) {
  return split.short
    ? `마지막 ${kmText(split.endM - split.startM)}km`
    : `${kmText(split.startM)}~${kmText(split.endM)}km`;
}

// A few names, the rest counted, so a long run's list stays one line or two.
function names(splits: ComparedSplit[]) {
  const shown = splits.slice(0, 3).map(splitName).join(', ');
  return splits.length > 3 ? `${shown} 외 ${splits.length - 3}개` : shown;
}

export type GoalComparison =
  | { kind: 'noTarget' }
  | {
      kind: 'target';
      // The one line on top, from the average against the target.
      summary: string;
      target: number;
      average: number;
      // How far apart the two are, in plain words.
      gap: string;
      // null without splits to compare (H03 empty).
      splits: {
        analyzed: number;
        within: number;
        missing: number;
        faster: string | null;
        slower: string | null;
      } | null;
    };

// 러닝 분석 뒷면 (S15P31E105-615): the run's own target pace (H02 goal_pace, the runner's own, never a group's)
// against what was run. Without a target there is nothing to compare, and the card says so.
export function compareWithGoal(
  splits: RunSplit[],
  average: number,
  target: number | null,
): GoalComparison {
  if (!target) {
    return { kind: 'noTarget' };
  }
  const side = sideOf(average, target);
  const diff = target - average;
  const summary =
    side === 'within'
      ? '평균 페이스는 목표와 비슷했어요.'
      : `평균 페이스가 목표보다 ${gapText(diff)} ${
          side === 'faster' ? '빨랐어요' : '느렸어요'
        }.`;
  const gap =
    Math.round(diff) === 0
      ? '목표와 같은 페이스'
      : `목표보다 ${gapText(diff)} ${diff > 0 ? '빠름' : '느림'}`;
  const { compared, within, missing } = compareSplits(splits, target);
  const faster = compared.filter(split => split.side === 'faster');
  const slower = compared.filter(split => split.side === 'slower');
  return {
    kind: 'target',
    summary,
    target,
    average,
    gap,
    splits: compared.length
      ? {
          analyzed: compared.length,
          within,
          missing,
          faster: faster.length
            ? `${names(faster)} 구간은 목표보다 빠르게 달렸어요.`
            : null,
          slower: slower.length
            ? `${names(slower)} 구간은 목표보다 느리게 달렸어요.`
            : null,
        }
      : null,
  };
}
