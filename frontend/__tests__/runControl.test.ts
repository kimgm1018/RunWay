import { createMockRepositories, type MockScenario } from '../src/data';
import { createRunControl, type RunControl } from '../src/screens/run/runControl';

// 개인 러닝 제어: 서버 승인 → 워치 실행 → 실제 결과 저장 (작업 계획 3.1, AC-B1~B4).

const goal = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

const wait = (ms = 20) => new Promise<void>(resolve => setTimeout(resolve, ms));

function setup(scenario: MockScenario = 'default', watchLatencyMs = 0) {
  return setupWith(createMockRepositories({ latencyMs: 0, watchLatencyMs, scenario }));
}

function setupWith(repositories: ReturnType<typeof createMockRepositories>) {
  const calls = { create: 0, request: [] as string[], report: 0, received: [] as boolean[], active: [] as boolean[] };
  const session = {
    ...repositories.session,
    create: (request: Parameters<typeof repositories.session.create>[0]) => {
      calls.create += 1;
      return repositories.session.create(request);
    },
    requestControl: (...args: Parameters<typeof repositories.session.requestControl>) => {
      calls.request.push(args[1]);
      return repositories.session.requestControl(...args);
    },
    reportResult: (...args: Parameters<typeof repositories.session.reportResult>) => {
      calls.report += 1;
      return repositories.session.reportResult(...args);
    },
  };
  const watch = {
    ...repositories.watchSession,
    // 테스트가 나중에 바꿔 끼울 수 있도록 호출 시점에 위임한다.
    sendCommand: (...args: Parameters<typeof repositories.watchSession.sendCommand>) =>
      repositories.watchSession.sendCommand(...args),
    sendServerState: (...args: Parameters<typeof repositories.watchSession.sendServerState>) =>
      repositories.watchSession.sendServerState(...args),
    sendError: (...args: Parameters<typeof repositories.watchSession.sendError>) =>
      repositories.watchSession.sendError(...args),
    sendReceived: (sessionId: string, receipt: { commandId: string; persisted: boolean; stateVersion: number | null }) => {
      calls.received.push(receipt.persisted);
      return repositories.watchSession.sendReceived(sessionId, receipt);
    },
    setRunActive: (active: boolean, sessionId?: string) => {
      calls.active.push(active);
      return repositories.watchSession.setRunActive(active, sessionId);
    },
  };
  const control = createRunControl({
    session,
    watch,
    timers: { resultWaitMs: 200, endResultWaitMs: 300, retryDelaysMs: [0, 5, 5] },
  });
  return { control, calls, repositories };
}

async function started(control: RunControl) {
  await control.start(goal);
  expect(control.getState().status).toBe('RUNNING');
}

test('start goes READY → RUNNING only after the watch result is saved', async () => {
  const { control, calls } = setup('default', 50);
  const states: (string | null)[] = [];
  control.subscribe(state => states.push(`${state.status}:${state.pending?.action ?? '-'}`));

  await control.start(goal);

  const state = control.getState();
  expect(state).toMatchObject({ status: 'RUNNING', pending: null, problem: null, stateVersion: 2 });
  expect(state.startedAt).toMatch(/Z$/);
  // 시작 요청 중에는 READY로 남고, 실제 결과가 저장된 뒤에야 RUNNING이 된다.
  expect(states).toContain('READY:START');
  expect(states).not.toContain('RUNNING:START');
  expect(calls.received).toEqual([true]);
  expect(calls.active).toEqual([true]);
  control.dispose();
});

