import { createMockRepositories } from '../src/data';
import type { CommandApproval, WatchSessionEvent } from '../src/data/types';
import {
  canStartWithPhone,
  createRunControl,
  WATCH_PERMISSION_REQUIRED,
} from '../src/screens/run/runControl';

// S15P31E105-864: 워치가 시작에 쓸 수 없을 때(권한 없음·준비 실패) '폰으로 시작'과 워치 GPS 안내 값. 합성 값만 쓴다.

const goal = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

const location = {
  requestPermission: async () => true,
  current: async () => ({ latitude: 37.5, longitude: 127, accuracyM: 5, altitudeM: null, time: Date.now() }),
  start: async () => true,
  stop: async () => undefined,
  subscribe: () => () => undefined,
};

type Prepared = { ready: boolean; reasonCode: string | null; remoteGps?: boolean | null };

// 등록·연결된 워치(목업 default)에 준비 결과와 START 결과를 바꿔 끼운다.
function setup({
  prepared = { ready: true, reasonCode: null },
  startResult = () => ({ result: 'APPLIED', reasonCode: null }),
  withLocation = true,
}: {
  prepared?: Prepared;
  startResult?: (approval: CommandApproval) => { result: 'APPLIED' | 'REJECTED'; reasonCode: string | null; gps?: boolean };
  withLocation?: boolean;
} = {}) {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0, scenario: 'default' });
  const mockWatch = repositories.watchSession as typeof repositories.watchSession & {
    emit: (event: WatchSessionEvent) => void;
  };
  const created: { controlDeviceId: string; relayDeviceId: string }[] = [];
  const requests: string[] = [];
  const cancelled: string[] = [];
  const session = {
    ...repositories.session,
    create: (request: Parameters<typeof repositories.session.create>[0]) => {
      created.push({ controlDeviceId: request.controlDeviceId, relayDeviceId: request.relayDeviceId });
      return repositories.session.create(request);
    },
    requestControl: (...args: Parameters<typeof repositories.session.requestControl>) => {
      requests.push(args[1]);
      return repositories.session.requestControl(...args);
    },
    cancel: (sessionId: string) => {
      cancelled.push(sessionId);
      return repositories.session.cancel(sessionId);
    },
  };
  const prepare = jest.fn(async (_sessionId: string, { stateVersion }: { stateVersion: number }) => ({
    stateVersion,
    ...prepared,
  }));
  const sendCommand = jest.fn(async (sessionId: string, approval: CommandApproval) => {
    const outcome = startResult(approval);
    setTimeout(() =>
      mockWatch.emit({
        type: 'COMMAND_RESULT',
        sessionId,
        commandId: approval.commandId,
        result: outcome.result,
        appliedAt: outcome.result === 'APPLIED' ? '2026-11-16T01:00:01.000Z' : null,
        reasonCode: outcome.reasonCode,
        pendingBatchCount: null,
        uploadComplete: null,
        ...(outcome.gps === undefined ? {} : { gps: outcome.gps }),
      }),
    );
  });
  const watch = { ...mockWatch, prepare, sendCommand };
  const control = createRunControl({
    session,
    watch,
    ...(withLocation ? { location } : {}),
    timers: { resultWaitMs: 200, retryDelaysMs: [0], phoneFinishWaitMs: 10 },
  });
  return { control, created, requests, cancelled, prepare, sendCommand };
}

test('only an unusable watch at start offers the phone: not ready for any reason, or START refused for permissions', () => {
  expect(canStartWithPhone({ kind: 'watchNotReady', reasonCode: WATCH_PERMISSION_REQUIRED })).toBe(true);
  expect(canStartWithPhone({ kind: 'watchNotReady', reasonCode: 'PREPARE_TIMEOUT' })).toBe(true);
  expect(canStartWithPhone({ kind: 'watchNotReady', reasonCode: null })).toBe(true);
  expect(canStartWithPhone({ kind: 'rejected', action: 'START', reasonCode: WATCH_PERMISSION_REQUIRED })).toBe(true);
  expect(canStartWithPhone({ kind: 'rejected', action: 'START', reasonCode: 'VERSION_MISMATCH' })).toBe(false);
  expect(canStartWithPhone({ kind: 'unconfirmed', action: 'START' })).toBe(false);
  expect(canStartWithPhone({ kind: 'watchRequired' })).toBe(false);
  expect(canStartWithPhone(null)).toBe(false);
});

