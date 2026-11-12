import { DataError } from '../../errors';
import type { ApiRequest } from '../request';
import { CREATE_TIMEOUT_MS, createApiSessionRepository } from '../sessionApi';

// 299의 공통 요청 함수를 주입받아 sessions.md S01~S08 계약대로 호출하는지 확인한다.

type Call = { method: string; path: string; body?: unknown };

function fake(responses: unknown[]) {
  const calls: Call[] = [];
  const request = (async (method: string, path: string, body?: unknown) => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as ApiRequest;
  return { calls, repository: createApiSessionRepository(request) };
}

const sessionResponse = {
  sessionId: 201,
  controlDeviceId: 101,
  relayDeviceId: 102,
  state: 'RUNNING',
  stateVersion: 2,
  startedAt: '2026-10-28T01:00:01Z',
  endedAt: null,
  recordingMode: 'WATCH',
  pendingCommand: null,
  lastCommand: { commandId: 501, action: 'START', expectedVersion: 1, result: 'APPLIED', appliedAt: '2026-10-28T01:00:01Z', reasonCode: null },
  analysis: { status: 'PENDING' },
};

test('S01 and S02 retain the persisted pace plan, including an absent plan', async () => {
  const plan = {
    planId: 88,
    recommendedPaceSecPerKm: 360.25,
    segments: [{ sequence: 1, startDistanceM: 0, endDistanceM: 1000, recommendedPaceSecPerKm: 355.5 }],
  };
  const { repository } = fake([{ ...sessionResponse, plan }, { ...sessionResponse, plan: null }]);
  const created = await repository.create({
    controlDeviceId: '101', relayDeviceId: '102',
    goal: { courseId: null, comparisonSessionId: null, targetDistanceM: 5000, targetDurationSec: null, targetPaceSecPerKm: null },
  });
  const fetched = await repository.get('201');
  expect(created.plan).toEqual({ ...plan, planId: '88' });
  expect(fetched.plan).toBeNull();
});

// S15P31E105-533: S01은 서버 AI 계획 상한(40초)보다 긴 상한으로 기다린다. 다른 요청은 공통 기본값을 쓴다.
test('create waits longer than the server plan deadline; other calls keep the default', async () => {
  const options: unknown[] = [];
  const request = (async (_method: string, _path: string, _body?: unknown, option?: unknown) => {
    options.push(option);
    return { id: 201, status: 'READY', stateVersion: 1 };
  }) as unknown as ApiRequest;
  const repository = createApiSessionRepository(request);
  await repository
    .create({
      controlDeviceId: '101',
      relayDeviceId: '102',
      goal: { courseId: null, comparisonSessionId: null, targetDistanceM: 5000, targetDurationSec: null, targetPaceSecPerKm: null },
    })
    .catch(() => undefined);
  await repository.get('201').catch(() => undefined);
  expect(options[0]).toEqual({ timeoutMs: CREATE_TIMEOUT_MS });
  expect(CREATE_TIMEOUT_MS).toBeGreaterThan(40_000);
  expect(options[1]).toBeUndefined();
});

test('requestControl posts the REQUEST body to the action path', async () => {
  const { calls, repository } = fake([
    { commandId: 501, action: 'PAUSE', expectedVersion: 2, targetBpm: null, coachingId: null, result: 'PENDING' },
  ]);

  const approval = await repository.requestControl('201', 'PAUSE', { deviceId: '101', expectedVersion: 2 });

  expect(calls).toEqual([
    {
      method: 'POST',
      path: '/running-sessions/201/pause',
      body: { phase: 'REQUEST', deviceId: 101, expectedVersion: 2 },
    },
  ]);
  expect(approval).toEqual({ commandId: '501', action: 'PAUSE', expectedVersion: 2, result: 'PENDING' });
});

test('reportResult keeps appliedAt and reasonCode keys when null and adds uploadComplete only for END', async () => {
  const { calls, repository } = fake([
    { commandId: 501, result: 'REJECTED', persisted: true, ...sessionResponse },
    { commandId: 502, result: 'APPLIED', persisted: true, ...sessionResponse, state: 'COMPLETED' },
  ]);

  const rejected = await repository.reportResult('201', 'START', {
    commandId: '501',
    deviceId: '101',
    result: 'REJECTED',
    appliedAt: null,
    reasonCode: null,
  });
  await repository.reportResult('201', 'END', {
    commandId: '502',
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:30:00Z',
    reasonCode: null,
    uploadComplete: true,
  });

  expect(calls[0]).toEqual({
    method: 'POST',
    path: '/running-sessions/201/start',
    body: { phase: 'RESULT', commandId: 501, deviceId: 101, result: 'REJECTED', appliedAt: null, reasonCode: null },
  });
  expect(calls[1]).toEqual({
    method: 'POST',
    path: '/running-sessions/201/finish',
    body: {
      phase: 'RESULT',
      commandId: 502,
      deviceId: 101,
      result: 'APPLIED',
      appliedAt: '2026-10-28T01:30:00Z',
      reasonCode: null,
      uploadComplete: true,
    },
  });
  expect(rejected.result).toBe('REJECTED');
  expect(rejected.session).toMatchObject({ sessionId: '201', state: 'RUNNING', stateVersion: 2, analysisStatus: 'PENDING' });
});

test('cancel posts without a body and returns the status', async () => {
  const { calls, repository } = fake([{ id: 201, status: 'CANCELLED' }]);

  expect(await repository.cancel('201')).toEqual({ id: '201', status: 'CANCELLED' });
  expect(calls).toEqual([{ method: 'POST', path: '/running-sessions/201/cancel' }]);
});

test('create, get, reportPrepared and abortUnconfirmedStart use S01, S02 and S08', async () => {
  const { calls, repository } = fake([sessionResponse, sessionResponse, { preparedVersion: 1 }, sessionResponse]);

  await repository.create({
    controlDeviceId: '101',
    relayDeviceId: '102',
    goal: { courseId: '7', comparisonSessionId: null, targetDistanceM: 5000, targetDurationSec: null, targetPaceSecPerKm: 360 },
  });
  await repository.get('201');
  await repository.reportPrepared('201', { deviceId: '101', expectedVersion: 1, ready: false, reasonCode: 'SENSOR_UNAVAILABLE' });
  await repository.abortUnconfirmedStart('201', { deviceId: '102', expectedVersion: 1 });

  expect(calls).toEqual([
    {
      method: 'POST',
      path: '/running-sessions',
      body: {
        controlDeviceId: 101,
        relayDeviceId: 102,
        courseId: 7,
        comparisonSessionId: null,
        targetDistanceM: 5000,
        targetDurationSec: null,
        targetPaceSecPerKm: 360,
      },
    },
    { method: 'GET', path: '/running-sessions/201' },
    {
      method: 'PATCH',
      path: '/running-sessions/201',
      // F-1: sessions.md S08 — REPORT_PREPARED는 ready 필수, reasonCode 키 필수.
      body: { operation: 'REPORT_PREPARED', deviceId: 101, expectedVersion: 1, ready: false, reasonCode: 'SENSOR_UNAVAILABLE' },
    },
    {
      method: 'PATCH',
      path: '/running-sessions/201',
      body: { operation: 'ABORT_UNCONFIRMED_START', deviceId: 102, expectedVersion: 1 },
    },
  ]);
});

// S15P31E105-528/643: 서버가 주는 일시정지 제외 운동시간. 없거나 이상하면 null(앱은 화면 시계로 센다).
test('the server running time is kept, and a missing or broken one is null', async () => {
  const { repository } = fake([
    { ...sessionResponse, movingDurationSec: 1080 },
    sessionResponse,
    { ...sessionResponse, movingDurationSec: -3 },
    { ...sessionResponse, movingDurationSec: '1080' },
  ]);
  expect((await repository.get('201')).movingDurationSec).toBe(1080);
  expect((await repository.get('201')).movingDurationSec).toBeNull();
  expect((await repository.get('201')).movingDurationSec).toBeNull();
  expect((await repository.get('201')).movingDurationSec).toBeNull();
});

test('ids come back as strings', async () => {
  const { repository } = fake([sessionResponse]);
  const view = await repository.get('201');

  expect(view).toMatchObject({ sessionId: '201', controlDeviceId: '101', relayDeviceId: '102' });
  expect(view.lastCommand?.commandId).toBe('501');
});

test('DataError codes from the request pass through unchanged', async () => {
  const { repository } = fake([new DataError('COMMAND_PENDING', '처리 중인 제어 명령이 있습니다.')]);

  await expect(
    repository.requestControl('201', 'START', { deviceId: '101', expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: 'COMMAND_PENDING' });
});

// P07 세션 BPM 조절 (pace-coaching.md, S15P31E105-257).
test('requestBpm sends the SET_BPM REQUEST with a null coachingId to PUT /bpm', async () => {
  const { calls, repository } = fake([
    { commandId: 601, action: 'SET_BPM', expectedVersion: 3, targetBpm: 172, coachingId: null, result: 'PENDING' },
  ]);

  const approval = await repository.requestBpm!('201', { deviceId: '101', expectedVersion: 3, targetBpm: 172 });

  expect(calls).toEqual([
    {
      method: 'PUT',
      path: '/running-sessions/201/bpm',
      body: { phase: 'REQUEST', operation: 'SET_BPM', deviceId: 101, expectedVersion: 3, targetBpm: 172, coachingId: null },
    },
  ]);
  expect(approval).toEqual({
    commandId: '601',
    action: 'SET_BPM',
    expectedVersion: 3,
    targetBpm: 172,
    coachingId: null,
    result: 'PENDING',
  });
});

test('reportBpmResult sends the RESULT with null keys and maps BPM, coaching and server times', async () => {
  const coachingGuide = {
    commandId: 501,
    coachingId: 701,
    expectedVersion: 3,
    targetBpm: 165,
    recommendedPaceSecPerKm: 360,
    expiresAt: '2026-10-29T01:00:20Z',
  };
  const { calls, repository } = fake([
    {
      commandId: 501,
      result: 'IGNORED',
      persisted: true,
      ...sessionResponse,
      stateVersion: 4,
      currentBpm: 160,
      coaching: coachingGuide,
      pendingCommand: {
        commandId: 501,
        action: 'COACHING',
        targetBpm: 165,
        expectedVersion: 3,
        coachingId: 701,
        result: 'PENDING',
        appliedAt: null,
        reasonCode: null,
        coachingGuide,
      },
      serverReceiveAt: '2026-10-28T01:01:00Z',
      serverSendAt: '2026-10-28T01:01:00.010Z',
    },
  ]);

  const saved = await repository.reportBpmResult!('201', {
    commandId: '501',
    deviceId: '101',
    result: 'IGNORED',
    appliedAt: null,
    reasonCode: 'GUIDE_STALE',
  });

  expect(calls).toEqual([
    {
      method: 'PUT',
      path: '/running-sessions/201/bpm',
      body: { phase: 'RESULT', commandId: 501, deviceId: 101, result: 'IGNORED', appliedAt: null, reasonCode: 'GUIDE_STALE' },
    },
  ]);
  const guide = { ...coachingGuide, commandId: '501', coachingId: '701' };
  expect(saved.result).toBe('IGNORED');
  expect(saved.session).toMatchObject({
    stateVersion: 4,
    currentBpm: 160,
    coaching: guide,
    serverReceiveAt: '2026-10-28T01:01:00Z',
    serverSendAt: '2026-10-28T01:01:00.010Z',
  });
  expect(saved.session.pendingCommand).toMatchObject({ targetBpm: 165, coachingId: '701', coachingGuide: guide });
  // 이전 응답처럼 새 필드가 없으면 null로 둔다.
  expect(saved.session.lastCommand).toMatchObject({ targetBpm: null, coachingId: null, coachingGuide: null });
});
