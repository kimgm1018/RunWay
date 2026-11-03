import { createMockRepositories, DataError, type WatchSessionEvent } from '../src/data';

// 목업 서버·워치가 docs/design/api/sessions.md 세션 제어 공통 계약을 흉내 내는지 확인한다.

const goal = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: 5000,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

function repos(options: Parameters<typeof createMockRepositories>[0] = {}) {
  return createMockRepositories({ latencyMs: 0, watchLatencyMs: 0, ...options });
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof DataError ? error.code : 'NOT_DATA_ERROR';
  }
  return 'RESOLVED';
}

async function newSession(r: ReturnType<typeof repos>) {
  return r.session.create({ controlDeviceId: '101', relayDeviceId: '102', goal });
}

test('start approval keeps READY and result APPLIED makes RUNNING with appliedAt', async () => {
  const r = repos();
  const created = await newSession(r);
  expect(created).toMatchObject({ state: 'READY', stateVersion: 1 });

  const approval = await r.session.requestControl(created.sessionId, 'START', {
    deviceId: '101',
    expectedVersion: 1,
  });
  expect(approval).toMatchObject({ action: 'START', expectedVersion: 1, result: 'PENDING' });
  expect((await r.session.get(created.sessionId)).state).toBe('READY');

  const saved = await r.session.reportResult(created.sessionId, 'START', {
    commandId: approval.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:01.000Z',
    reasonCode: null,
  });
  expect(saved.result).toBe('APPLIED');
  expect(saved.session).toMatchObject({
    state: 'RUNNING',
    stateVersion: 2,
    startedAt: '2026-10-28T01:00:01.000Z',
  });
});

test('same slot replay returns the same commandId; other action is COMMAND_CONFLICT', async () => {
  const r = repos();
  const { sessionId } = await newSession(r);
  const first = await r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 1 });
  const again = await r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 1 });

  expect(again.commandId).toBe(first.commandId);
  expect(await code(r.session.requestControl(sessionId, 'PAUSE', { deviceId: '101', expectedVersion: 1 }))).toBe(
    'COMMAND_CONFLICT',
  );
  expect(await code(r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 2 }))).toBe(
    'STALE_STATE',
  );
});

test('UNKNOWN keeps version; same-slot request returns the stored UNKNOWN', async () => {
  const r = repos();
  const { sessionId } = await newSession(r);
  const approval = await r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 1 });
  const saved = await r.session.reportResult(sessionId, 'START', {
    commandId: approval.commandId,
    deviceId: '101',
    result: 'UNKNOWN',
    appliedAt: null,
    reasonCode: 'EXERCISE_CALL_TIMEOUT',
  });

  expect(saved.session).toMatchObject({ state: 'READY', stateVersion: 1 });
  expect(saved.session.pendingCommand?.result).toBe('UNKNOWN');
  expect(
    await r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 1 }),
  ).toMatchObject({ commandId: approval.commandId, result: 'UNKNOWN' });
});

test('END without uploadComplete is UPLOAD_PENDING; end before start is VALIDATION_ERROR', async () => {
  const r = repos();
  const { sessionId } = await newSession(r);
  const start = await r.session.requestControl(sessionId, 'START', { deviceId: '101', expectedVersion: 1 });
  await r.session.reportResult(sessionId, 'START', {
    commandId: start.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:00.000Z',
    reasonCode: null,
  });
  const end = await r.session.requestControl(sessionId, 'END', { deviceId: '101', expectedVersion: 2 });
  const report = {
    commandId: end.commandId,
    deviceId: '101',
    result: 'APPLIED' as const,
    appliedAt: '2026-10-28T01:30:00.000Z',
    reasonCode: null,
  };

  expect(await code(r.session.reportResult(sessionId, 'END', report))).toBe('UPLOAD_PENDING');
  expect(
    await code(
      r.session.reportResult(sessionId, 'END', {
        ...report,
        appliedAt: '2026-10-28T01:00:00.000Z',
        uploadComplete: true,
      }),
    ),
  ).toBe('VALIDATION_ERROR');
  const done = await r.session.reportResult(sessionId, 'END', { ...report, uploadComplete: true });
  expect(done.session).toMatchObject({ state: 'COMPLETED', stateVersion: 3 });
});

test('cancel READY → CANCELLED; pending START → COMMAND_PENDING; RUNNING → INVALID_STATE', async () => {
  const r = repos();
  const ready = await newSession(r);
  expect(await r.session.cancel(ready.sessionId)).toEqual({ id: ready.sessionId, status: 'CANCELLED' });

  const pending = await r.session.create({ controlDeviceId: '101', relayDeviceId: '102', goal });
  const start = await r.session.requestControl(pending.sessionId, 'START', {
    deviceId: '101',
    expectedVersion: 1,
  });
  expect(await code(r.session.cancel(pending.sessionId))).toBe('COMMAND_PENDING');

  await r.session.reportResult(pending.sessionId, 'START', {
    commandId: start.commandId,
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:00.000Z',
    reasonCode: null,
  });
  expect(await code(r.session.cancel(pending.sessionId))).toBe('INVALID_STATE');
});

test('a new session while one is active is ACTIVE_SESSION_EXISTS', async () => {
  const r = repos();
  await newSession(r);
  expect(await code(newSession(r))).toBe('ACTIVE_SESSION_EXISTS');
});

test('mock watch answers a command once per commandId and replays the stored result', async () => {
  const r = repos();
  const events: WatchSessionEvent[] = [];
  const stop = r.watchSession.subscribe(event => events.push(event));
  const approval = { commandId: '501', action: 'START' as const, expectedVersion: 1, result: 'PENDING' as const };
  // 워치는 준비한 버전과 승인 버전이 같을 때만 시작한다(9.4).
  await r.watchSession.prepare('9', { stateVersion: 1, deviceId: '101', goal });

  await r.watchSession.sendCommand('9', approval);
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  await r.watchSession.sendCommand('9', approval);
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  stop();

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ type: 'COMMAND_RESULT', commandId: '501', result: 'APPLIED' });
  expect(events[1]).toEqual(events[0]);
});

test('mock watch prepares, reports linked devices, and is missing when disconnected', async () => {
  const r = repos();
  expect(await r.watchSession.getLinkedDevices()).toEqual({ watchDeviceId: '101', phoneDeviceId: '102' });
  expect(await r.watchSession.prepare('9', { stateVersion: 3, deviceId: '101', goal })).toEqual({
    stateVersion: 3,
    ready: true,
    reasonCode: null,
  });
  expect(await repos({ scenario: 'watchDisconnected' }).watchSession.getLinkedDevices()).toBeNull();
});
