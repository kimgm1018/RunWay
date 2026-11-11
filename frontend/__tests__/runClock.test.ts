import type { RunningSessionView } from '../src/data/types';
import { runClockOf, runClockSec } from '../src/screens/run/runClock';
import { withClock } from '../src/screens/run/RunSession';
import { LIVE_STALE_MS, liveDelayNotice } from '../src/screens/run/liveDelay';
import type { LiveMetrics } from '../src/watch/liveMetrics';

// S15P31E105-528: 운동 시간은 서버가 준 일시정지 제외 운동시간(S15P31E105-643)을 기준으로 맞추고,
// 오래된 실측값은 마지막으로 받은 시각으로 알린다.

function view(change: Partial<RunningSessionView> = {}): RunningSessionView {
  return {
    sessionId: '201',
    controlDeviceId: '101',
    relayDeviceId: '102',
    state: 'RUNNING',
    stateVersion: 3,
    startedAt: '2026-11-10T01:00:00Z',
    endedAt: null,
    recordingMode: 'WATCH',
    pendingCommand: null,
    lastCommand: null,
    analysisStatus: 'PENDING',
    movingDurationSec: 1080,
    ...change,
  };
}

const at = 1_000_000;

test('a running session keeps counting from the server time it was given', () => {
  const clock = runClockOf(view(), at);
  expect(clock).toEqual({ movingSec: 1080, receivedAt: at, running: true });
  expect(runClockSec(clock!, at)).toBe(1080);
  expect(runClockSec(clock!, at + 1_500)).toBe(1081);
  expect(runClockSec(clock!, at + 62_000)).toBe(1142);
  // 폰 시계가 뒤로 가도 서버 값보다 줄지 않는다.
  expect(runClockSec(clock!, at - 5_000)).toBe(1080);
});

test('a paused or finished session stays at the server time', () => {
  for (const state of ['PAUSED', 'COMPLETED'] as const) {
    const clock = runClockOf(view({ state }), at);
    expect(clock?.running).toBe(false);
    expect(runClockSec(clock!, at + 60_000)).toBe(1080);
  }
});

test('without a server time or before the start there is no server clock', () => {
  expect(runClockOf(view({ movingDurationSec: null }), at)).toBeNull();
  expect(runClockOf(view({ movingDurationSec: undefined }), at)).toBeNull();
  expect(runClockOf(view({ state: 'READY', startedAt: null }), at)).toBeNull();
});

test('the screen time follows the server clock and keeps the phone clock without one', () => {
  const sample = {
    elapsedSec: 12,
    distanceM: 3000,
    paceSecPerKm: 360,
    heartRate: 150,
    cadence: 170,
    position: null,
  };
  // 앱을 다시 열어 화면 시계가 0부터 세도 서버 기준으로 바로 맞는다.
  expect(withClock(sample, runClockOf(view(), at), at + 2_000)).toEqual({
    ...sample,
    elapsedSec: 1082,
  });
  expect(withClock(sample, null, at)).toBe(sample);
});

function live(receivedAt: number): LiveMetrics {
  return {
    distanceM: 3000,
    paceSecPerKm: 360,
    heartRate: 150,
    cadence: 170,
    route: [],
    routeParts: [],
    here: null,
    positionReceivedAt: null,
    newSample: true,
    source: 'WATCH',
    measuredAt: null,
    receivedAt,
  } as LiveMetrics;
}

test('old measured values are told by how long ago they arrived', () => {
  expect(liveDelayNotice(null, at, true)).toBeNull();
  expect(liveDelayNotice(live(at), at + LIVE_STALE_MS - 1, true)).toBeNull();
  expect(liveDelayNotice(live(at), at + LIVE_STALE_MS, true)).toBe(
    '측정값을 10초 전에 받았어요',
  );
  expect(liveDelayNotice(live(at), at + 125_000, true)).toBe(
    '측정값을 2분 전에 받았어요',
  );
  // 일시정지 중에는 값이 오지 않는 게 정상이라 알리지 않는다.
  expect(liveDelayNotice(live(at), at + 60_000, false)).toBeNull();
});
