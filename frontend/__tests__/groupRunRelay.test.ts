import type {
  CommandReport,
  ControlAction,
  Repositories,
  RunningSessionView,
  SessionCommand,
  SessionGoalDraft,
  SessionSnapshot,
  WatchSessionEvent,
} from '../src/data/types';
import { createRunControl } from '../src/screens/run/runControl';

// 그룹런 출발·종료 중계(S15P31E105-420): G16 READY 세션에 붙어 워치를 그룹으로 준비시키고, 서버가 직접 승인한
// G09 START와 G12 END를 S10 스냅샷에서 받아 워치에 전달한 뒤 워치의 실제 결과를 S03/S06 RESULT로 보고한다.

const wait = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));

const goal: SessionGoalDraft = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: 5000,
  targetDurationSec: null,
  targetPaceSecPerKm: 360,
};

function view(change: Partial<RunningSessionView> = {}): RunningSessionView {
  return {
    sessionId: '201',
    controlDeviceId: '101',
    relayDeviceId: '102',
    state: 'READY',
    stateVersion: 1,
    startedAt: null,
    endedAt: null,
    recordingMode: 'WATCH',
    pendingCommand: null,
    lastCommand: null,
    analysisStatus: 'PENDING',
    groupEndedAt: null,
    ...change,
  };
}

const pending = (action: string, commandId: string, expectedVersion: number): SessionCommand => ({
  commandId,
  action,
  expectedVersion,
  result: 'PENDING',
  appliedAt: null,
  reasonCode: null,
});

const result = (commandId: string, change: Partial<Extract<WatchSessionEvent, { type: 'COMMAND_RESULT' }>> = {}) =>
  ({
    type: 'COMMAND_RESULT',
    sessionId: '201',
    commandId,
    result: 'APPLIED',
    appliedAt: '2026-11-09T01:00:05Z',
    reasonCode: null,
    pendingBatchCount: null,
    uploadComplete: null,
    ...change,
  }) as const;

function setup(options: { linked?: boolean; noEvents?: boolean; groupPollMs?: number } = {}) {
  let current = view();
  const snapshots: { handler: ((snapshot: SessionSnapshot) => void) | null } = { handler: null };
  const session = {
    create: jest.fn(),
    get: jest.fn(async () => current),
    reportPrepared: jest.fn(async () => current),
    requestControl: jest.fn(),
    reportResult: jest.fn(async (_sessionId: string, action: ControlAction, report: CommandReport) => {
      current =
        action === 'START'
          ? view({ state: 'RUNNING', stateVersion: 2, startedAt: '2026-11-09T01:00:05Z' })
          : view({
              state: 'COMPLETED',
              stateVersion: 3,
              startedAt: '2026-11-09T01:00:05Z',
              endedAt: '2026-11-09T01:30:01Z',
              groupEndedAt: '2026-11-09T01:30:00Z',
            });
      return { commandId: report.commandId, result: report.result, session: current };
    }),
    cancel: jest.fn(),
    abortUnconfirmedStart: jest.fn(),
    uploadBatch: jest.fn(),
    subscribeEvents: options.noEvents
      ? undefined
      : jest.fn((_sessionId: string, handlers: { onSnapshot: (snapshot: SessionSnapshot) => void }) => {
          snapshots.handler = handlers.onSnapshot;
          return () => undefined;
        }),
  };
  const listeners = new Set<(event: WatchSessionEvent) => void>();
  const watch = {
    getLinkedDevices: jest.fn(async () =>
      options.linked === false ? null : { watchDeviceId: '101', phoneDeviceId: '102' },
    ),
    prepare: jest.fn(async (_sessionId: string, request: { stateVersion: number }) => ({
      stateVersion: request.stateVersion,
      ready: true,
      reasonCode: null,
    })),
    sendCommand: jest.fn(async () => undefined),
    sendServerEnd: jest.fn(async () => undefined),
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
    timers: {
      resultWaitMs: 200,
      endResultWaitMs: 200,
      retryDelaysMs: [0, 5, 5],
      groupPollMs: options.groupPollMs ?? 60_000,
    },
  });
  const emit = (event: WatchSessionEvent) => listeners.forEach(listener => listener(event));
  const snapshot = (next: RunningSessionView, event = 'SESSION_STATE') => {
    current = next;
    snapshots.handler?.({ event, session: next, reconnected: false });
  };
  const setCurrent = (next: RunningSessionView) => {
    current = next;
  };
  return { control, session, watch, emit, snapshot, setCurrent };
}