test('a watch without permissions is not ready; 폰으로 시작 cancels the READY session and starts phone-only', async () => {
  const { control, created, requests, cancelled, prepare, sendCommand } = setup({
    prepared: { ready: false, reasonCode: WATCH_PERMISSION_REQUIRED, remoteGps: true },
  });
  await control.start(goal);
  const first = control.getState();
  expect(first).toMatchObject({
    status: 'READY',
    problem: { kind: 'watchNotReady', reasonCode: WATCH_PERMISSION_REQUIRED },
    watchRemoteGps: null,
  });
  expect(requests).not.toContain('START');

  await control.startWithPhone(goal);

  expect(cancelled).toEqual([first.sessionId]);
  expect(created).toEqual([
    { controlDeviceId: '101', relayDeviceId: '102' },
    { controlDeviceId: '102', relayDeviceId: '102' },
  ]);
  expect(control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'PHONE_ONLY', problem: null });
  expect(control.getState().sessionId).not.toBe(first.sessionId);
  // 폰 전용 세션은 워치를 준비시키거나 명령하지 않는다.
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(sendCommand).not.toHaveBeenCalled();
  control.dispose();
});

test('a START refused for watch permissions leaves nothing unconfirmed and the phone can start', async () => {
  const { control, created, requests, sendCommand } = setup({
    startResult: () => ({ result: 'REJECTED', reasonCode: WATCH_PERMISSION_REQUIRED }),
  });
  await control.start(goal);
  expect(control.getState()).toMatchObject({
    status: 'READY',
    pending: null,
    problem: { kind: 'rejected', action: 'START', reasonCode: WATCH_PERMISSION_REQUIRED },
  });
  // 권한 부족 거절은 다시 준비해 재시도하지 않는다(NOT_PREPARED·VERSION_MISMATCH만).
  expect(requests.filter(action => action === 'START')).toHaveLength(1);

  await control.startWithPhone(goal);

  expect(created[1]).toEqual({ controlDeviceId: '102', relayDeviceId: '102' });
  expect(control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'PHONE_ONLY', problem: null });
  expect(sendCommand).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('the phone choice stays: a later goal change prepares a phone-only session without the watch', async () => {
  const { control, created, prepare } = setup({ prepared: { ready: false, reasonCode: 'PREPARE_TIMEOUT' } });
  await control.start(goal);
  await control.startWithPhone(goal);
  await control.cancel();
  await control.prepare({ ...goal, targetDistanceM: 5000 });

  expect(created.at(-1)).toEqual({ controlDeviceId: '102', relayDeviceId: '102' });
  expect(prepare).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('폰으로 시작 without a location fix keeps asking for location and creates no session', async () => {
  const { control, created } = setup({
    prepared: { ready: false, reasonCode: WATCH_PERMISSION_REQUIRED },
    withLocation: false,
  });
  await control.start(goal);
  await control.startWithPhone(goal);

  expect(created).toHaveLength(1);
  expect(control.getState()).toMatchObject({ sessionId: null, problem: { kind: 'locationRequired' } });
  control.dispose();
});

test('an unconfirmed START is never dropped for the phone', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0, scenario: 'default' });
  const cancel = jest.fn(repositories.session.cancel);
  const control = createRunControl({
    session: { ...repositories.session, cancel },
    watch: { ...repositories.watchSession, sendCommand: async () => undefined },
    location,
    timers: { resultWaitMs: 50, retryDelaysMs: [0] },
  });
  await control.start(goal);
  expect(control.getState().problem).toEqual({ kind: 'unconfirmed', action: 'START' });

  await control.startWithPhone(goal);

  expect(cancel).not.toHaveBeenCalled();
  expect(control.getState()).toMatchObject({ status: 'READY', problem: { kind: 'unconfirmed', action: 'START' } });
  control.dispose();
});

