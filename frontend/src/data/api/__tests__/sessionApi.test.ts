import { DataError } from '../../errors';
import type { ApiRequest } from '../request';
import { createApiSessionRepository } from '../sessionApi';

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