test('joining a group session prepares the watch with the groupRunId and asks for no START', async () => {
  const { control, session, watch } = setup();

  await control.joinGroup('201', goal, '77');

  expect(session.get).toHaveBeenCalledWith('201');
  expect(watch.prepare).toHaveBeenCalledWith('201', {
    stateVersion: 1,
    deviceId: '101',
    goal,
    groupRunId: '77',
  });
  expect(session.reportPrepared).toHaveBeenCalledWith('201', {
    deviceId: '101',
    expectedVersion: 1,
    ready: true,
    reasonCode: null,
  });
  expect(session.requestControl).not.toHaveBeenCalled();
  expect(control.getState()).toMatchObject({ sessionId: '201', status: 'READY', problem: null });
  control.dispose();
});

test('without a linked watch the group session is not prepared and the runner is told', async () => {
  const { control, watch } = setup({ linked: false });

  await control.joinGroup('201', goal, '77');

  expect(watch.prepare).not.toHaveBeenCalled();
  expect(control.getState().problem).toEqual({ kind: 'watchRequired' });
  control.dispose();
});

test("the leader's G09 START is relayed once and confirmed only by the watch's real result", async () => {
  const { control, session, watch, emit, snapshot } = setup();
  await control.joinGroup('201', goal, '77');

  snapshot(view({ pendingCommand: pending('START', '501', 1) }));
  await wait();
  // 같은 명령을 담은 스냅샷이 다시 와도 결과를 기다리는 동안 다시 보내지 않는다.
  snapshot(view({ pendingCommand: pending('START', '501', 1) }));
  await wait();

  expect(watch.sendCommand).toHaveBeenCalledTimes(1);
  expect(watch.sendCommand).toHaveBeenCalledWith('201', {
    commandId: '501',
    action: 'START',
    expectedVersion: 1,
    result: 'PENDING',
  });
  expect(session.reportResult).not.toHaveBeenCalled();
  expect(control.getState()).toMatchObject({ status: 'READY', pending: { action: 'START', commandId: '501' } });

  emit(result('501'));
  await wait();

  expect(session.reportResult).toHaveBeenCalledWith('201', 'START', {
    commandId: '501',
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-11-09T01:00:05Z',
    reasonCode: null,
  });
  expect(watch.sendReceived).toHaveBeenCalledWith('201', { commandId: '501', persisted: true, stateVersion: 2 });
  expect(control.getState()).toMatchObject({ status: 'RUNNING', pending: null, problem: null });
  control.dispose();
});

test('a pending START of a session not joined as a group is not relayed', async () => {
  const { control, watch, snapshot } = setup();
  await control.attach('201');

  snapshot(view({ pendingCommand: pending('START', '501', 1) }));
  await wait();

  expect(watch.sendCommand).not.toHaveBeenCalled();
  control.dispose();
});

test('a START is not relayed once the group has ended', async () => {
  const { control, watch, snapshot } = setup();
  await control.joinGroup('201', goal, '77');

  snapshot(view({ pendingCommand: pending('START', '501', 1), groupEndedAt: '2026-11-09T01:30:00Z' }));
  await wait();

  expect(watch.sendCommand).not.toHaveBeenCalled();
  control.dispose();
});

test("the group end (G12) is relayed as SERVER_END and the watch's END result is reported with the upload fields", async () => {
  const { control, session, watch, emit, snapshot, setCurrent } = setup();
  setCurrent(view({ state: 'RUNNING', stateVersion: 2, startedAt: '2026-11-09T01:00:05Z' }));
  await control.joinGroup('201', goal, '77');

  snapshot(
    view({
      state: 'RUNNING',
      stateVersion: 2,
      startedAt: '2026-11-09T01:00:05Z',
      pendingCommand: pending('END', '601', 2),
      groupEndedAt: '2026-11-09T01:30:00Z',
    }),
    'SERVER_END',
  );
  await wait();

  expect(watch.sendServerEnd).toHaveBeenCalledWith('201', {
    commandId: '601',
    expectedVersion: 2,
    endedAt: '2026-11-09T01:30:00Z',
    reason: 'GROUP_FORCE_FINISHED',
  });
  expect(watch.sendCommand).not.toHaveBeenCalled();

  emit(result('601', { appliedAt: '2026-11-09T01:30:01Z', pendingBatchCount: 0, uploadComplete: true }));
  await wait();

  expect(session.reportResult).toHaveBeenCalledWith('201', 'END', {
    commandId: '601',
    deviceId: '101',
    result: 'APPLIED',
    appliedAt: '2026-11-09T01:30:01Z',
    reasonCode: null,
    uploadComplete: true,
  });
  expect(control.getState()).toMatchObject({ status: 'COMPLETED', pending: null });
  control.dispose();
});

