import type { RunningSessionView } from '../../data/types';

// 러닝 중 운동 시간의 서버 기준(S15P31E105-528). 서버가 응답 시각 기준으로 계산한 일시정지 제외 운동시간
// (movingDurationSec, S15P31E105-643)과 그 응답을 받은 폰 시각을 기준점으로 두고, 달리는 중에는 그 뒤로 흐른 시간을
// 더한다. 일시정지·종료 중에는 서버 값 그대로다. 서버 값이 없으면 null이고 화면은 폰 시계로 센다.
export type RunClock = {
  movingSec: number;
  // 응답을 받은 폰 시각(epoch ms). 폰·서버 시계 차이를 피하려고 서버 시각 대신 받은 시각을 쓴다.
  receivedAt: number;
  running: boolean;
};

export function runClockOf(
  view: RunningSessionView,
  receivedAt: number,
): RunClock | null {
  const movingSec = view.movingDurationSec;
  if (typeof movingSec !== 'number' || !view.startedAt) {
    return null;
  }
  return { movingSec, receivedAt, running: view.state === 'RUNNING' };
}

// 지금 보일 운동 시간(초, 버림).
export function runClockSec(clock: RunClock, nowMs: number) {
  const passed = clock.running
    ? Math.max(0, (nowMs - clock.receivedAt) / 1000)
    : 0;
  return Math.floor(clock.movingSec + passed);
}
