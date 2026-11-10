// 현재 페이스 공통 규칙(S15P31E105-549, 사용자 결정 2안). 워치(wear/.../run/PaceRule.kt)와 같은 규칙·값을 쓴다.
// 순간 속도 하나가 아니라 측정 시각 기준 최근 구간의 누적 거리 변화로 계산해, 같은 데이터면 워치와 폰이 같은 값을 낸다.
//  1. 가장 최근 속도가 MIN_MOVING_MPS 미만이면 서 있다고 보고 null.
//  2. 마지막 거리 표본 기준 WINDOW_MS 안의 표본을 쓴다. 표본이 2개 미만이거나 구간이 MIN_SPAN_MS 미만이면 마지막 표본과
//     그 이전 FALLBACK_MS 안의 가장 가까운 표본을 쓴다(화면이 꺼지면 워치가 거리를 몰아서 준다).
//  3. 페이스 = 걸린 시간 ÷ 이동 거리. 평균 속도가 MIN_MOVING_MPS 미만이면 null.
//  4. 거리로 계산할 수 없으면 최근 속도(MIN_MOVING_MPS 이상)로 계산한다.

export const MIN_MOVING_MPS = 0.3;
export const WINDOW_MS = 15_000;
export const MIN_SPAN_MS = 5_000;
export const FALLBACK_MS = 60_000;

export type DistanceSample = { at: number; metres: number };
export type SpeedSample = { at: number; mps: number };

// 초/km. samples는 측정 시각 순이 아니어도 된다.
export function currentPace(
  samples: DistanceSample[],
  latestSpeed: SpeedSample | null,
): number | null {
  if (latestSpeed && latestSpeed.mps < MIN_MOVING_MPS) {
    return null;
  }
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const fromDistance = paceOf(sorted);
  if (fromDistance !== undefined) {
    return fromDistance;
  }
  return latestSpeed ? 1000 / latestSpeed.mps : null;
}

// undefined: 거리로 계산할 수 없음. null: 계산했지만 서 있음.
function paceOf(sorted: DistanceSample[]): number | null | undefined {
  if (sorted.length < 2) {
    return undefined;
  }
  const last = sorted[sorted.length - 1];
  const inWindow = sorted.filter(sample => sample.at >= last.at - WINDOW_MS);
  let first = inWindow[0];
  if (inWindow.length < 2 || last.at - first.at < MIN_SPAN_MS) {
    const earlier = sorted.filter(
      sample => sample.at <= last.at - MIN_SPAN_MS && sample.at >= last.at - FALLBACK_MS,
    );
    if (earlier.length === 0) {
      return undefined;
    }
    first = earlier[earlier.length - 1];
  }
  const seconds = (last.at - first.at) / 1000;
  const metres = last.metres - first.metres;
  if (seconds <= 0 || metres < 0) {
    return undefined;
  }
  const mps = metres / seconds;
  return mps < MIN_MOVING_MPS ? null : 1000 / mps;
}
