import { DataError } from '../src/data/errors';
import type {
  BpmApproval,
  CoachingGuide,
  Repositories,
  RunningSessionView,
  SessionSnapshot,
  WatchSessionEvent,
} from '../src/data/types';
import { createRunControl } from '../src/screens/run/runControl';

// 워치 BPM·서버 코칭 중계 (S15P31E105-257): SET_BPM → P07, S10 코칭 → COACHING_GUIDE → COACHING_RESULT → P07 RESULT,
// S10 스냅샷 → STATE_RESULT(scope=SERVER), 워치 STATE_QUERY → S02.

const wait = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

function view(change: Partial<RunningSessionView> = {}): RunningSessionView {
  return {
    sessionId: '201',
    controlDeviceId: '101',
    relayDeviceId: '102',
    state: 'RUNNING',
    stateVersion: 3,
    startedAt: '2026-10-28T01:00:01Z',
    endedAt: null,
    recordingMode: 'WATCH',
    pendingCommand: null,
    lastCommand: null,
    analysisStatus: 'PENDING',
    currentBpm: 165,
    coaching: null,
    serverReceiveAt: '2026-10-28T01:01:00Z',
    serverSendAt: '2026-10-28T01:01:00.010Z',
    ...change,
  };
}

const guide: CoachingGuide = {
  commandId: '9007199254740993',
  coachingId: '701',
  expectedVersion: 3,
  targetBpm: 170,
  recommendedPaceSecPerKm: 360,
  expiresAt: '2026-10-28T01:01:20Z',
};

function setup(options: { guideAckMs?: number } = {}) {
  let current = view();
  const snapshots: { handler: ((snapshot: SessionSnapshot) => void) | null } = { handler: null };
  const unsubscribeEvents = jest.fn();
  const session = {
    create: jest.fn(),
    get: jest.fn(async () => current),
    reportPrepared: jest.fn(),
    requestControl: jest.fn(),
    reportResult: jest.fn(),
    cancel: jest.fn(),
    abortUnconfirmedStart: jest.fn(),
    uploadBatch: jest.fn(),
    requestBpm: jest.fn(
      async (_sessionId: string, request: { expectedVersion: number; targetBpm: number }): Promise<BpmApproval> => ({
        commandId: '601',
        action: 'SET_BPM',
        expectedVersion: request.expectedVersion,
        targetBpm: request.targetBpm,
        coachingId: null,
        result: 'PENDING',
      }),
    ),
    reportBpmResult: jest.fn(async (_sessionId: string, report: { commandId: string; result: string }) => {
      current = view({ stateVersion: current.stateVersion + 1, currentBpm: 172 });
      return { commandId: report.commandId, result: report.result as 'APPLIED', session: current };
    }),
    subscribeEvents: jest.fn((_sessionId: string, handlers: { onSnapshot: (snapshot: SessionSnapshot) => void }) => {
      snapshots.handler = handlers.onSnapshot;
      return unsubscribeEvents;
    }),
  };
  const listeners = new Set<(event: WatchSessionEvent) => void>();
  const watch = {
    getLinkedDevices: jest.fn(async () => ({ watchDeviceId: '101', phoneDeviceId: '102' })),
    prepare: jest.fn(),
    sendCommand: jest.fn(async () => undefined),
    sendBpmCommand: jest.fn(async () => undefined),
    sendCoachingGuide: jest.fn(async () => undefined),
    sendReceived: jest.fn(async () => undefined),
    sendServerState: jest.fn(async () => undefined),
    sendError: jest.fn(async () => undefined),
    commitBatch: jest.fn(),
    failBatch: jest.fn(),
    subscribe: (listener: (event: WatchSessionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRunActive: jest.fn(async () => undefined),
    getActiveSessionId: jest.fn(async () => null),
  };
  const control = createRunControl({
    session: session as unknown as Repositories['session'],
    watch: watch as unknown as Repositories['watchSession'],
    timers: { resultWaitMs: 200, retryDelaysMs: [0, 5, 5], guideAckMs: options.guideAckMs ?? 10_000 },
  });
  const emit = (event: WatchSessionEvent) => listeners.forEach(listener => listener(event));
  const snapshot = (next: RunningSessionView, reconnected = false) =>
    snapshots.handler?.({ event: 'SESSION_STATE', session: next, reconnected });
  const setCurrent = (next: RunningSessionView) => {
    current = next;
  };
  return { control, session, watch, emit, snapshot, setCurrent, unsubscribeEvents };
}

const coachingResult = (change: Partial<Extract<WatchSessionEvent, { type: 'COACHING_RESULT' }>> = {}) =>
  ({
    type: 'COACHING_RESULT',
    sessionId: '201',
    commandId: guide.commandId,
    coachingId: guide.coachingId,
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:05Z',
    reasonCode: null,
    ...change,
  }) as const;

test('S10 runs only while the session is active and stops on dispose', async () => {
  const { control, session, unsubscribeEvents } = setup();

  await control.attach('201');

  expect(session.subscribeEvents).toHaveBeenCalledTimes(1);
  expect(session.subscribeEvents.mock.calls[0][0]).toBe('201');
  control.dispose();
  expect(unsubscribeEvents).toHaveBeenCalledTimes(1);
});

test('watch SET_BPM goes through P07 REQUEST → APPLY → COMMAND_RESULT → P07 RESULT → COMMAND_RECEIVED', async () => {
  const { control, session, watch, emit } = setup();
  await control.attach('201');

  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 });
  await wait();

  expect(session.requestBpm).toHaveBeenCalledWith('201', { deviceId: '101', expectedVersion: 3, targetBpm: 172 });
  expect(watch.sendBpmCommand).toHaveBeenCalledWith('201', {
    commandId: '601',
    action: 'SET_BPM',
    expectedVersion: 3,
    targetBpm: 172,
    coachingId: null,
    result: 'PENDING',
  });
  expect(session.reportBpmResult).not.toHaveBeenCalled();

  emit({
    type: 'COMMAND_RESULT',
    sessionId: '201',
    commandId: '601',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:02Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  });
  await wait();

  expect(session.reportBpmResult).toHaveBeenCalledWith('201', {
    commandId: '601',
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:02Z',
    reasonCode: null,
  });
  expect(watch.sendReceived).toHaveBeenCalledWith('201', { commandId: '601', persisted: true, stateVersion: 4 });
  expect(control.getState()).toMatchObject({ stateVersion: 4, status: 'RUNNING', problem: null, pending: null });
  control.dispose();
});