test('start twice while pending creates one session and one START', async () => {
  const { control, calls } = setup('default', 50);
  const first = control.start(goal);
  const second = control.start(goal);
  await Promise.all([first, second]);

  expect(calls.create).toBe(1);
  expect(calls.request.filter(action => action === 'START')).toHaveLength(1);
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('no linked watch stops with watchRequired and creates no session', async () => {
  const { control, calls } = setup('watchDisconnected');
  await control.start(goal);

  expect(control.getState()).toMatchObject({ sessionId: null, problem: { kind: 'watchRequired' } });
  expect(calls.create).toBe(0);
  control.dispose();
});

test('watch rejects start → problem rejected, status READY', async () => {
  const { control } = setup('watchRejectsStart');
  await control.start(goal);

  expect(control.getState()).toMatchObject({
    status: 'READY',
    stateVersion: 2,
    pending: null,
    problem: { kind: 'rejected', action: 'START', reasonCode: 'VERSION_MISMATCH' },
  });
  control.dispose();
});

test('watch silent → problem unconfirmed, nothing reported, recheck resends the same command', async () => {
  const { control, calls } = setup('watchNoResult');
  await control.start(goal);

  const state = control.getState();
  expect(state).toMatchObject({ status: 'READY', problem: { kind: 'unconfirmed', action: 'START' } });
  expect(calls.report).toBe(0);

  // 재연결한 워치는 같은 명령을 다시 받으면 보관한 결과를 보낸다(목업은 두 번째 전달에 응답).
  await control.recheck();

  expect(control.getState()).toMatchObject({ status: 'RUNNING', problem: null });
  expect(calls.request.filter(action => action === 'START')).toHaveLength(1);
  expect(calls.report).toBe(1);
  control.dispose();
});

test('abortUnconfirmedStart closes the session as INTERRUPTED and stops the run service', async () => {
  const { control, calls } = setup('watchNoResult');
  await control.start(goal);
  await control.abortUnconfirmedStart();

  expect(control.getState()).toMatchObject({ status: 'INTERRUPTED', pending: null, problem: null });
  expect(calls.active).toEqual([true, false]);
  control.dispose();
});

test('lost RESULT response is retried with the same body and confirms once', async () => {
  const { control, calls } = setup('sessionResultLost');
  await started(control);

  expect(calls.report).toBe(2);
  expect(control.getState()).toMatchObject({ stateVersion: 2, problem: null });
  control.dispose();
});

test('duplicate COMMAND_RESULT is reported once', async () => {
  const { control, calls } = setup('watchDuplicateResult');
  await started(control);
  await wait(30);

  expect(calls.report).toBe(1);
  control.dispose();
});

test('pause, resume and finish confirm PAUSED, RUNNING and COMPLETED; finish stops the run service', async () => {
  const { control, calls } = setup();
  await started(control);

  await control.pause();
  expect(control.getState()).toMatchObject({ status: 'PAUSED', stateVersion: 3 });
  await control.resume();
  expect(control.getState()).toMatchObject({ status: 'RUNNING', stateVersion: 4 });
  await control.finish();

  const state = control.getState();
  expect(state).toMatchObject({ status: 'COMPLETED', stateVersion: 5, problem: null });
  expect(Date.parse(state.endedAt!)).toBeGreaterThan(Date.parse(state.startedAt!));
  expect(calls.active).toEqual([true, false]);
  control.dispose();
});

test('finish without upload confirmation shows saveUnconfirmed', async () => {
  const { control, repositories } = setup();
  await started(control);
  // 이 시점부터 워치가 저장 확인 없이 종료를 보고한다.
  const watch = repositories.watchSession as unknown as { emit: (event: unknown) => void };
  const original = repositories.watchSession.sendCommand;
  repositories.watchSession.sendCommand = async (sessionId, approval) => {
    if (approval.action !== 'END') {
      return original(sessionId, approval);
    }
    setTimeout(
      () =>
        watch.emit({
          type: 'COMMAND_RESULT',
          sessionId,
          commandId: approval.commandId,
          result: 'APPLIED',
          appliedAt: new Date(Date.now() + 86_400_000 * 365).toISOString(),
          reasonCode: null,
          pendingBatchCount: 1,
          uploadComplete: false,
        }),
      0,
    );
  };

  await control.finish();

  expect(control.getState()).toMatchObject({
    status: 'RUNNING',
    problem: { kind: 'saveUnconfirmed', reason: 'UPLOAD_PENDING' },
  });
  control.dispose();
});

// S15P31E105-446: 마지막 batch 저장이 늦어 409 UPLOAD_PENDING을 받은 뒤, 워치가 저장을 확인하고 같은 END 결과를
// pendingBatchCount=0으로 다시 보내면 '다시 확인' 없이 COMPLETED가 된다.
test('an END result sent again after its batches were saved completes the run', async () => {
  const { control, calls, repositories } = setup();
  await started(control);
  const watch = repositories.watchSession as unknown as { emit: (event: unknown) => void };
  const original = repositories.watchSession.sendCommand;
  let endCommand: { sessionId: string; commandId: string } | null = null;
  const endResult = (pending: number) => ({
    type: 'COMMAND_RESULT',
    sessionId: endCommand!.sessionId,
    commandId: endCommand!.commandId,
    result: 'APPLIED',
    appliedAt: new Date(Date.now() + 1_000).toISOString(),
    reasonCode: null,
    pendingBatchCount: pending,
    uploadComplete: pending === 0,
  });
  repositories.watchSession.sendCommand = async (sessionId, approval) => {
    if (approval.action !== 'END') {
      return original(sessionId, approval);
    }
    endCommand = { sessionId, commandId: approval.commandId };
    setTimeout(() => watch.emit(endResult(2)), 0);
  };

  await control.finish();
  expect(control.getState()).toMatchObject({
    problem: { kind: 'saveUnconfirmed', reason: 'UPLOAD_PENDING' },
  });
  expect(calls.request.filter(action => action === 'END')).toHaveLength(1);

  watch.emit(endResult(0));
  await wait(50);

  expect(control.getState()).toMatchObject({ status: 'COMPLETED', pending: null, problem: null });
  expect(calls.request.filter(action => action === 'END')).toHaveLength(1);
  expect(calls.report).toBe(3);
  control.dispose();
});

test('no END result from the watch shows saveUnconfirmed for the missing result', async () => {
  const { control, repositories } = setup();
  await started(control);
  const original = repositories.watchSession.sendCommand;
  repositories.watchSession.sendCommand = async (sessionId, approval) => {
    if (approval.action !== 'END') {
      return original(sessionId, approval);
    }
  };

  await control.finish();

  expect(control.getState()).toMatchObject({
    status: 'RUNNING',
    problem: { kind: 'saveUnconfirmed', reason: 'NO_RESULT' },
  });
  control.dispose();
});

test('watch START_REQUEST and COMMAND_REQUEST(PAUSE) follow the same path', async () => {
  const { control: fresh, repositories: r } = setup();
  await fresh.prepare(goal);
  const sessionId = fresh.getState().sessionId!;
  const watch = r.watchSession as unknown as { emit: (event: unknown) => void };
  watch.emit({ type: 'START_REQUEST', sessionId, expectedVersion: 1 });
  await wait(200);
  expect(fresh.getState().status).toBe('RUNNING');

  watch.emit({ type: 'COMMAND_REQUEST', sessionId, action: 'PAUSE', expectedVersion: 2 });
  await wait(200);
  expect(fresh.getState().status).toBe('PAUSED');
  fresh.dispose();
});

test('watch CANCEL calls S07 and sends the server state', async () => {
  const { control, repositories } = setup();
  const sent: string[] = [];
  repositories.watchSession.sendServerState = async (_sessionId, session) => {
    sent.push(session.state);
  };
  await control.prepare(goal);
  const sessionId = control.getState().sessionId!;

  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_REQUEST',
    sessionId,
    action: 'CANCEL',
    expectedVersion: 1,
  });
  await wait(50);

  expect(control.getState().status).toBe('CANCELLED');
  expect(sent).toEqual(['CANCELLED']);
  control.dispose();
});