test('finishing after the group ended waits for the server END instead of asking for a new one', async () => {
  const { control, session, watch, setCurrent } = setup();
  setCurrent(
    view({
      state: 'RUNNING',
      stateVersion: 2,
      startedAt: '2026-11-09T01:00:05Z',
      groupEndedAt: '2026-11-09T01:30:00Z',
    }),
  );
  await control.joinGroup('201', goal, '77');
  setCurrent(
    view({
      state: 'RUNNING',
      stateVersion: 2,
      startedAt: '2026-11-09T01:00:05Z',
      pendingCommand: pending('END', '601', 2),
      groupEndedAt: '2026-11-09T01:30:00Z',
    }),
  );

  await control.finish();
  await wait();

  expect(session.requestControl).not.toHaveBeenCalled();
  expect(watch.sendServerEnd).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('joining again after a restart re-sends a still valid START with the same commandId', async () => {
  const { control, watch, setCurrent } = setup();
  setCurrent(view({ pendingCommand: pending('START', '501', 1) }));

  await control.joinGroup('201', goal, '77');
  await wait();

  expect(watch.sendCommand).toHaveBeenCalledWith('201', {
    commandId: '501',
    action: 'START',
    expectedVersion: 1,
    result: 'PENDING',
  });
  // 출발 명령이 이미 있으면 다시 준비시키지 않는다(준비 버전이 바뀌면 같은 START를 워치가 거절한다).
  expect(watch.prepare).not.toHaveBeenCalled();
  control.dispose();
});

test('a group cancelled before the start is reflected and told to the watch without a phone action', async () => {
  const { control, watch, snapshot } = setup();
  await control.joinGroup('201', goal, '77');

  snapshot(view({ state: 'CANCELLED', stateVersion: 2 }));
  await wait();

  expect(control.getState().status).toBe('CANCELLED');
  expect(watch.sendServerState).toHaveBeenCalledWith('201', expect.objectContaining({ state: 'CANCELLED' }), null);
  expect(watch.setRunActive).toHaveBeenLastCalledWith(false);
  control.dispose();
});

test('leaving the group reads the cancelled session and tells the watch', async () => {
  const { control, watch, setCurrent } = setup();
  await control.joinGroup('201', goal, '77');
  setCurrent(view({ state: 'CANCELLED', stateVersion: 2 }));

  await control.sync();

  expect(control.getState().status).toBe('CANCELLED');
  expect(watch.sendServerState).toHaveBeenLastCalledWith('201', expect.objectContaining({ state: 'CANCELLED' }), null);
  control.dispose();
});

test('without S10 events the group session reads S02 itself and still relays the leader start', async () => {
  // 실기기 E2E: 프록시 버퍼링으로 S10이 폰에 오지 않았다. 주기 조회만으로 G09 START를 찾아 워치에 보낸다.
  const { control, watch, emit, setCurrent } = setup({ noEvents: true, groupPollMs: 20 });
  await control.joinGroup('201', goal, '77');
  expect(watch.sendCommand).not.toHaveBeenCalled();

  setCurrent(view({ pendingCommand: pending('START', '501', 1) }));
  await wait(80);

  expect(watch.sendCommand).toHaveBeenCalledTimes(1);
  expect(watch.sendCommand).toHaveBeenCalledWith('201', {
    commandId: '501',
    action: 'START',
    expectedVersion: 1,
    result: 'PENDING',
  });
  emit(result('501'));
  await wait(40);
  expect(control.getState().status).toBe('RUNNING');
  control.dispose();
});

test('the S02 polling stops once the group session ends', async () => {
  const { control, session, setCurrent } = setup({ noEvents: true, groupPollMs: 20 });
  await control.joinGroup('201', goal, '77');
  setCurrent(view({ state: 'CANCELLED', stateVersion: 2 }));
  await wait(60);
  expect(control.getState().status).toBe('CANCELLED');
  const calls = session.get.mock.calls.length;
  await wait(80);
  expect(session.get.mock.calls.length).toBe(calls);
  control.dispose();
});