test('a refused SET_BPM (409 COMMAND_PENDING) is reported to the watch as ERROR and nothing is sent to apply', async () => {
  const { control, session, watch, emit } = setup();
  session.requestBpm.mockRejectedValueOnce(new DataError('COMMAND_PENDING', 'pending', null, 409));
  await control.attach('201');

  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 });
  await wait();

  expect(session.requestBpm).toHaveBeenCalledTimes(1);
  expect(watch.sendBpmCommand).not.toHaveBeenCalled();
  expect(watch.sendError).toHaveBeenCalledWith('201', {
    code: 'COMMAND_PENDING',
    retryable: false,
    failedType: 'COMMAND_REQUEST',
  });
  control.dispose();
});

test('SET_BPM waits for a PAUSE in progress (one operation at a time)', async () => {
  const { control, session, watch, emit, setCurrent } = setup();
  session.requestControl.mockResolvedValue({ commandId: '602', action: 'PAUSE', expectedVersion: 3, result: 'PENDING' });
  session.reportResult.mockImplementation(async () => {
    const paused = view({ state: 'PAUSED', stateVersion: 4 });
    setCurrent(paused);
    return { commandId: '602', result: 'APPLIED', session: paused };
  });
  await control.attach('201');

  const pausing = control.pause();
  await wait();
  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 });
  await wait();
  expect(watch.sendCommand).toHaveBeenCalledTimes(1);
  expect(session.requestBpm).not.toHaveBeenCalled();

  emit({
    type: 'COMMAND_RESULT',
    sessionId: '201',
    commandId: '602',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:03Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  });
  await pausing;
  await wait();

  expect(session.requestBpm).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('a queued SET_BPM replaced by a newer watch request is not sent and the watch gets a retryable ERROR', async () => {
  const { control, session, watch, emit } = setup();
  session.requestControl.mockResolvedValue({ commandId: '602', action: 'PAUSE', expectedVersion: 3, result: 'PENDING' });
  await control.attach('201');

  const pausing = control.pause();
  await wait();
  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 });
  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'END', expectedVersion: 3 });
  await wait();

  expect(watch.sendError).toHaveBeenCalledWith('201', {
    code: 'COMMAND_PENDING',
    retryable: true,
    failedType: 'COMMAND_REQUEST',
  });
  expect(session.requestBpm).not.toHaveBeenCalled();
  control.dispose();
  await pausing.catch(() => undefined);
});