test('remoteGps from a ready prepare and gps from the applied START are kept; missing values stay unknown', async () => {
  const noGps = setup({
    prepared: { ready: true, reasonCode: null, remoteGps: false },
    startResult: () => ({ result: 'APPLIED', reasonCode: null, gps: false }),
  });
  await noGps.control.prepare(goal);
  expect(noGps.control.getState().watchRemoteGps).toBe(false);
  await noGps.control.start(goal);
  expect(noGps.control.getState()).toMatchObject({ status: 'RUNNING', recordingMode: 'WATCH', watchGps: false });
  noGps.control.dispose();

  const older = setup();
  await older.control.start(goal);
  expect(older.control.getState()).toMatchObject({ status: 'RUNNING', watchRemoteGps: null, watchGps: null });
  older.control.dispose();
});

// 화면 문구(시작 화면 안내·폰으로 시작·워치 GPS 안내).
describe('screen notices', () => {
  const { remoteGpsHint, startNotice } = require('../src/screens/run/parts') as typeof import('../src/screens/run/parts');
  const { watchGpsNotice } = require('../src/screens/run/RunProgressScreen') as typeof import('../src/screens/run/RunProgressScreen');
  const permissionText = '워치에서 RunWay의 심박·활동 권한을 허용한 뒤 다시 시작해 주세요.';
  const base = {
    sessionId: '1',
    status: 'READY' as const,
    stateVersion: 1,
    startedAt: null,
    endedAt: null,
    pending: null,
    problem: null,
    joined: false,
    comparison: null,
    coaching: null,
    currentBpm: null,
    live: null,
    recordingMode: 'WATCH' as const,
    watchLost: false,
    phoneGps: null,
    approxPosition: null,
    clock: null,
    watchRemoteGps: null,
    watchGps: null,
  };

  test('the permission reason asks for watch permissions and offers 다시 시작 and 폰으로 시작', () => {
    expect(startNotice({ kind: 'watchNotReady', reasonCode: WATCH_PERMISSION_REQUIRED })).toEqual({
      text: permissionText,
      restart: true,
      phone: true,
    });
    expect(startNotice({ kind: 'rejected', action: 'START', reasonCode: WATCH_PERMISSION_REQUIRED })).toEqual({
      text: permissionText,
      restart: true,
      phone: true,
    });
    expect(startNotice({ kind: 'watchNotReady', reasonCode: 'PREPARE_TIMEOUT' })).toEqual({
      text: '워치가 준비되지 않았어요',
      restart: true,
      phone: true,
    });
    expect(startNotice({ kind: 'rejected', action: 'START', reasonCode: 'VERSION_MISMATCH' })).toMatchObject({
      text: '워치가 시작하지 못했어요',
      phone: false,
    });
    // 그룹 러닝은 워치가 필요하다(폰으로 시작 없음).
    expect(startNotice({ kind: 'watchNotReady', reasonCode: null }, false)).toMatchObject({ phone: false });
  });

  test('the remote GPS hint shows only for a ready watch session that said it cannot use GPS', () => {
    expect(remoteGpsHint({ ...base, watchRemoteGps: false })).toBe(
      '워치에서 RunWay 앱을 열어 두거나 위치 권한을 항상 허용으로 바꾸면 GPS로 속도를 잴 수 있어요.',
    );
    expect(remoteGpsHint({ ...base, watchRemoteGps: true })).toBeNull();
    expect(remoteGpsHint({ ...base, watchRemoteGps: null })).toBeNull();
    expect(remoteGpsHint({ ...base, watchRemoteGps: false, recordingMode: 'PHONE_ONLY' })).toBeNull();
    expect(remoteGpsHint({ ...base, watchRemoteGps: false, status: 'RUNNING' })).toBeNull();
  });

  test('the running screen says the watch records without GPS only when the START said so', () => {
    const running = { ...base, status: 'RUNNING' as const, startedAt: '2026-11-16T01:00:01.000Z' };
    expect(watchGpsNotice({ ...running, watchGps: false })).toBe('GPS 없이 기록 중 · 속도가 없어 AI 코칭이 제한돼요');
    expect(watchGpsNotice({ ...running, watchGps: true })).toBeNull();
    expect(watchGpsNotice({ ...running, watchGps: null })).toBeNull();
    expect(watchGpsNotice({ ...running, watchGps: false, recordingMode: 'PHONE_FALLBACK' })).toBeNull();
  });
});
