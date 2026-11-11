import type { LiveMetrics } from '../../watch/liveMetrics';

// 실측값 지연 안내(S15P31E105-528). 워치 batch는 최대 약 5초마다 오므로, 마지막으로 받은 지 10초(두 번 놓침)가
// 넘으면 화면 숫자가 오래된 값임을 알린다. 받은 적이 없거나 달리는 중이 아니면 알리지 않는다.
export const LIVE_STALE_MS = 10_000;

export function liveDelayNotice(
  live: LiveMetrics | null,
  nowMs: number,
  running: boolean,
): string | null {
  if (!live || !running) {
    return null;
  }
  const age = nowMs - live.receivedAt;
  if (age < LIVE_STALE_MS) {
    return null;
  }
  const seconds = Math.floor(age / 1000);
  return seconds < 60
    ? `측정값을 ${seconds}초 전에 받았어요`
    : `측정값을 ${Math.floor(seconds / 60)}분 전에 받았어요`;
}