test('each S10 snapshot is relayed as STATE_RESULT(SERVER); a new coaching command is sent once as COACHING_GUIDE', async () => {
  const { control, watch, snapshot } = setup();
  await control.attach('201');

  const withCoaching = view({ coaching: guide });
  snapshot(withCoaching, true);
  snapshot(withCoaching);
  await wait();

  expect(watch.sendServerState).toHaveBeenCalledTimes(2);
  expect(watch.sendServerState).toHaveBeenCalledWith('201', withCoaching, null);
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(1);
  expect(watch.sendCoachingGuide).toHaveBeenCalledWith('201', guide);
  control.dispose();
});

test('COACHING_RESULT is saved with P07 RESULT and acked with COMMAND_RECEIVED; a repeat is not saved twice', async () => {
  const { control, session, watch, emit, snapshot } = setup();
  await control.attach('201');
  snapshot(view({ coaching: guide }), true);

  emit(coachingResult({ result: 'IGNORED', appliedAt: null, reasonCode: 'GUIDE_STALE' }));
  await wait();
  emit(coachingResult({ result: 'IGNORED', appliedAt: null, reasonCode: 'GUIDE_STALE' }));
  await wait();

  expect(session.reportBpmResult).toHaveBeenCalledTimes(1);
  expect(session.reportBpmResult).toHaveBeenCalledWith('201', {
    commandId: guide.commandId,
    deviceId: '101',
    result: 'IGNORED',
    appliedAt: null,
    reasonCode: 'GUIDE_STALE',
  });
  expect(watch.sendReceived.mock.calls).toEqual([
    ['201', { commandId: guide.commandId, persisted: true, stateVersion: 4 }],
    ['201', { commandId: guide.commandId, persisted: true, stateVersion: 4 }],
  ]);
  // 저장된 명령이 늦은 스냅샷에 남아 있어도 다시 보내지 않는다.
  snapshot(view({ stateVersion: 3, coaching: guide }), true);
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('an unanswered guide is sent at most 3 times, 10 s apart', async () => {
  const { control, watch, snapshot } = setup({ guideAckMs: 20 });
  await control.attach('201');

  snapshot(view({ coaching: guide }), true);
  await wait(150);
  snapshot(view({ coaching: guide }));

  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(3);
  control.dispose();
});

test('an expired unconfirmed coaching command is re-sent from pendingCommand.coachingGuide, again after a reconnect', async () => {
  const { control, watch, snapshot } = setup();
  await control.attach('201');
  const expired = view({
    coaching: null,
    pendingCommand: {
      commandId: guide.commandId,
      action: 'COACHING',
      expectedVersion: 3,
      result: 'PENDING',
      appliedAt: null,
      reasonCode: null,
      targetBpm: 170,
      coachingId: '701',
      coachingGuide: guide,
    },
  });

  snapshot(expired, true);
  snapshot(expired);
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(1);
  snapshot(expired, true);
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(2);
  expect(watch.sendCoachingGuide).toHaveBeenLastCalledWith('201', guide);
  control.dispose();
});

test('no coaching is relayed after the phone took over recording', async () => {
  const { control, watch, snapshot } = setup();
  await control.attach('201');

  snapshot(view({ recordingMode: 'PHONE_FALLBACK', coaching: guide }), true);

  expect(watch.sendServerState).toHaveBeenCalledTimes(1);
  expect(watch.sendCoachingGuide).not.toHaveBeenCalled();
  control.dispose();
});

test('STATE_QUERY(SERVER) is answered from S02 with server times and the echoed clientSendAt', async () => {
  const { control, session, watch, emit } = setup();
  await control.attach('201');
  session.get.mockClear();

  emit({ type: 'STATE_QUERY', sessionId: '201', scope: 'SERVER', clientSendAt: '2026-10-28T01:00:59.900Z' });
  await wait();

  expect(session.get).toHaveBeenCalledWith('201');
  expect(watch.sendServerState).toHaveBeenCalledWith(
    '201',
    expect.objectContaining({ serverReceiveAt: '2026-10-28T01:01:00Z', currentBpm: 165 }),
    '2026-10-28T01:00:59.900Z',
  );
  control.dispose();
});

test('a COACHING_RESULT left in the inbox before attaching is saved once the session is known', async () => {
  const { control, session, watch, emit } = setup();

  emit(coachingResult());
  expect(session.reportBpmResult).not.toHaveBeenCalled();
  await control.attach('201');
  await wait();

  expect(session.reportBpmResult).toHaveBeenCalledTimes(1);
  expect(watch.sendReceived).toHaveBeenCalledWith('201', {
    commandId: guide.commandId,
    persisted: true,
    stateVersion: 4,
  });
  control.dispose();
});

test('a COACHING_RESULT that could not be saved is asked again from the next S10 snapshot', async () => {
  const { control, session, watch, emit, snapshot } = setup();
  const offline = new DataError('NETWORK_ERROR', 'offline', null, 0);
  session.reportBpmResult
    .mockRejectedValueOnce(offline)
    .mockRejectedValueOnce(offline)
    .mockRejectedValueOnce(offline);
  await control.attach('201');
  snapshot(view({ coaching: guide }), true);

  emit(coachingResult());
  await wait(50);
  expect(session.reportBpmResult).toHaveBeenCalledTimes(3);
  expect(watch.sendReceived).not.toHaveBeenCalled();

  // 재연결이 아니어도 다음 스냅샷에서 같은 가이드를 다시 보내 워치가 보관한 결과를 다시 받는다.
  snapshot(view({ coaching: guide }));
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(2);
  emit(coachingResult());
  await wait();
  expect(session.reportBpmResult).toHaveBeenCalledTimes(4);
  expect(watch.sendReceived).toHaveBeenCalledWith('201', { commandId: guide.commandId, persisted: true, stateVersion: 4 });
  control.dispose();
});

test('a COACHING_RESULT refused for good is not asked again on every snapshot', async () => {
  const { control, session, watch, emit, snapshot } = setup();
  session.reportBpmResult.mockRejectedValueOnce(new DataError('COMMAND_CONFLICT', 'conflict', null, 409));
  await control.attach('201');
  snapshot(view({ coaching: guide }), true);

  emit(coachingResult());
  await wait();
  snapshot(view({ coaching: guide }));
  expect(watch.sendCoachingGuide).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('a late SET_BPM result that arrives while another operation runs is reported once it finishes', async () => {
  const { control, session, emit, setCurrent } = setup();
  session.requestControl.mockResolvedValue({ commandId: '602', action: 'PAUSE', expectedVersion: 3, result: 'PENDING' });
  session.reportResult.mockImplementation(async () => {
    const paused = view({ state: 'PAUSED', stateVersion: 4 });
    setCurrent(paused);
    return { commandId: '602', result: 'APPLIED', session: paused };
  });
  await control.attach('201');

  // SET_BPM 결과를 기다리다 시간 초과(200ms)로 미확인이 된다.
  emit({ type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 });
  await wait(250);
  expect(session.reportBpmResult).not.toHaveBeenCalled();

  const pausing = control.pause();
  await wait();
  const late = {
    type: 'COMMAND_RESULT',
    sessionId: '201',
    commandId: '601',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:02Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
  } as const;
  emit(late);
  await wait();
  expect(session.reportBpmResult).not.toHaveBeenCalled();

  emit({ ...late, commandId: '602', appliedAt: '2026-10-28T01:01:03Z' });
  await pausing;
  await wait();
  expect(session.reportBpmResult).toHaveBeenCalledTimes(1);
  expect(session.reportBpmResult).toHaveBeenCalledWith('201', {
    commandId: '601',
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-10-28T01:01:02Z',
    reasonCode: null,
  });
  control.dispose();
});