test('events left in the inbox before subscribe are handled after subscribe', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0 });
  const created = await repositories.session.create({ controlDeviceId: '101', relayDeviceId: '102', goal });
  const approval = await repositories.session.requestControl(created.sessionId, 'START', {
    deviceId: '101',
    expectedVersion: 1,
  });
  // 앱이 없는 동안 워치 결과가 도착해 수신함에 남았다.
  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_RESULT',
    sessionId: created.sessionId,
    commandId: approval.commandId,
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:01.000Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  });

  const control = createRunControl({
    session: repositories.session,
    watch: repositories.watchSession,
    timers: { resultWaitMs: 200, endResultWaitMs: 300, retryDelaysMs: [0, 5, 5] },
  });
  await control.attach(created.sessionId);
  await wait(50);

  expect(control.getState()).toMatchObject({ status: 'RUNNING', startedAt: '2026-10-28T01:00:01.000Z' });
  control.dispose();
});

// --- 최종 리뷰 수정(F-1~F-8) ---

test('the watch prepare result is reported to the server even when not ready', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0, scenario: 'watchNotReady' });
  const prepared: unknown[] = [];
  const session = {
    ...repositories.session,
    reportPrepared: (...args: Parameters<typeof repositories.session.reportPrepared>) => {
      prepared.push(args[1]);
      return repositories.session.reportPrepared(...args);
    },
  };
  const control = createRunControl({ session, watch: repositories.watchSession, timers: { retryDelaysMs: [0, 5, 5] } });
  await control.start(goal);

  expect(prepared).toEqual([{ deviceId: '101', expectedVersion: 1, ready: false, reasonCode: 'SENSOR_UNAVAILABLE' }]);
  expect(control.getState().problem).toEqual({ kind: 'watchNotReady', reasonCode: 'SENSOR_UNAVAILABLE' });
  control.dispose();
});

test('after an app restart, start recovers the active session and reports the stored watch result', async () => {
  const repositories = createMockRepositories({ latencyMs: 0, watchLatencyMs: 0, scenario: 'watchNoResult' });
  const timers = { resultWaitMs: 100, endResultWaitMs: 300, retryDelaysMs: [0, 5, 5] };
  const first = createRunControl({ session: repositories.session, watch: repositories.watchSession, timers });
  await first.start(goal);
  const { sessionId, pending } = first.getState();
  expect(first.getState().problem).toEqual({ kind: 'unconfirmed', action: 'START' });
  // 앱이 꺼졌다: 리스너가 없는 동안 워치 결과가 수신함에 쌓인다.
  first.dispose();
  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_RESULT',
    sessionId,
    commandId: pending!.commandId,
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:00:01.000Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  });

  const restarted = createRunControl({ session: repositories.session, watch: repositories.watchSession, timers });
  await restarted.start(goal);

  expect(restarted.getState()).toMatchObject({
    sessionId,
    status: 'RUNNING',
    startedAt: '2026-10-28T01:00:01.000Z',
    problem: null,
  });
  restarted.dispose();
});

test('starting again after a rejected start re-prepares the watch with the new version', async () => {
  const { control, calls } = setup('watchRejectsStart');
  await control.start(goal);
  expect(control.getState()).toMatchObject({ stateVersion: 2, problem: { kind: 'rejected' } });

  await control.start(goal);

  expect(control.getState()).toMatchObject({ status: 'RUNNING', stateVersion: 3, problem: null });
  expect(calls.create).toBe(1);
  control.dispose();
});

test('a different goal after a failed start cancels the leftover READY session and creates a new one', async () => {
  const { control, calls } = setup('watchRejectsStart');
  await control.start(goal);
  const leftover = control.getState().sessionId;

  await control.start({ ...goal, targetDistanceM: 3000 });

  expect(calls.create).toBe(2);
  expect(control.getState().sessionId).not.toBe(leftover);
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('a RESULT report that keeps failing is unconfirmed, and recheck reports it', async () => {
  const { control, calls } = setup('sessionResultDown');
  await control.start(goal);

  expect(control.getState()).toMatchObject({ status: 'READY', problem: { kind: 'unconfirmed', action: 'START' } });
  expect(calls.report).toBe(3);

  await control.recheck();
  expect(control.getState()).toMatchObject({ status: 'RUNNING', problem: null });
  control.dispose();
});

test('a watch CANCEL refused with COMMAND_PENDING sends ERROR to the watch, not the state', async () => {
  const { control, repositories } = setup('watchNoResult');
  const errors: unknown[] = [];
  const states: string[] = [];
  repositories.watchSession.sendError = async (_sessionId, error) => {
    errors.push(error);
  };
  repositories.watchSession.sendServerState = async (_sessionId, session) => {
    states.push(session.state);
  };
  await control.start(goal);
  const sessionId = control.getState().sessionId!;

  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_REQUEST',
    sessionId,
    action: 'CANCEL',
    expectedVersion: 1,
  });
  await wait(50);

  expect(errors).toEqual([{ code: 'COMMAND_PENDING', retryable: false, failedType: 'COMMAND_REQUEST' }]);
  expect(states).toEqual([]);
  control.dispose();
});

// --- Minor 수정(F-10·재실행 복구) ---

test('a watch request that arrives during another operation runs after it', async () => {
  const { control, repositories } = setup('default', 60);
  await started(control);
  const sessionId = control.getState().sessionId!;

  const pausing = control.pause();
  await wait(10);
  (repositories.watchSession as unknown as { emit: (event: unknown) => void }).emit({
    type: 'COMMAND_REQUEST',
    sessionId,
    action: 'END',
    expectedVersion: 3,
  });
  await pausing;
  await wait(400);

  expect(control.getState().status).toBe('COMPLETED');
  control.dispose();
});

test('the active session id is remembered while the run service is on', async () => {
  const { control, calls, repositories } = setup();
  await started(control);
  const sessionId = control.getState().sessionId;

  expect(await repositories.watchSession.getActiveSessionId()).toBe(sessionId);
  await control.finish();
  expect(await repositories.watchSession.getActiveSessionId()).toBeNull();
  expect(calls.active).toEqual([true, false]);
  control.dispose();
});


test('attaching to a running session turns the run service back on', async () => {
  const { control, calls, repositories } = setup();
  await started(control);
  const sessionId = control.getState().sessionId as string;
  control.dispose();
  calls.active.length = 0;

  const { control: relaunched, calls: after } = setupWith(repositories);
  await relaunched.attach(sessionId);

  expect(relaunched.getState().status).toBe('RUNNING');
  expect(after.active).toEqual([true]);
  relaunched.dispose();
});

test('attaching to a session that already ended stops the run service', async () => {
  const { control, repositories } = setup();
  await started(control);
  const sessionId = control.getState().sessionId as string;
  await control.finish();
  control.dispose();

  const { control: relaunched, calls: after } = setupWith(repositories);
  await relaunched.attach(sessionId);

  expect(after.active).toEqual([false]);
  relaunched.dispose();
});
