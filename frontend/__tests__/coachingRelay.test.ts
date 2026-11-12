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
// Waits until `done` holds (or the limit), so a busy CI agent does not fail a fixed short wait.
async function waitUntil(done: () => boolean, limitMs = 2000) {
  const until = Date.now() + limitMs;
  while (!done() && Date.now() < until) {
    await wait();
  }
}

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

function setup(
  options: {
    guideAckMs?: number;
    serverPollMs?: number;
    voice?: { enabled: () => boolean; speak: (text: string) => void; stop: () => void };
  } = {},
) {
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
    timers: {
      resultWaitMs: 200,
      retryDelaysMs: [0, 5, 5],
      guideAckMs: options.guideAckMs ?? 10_000,
      serverPollMs: options.serverPollMs ?? 60_000,
    },
    voice: options.voice,
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
  await waitUntil(() => session.reportBpmResult.mock.calls.length >= 3);
  await wait();
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

// S15P31E105-422: 기록 비교는 batch 저장마다 같은 버전의 S10 스냅샷으로 온다. 앱은 그대로 보관하고 같은 값을 워치에 넘긴다.
test('S10 record comparison updates the run state at the same version and reaches the watch unchanged', async () => {
  const { control, watch, snapshot } = setup();
  await control.attach('201');
  expect(control.getState().comparison).toBeNull();

  const comparison = {
    status: 'AVAILABLE' as const,
    targetStartedAt: '2026-10-20T01:00:00Z',
    distanceM: 1000,
    currentElapsedSec: 280,
    pastElapsedSec: 300,
  };
  snapshot(view({ comparison }));
  await wait();

  expect(control.getState().comparison).toEqual(comparison);
  expect(watch.sendServerState).toHaveBeenLastCalledWith('201', expect.objectContaining({ comparison }), null);

  // 더 오래된 버전의 스냅샷은 비교 값을 되돌리지 않는다.
  snapshot(view({ stateVersion: 2, comparison: { ...comparison, status: 'WAITING', distanceM: null } }));
  await wait();
  expect(control.getState().comparison).toEqual(comparison);
});

// ── 코칭 음성 안내(S15P31E105-579): 워치가 적용한 코칭만, 폰 기록이면 새로 받은 코칭을 읽는다.
function voiceSetup(enabled = true) {
  const voice = { enabled: jest.fn(() => enabled), speak: jest.fn(), stop: jest.fn() };
  return { voice, ...setup({ voice }) };
}

const coachingAt = (
  commandId: string,
  pace: number,
  level: 'OK' | 'CAUTION' | 'DANGER' | null,
): CoachingGuide => ({ ...guide, commandId, recommendedPaceSecPerKm: pace, coachingLevel: level });

test('a coaching the watch applied is read; the first one, a repeat and an ignored one are not', async () => {
  const { control, voice, snapshot, emit } = voiceSetup();
  await control.attach('201');

  const first = coachingAt('801', 360, 'OK');
  snapshot(view({ coaching: first }));
  emit(coachingResult({ commandId: '801' }));
  await wait();
  expect(voice.speak).not.toHaveBeenCalled();

  const slower = coachingAt('802', 370, 'CAUTION');
  snapshot(view({ stateVersion: 5, coaching: slower }));
  // 워치가 적용하기 전에는 읽지 않는다.
  expect(voice.speak).not.toHaveBeenCalled();
  emit(coachingResult({ commandId: '802' }));
  await wait();
  expect(voice.speak).toHaveBeenCalledTimes(1);
  expect(voice.speak).toHaveBeenCalledWith('심박이 오르고 있어요. 6분 10초 페이스로 늦춰 주세요.');

  // 같은 결과가 다시 와도 한 번만 읽는다.
  emit(coachingResult({ commandId: '802' }));
  // 워치가 적용하지 않은 코칭은 읽지 않는다.
  snapshot(view({ stateVersion: 7, coaching: coachingAt('803', 400, 'DANGER') }));
  emit(coachingResult({ commandId: '803', result: 'IGNORED', appliedAt: null }));
  await wait();
  expect(voice.speak).toHaveBeenCalledTimes(1);
  control.dispose();
});

test('with the voice setting off a coaching is applied but not read', async () => {
  const { control, voice, snapshot, emit, session } = voiceSetup(false);
  await control.attach('201');
  snapshot(view({ coaching: coachingAt('811', 360, 'OK') }));
  emit(coachingResult({ commandId: '811' }));
  snapshot(view({ stateVersion: 5, coaching: coachingAt('812', 400, 'DANGER') }));
  emit(coachingResult({ commandId: '812' }));
  await wait();
  expect(voice.speak).not.toHaveBeenCalled();
  // 결과 저장(P07)은 그대로 한다.
  expect(session.reportBpmResult).toHaveBeenCalledTimes(2);
  control.dispose();
});

test('recording on the phone reads a new coaching without a watch result', async () => {
  const { control, voice, snapshot, watch } = voiceSetup();
  await control.attach('201');
  snapshot(view({ recordingMode: 'PHONE_FALLBACK', coaching: coachingAt('821', 360, 'CAUTION') }));
  snapshot(view({ recordingMode: 'PHONE_FALLBACK', stateVersion: 5, coaching: coachingAt('822', 340, 'OK') }));
  // 같은 코칭이 다음 스냅샷에 다시 와도 한 번만 읽는다.
  snapshot(view({ recordingMode: 'PHONE_FALLBACK', stateVersion: 6, coaching: coachingAt('822', 340, 'OK') }));
  await wait();
  expect(watch.sendCoachingGuide).not.toHaveBeenCalled();
  expect(voice.speak).toHaveBeenCalledTimes(1);
  expect(voice.speak).toHaveBeenCalledWith('여유가 있어요. 5분 40초 페이스로 올려도 좋아요.');
  control.dispose();
});

test('a paused run is not read to and pausing or disposing stops the voice', async () => {
  const { control, voice, snapshot, emit, setCurrent } = voiceSetup();
  await control.attach('201');
  snapshot(view({ coaching: coachingAt('831', 360, 'OK') }));
  emit(coachingResult({ commandId: '831' }));
  await wait();

  setCurrent(view({ state: 'PAUSED', stateVersion: 10 }));
  await control.sync();
  expect(control.getState().status).toBe('PAUSED');
  expect(voice.stop).toHaveBeenCalledTimes(1);
  snapshot(view({ state: 'PAUSED', stateVersion: 10, coaching: coachingAt('832', 400, 'DANGER') }));
  emit(coachingResult({ commandId: '832' }));
  await wait();
  expect(voice.speak).not.toHaveBeenCalled();

  setCurrent(view({ state: 'RUNNING', stateVersion: 12 }));
  await control.sync();
  control.dispose();
  expect(voice.stop).toHaveBeenCalledTimes(2);
});

// S15P31E105-549 실기기 확인: S10이 폰에 오지 않으면 서버가 만든 코칭 명령이 같은 버전 자리를 차지해 일시정지가
// 409 COMMAND_CONFLICT로 막혔다. 개인 러닝도 S02를 주기적으로 읽어 코칭을 전달하고, 막히면 바로 다시 읽는다.
const pendingCoaching = () =>
  view({
    pendingCommand: {
      commandId: guide.commandId,
      action: 'COACHING',
      expectedVersion: 3,
      result: 'PENDING',
      appliedAt: null,
      reasonCode: null,
      coachingId: guide.coachingId,
      coachingGuide: guide,
    },
  });

test('without any S10 event a running personal run reads S02 and relays the pending coaching to the watch', async () => {
  const { control, session, watch, setCurrent } = setup({ serverPollMs: 20 });
  await control.attach('201');
  setCurrent(pendingCoaching());
  await wait(80);
  expect(session.get.mock.calls.length).toBeGreaterThan(1);
  expect(watch.sendCoachingGuide).toHaveBeenCalledWith('201', guide);
  control.dispose();
});

test('a pause refused with COMMAND_CONFLICT reads S02 at once and relays the coaching holding the slot', async () => {
  const { control, session, watch, setCurrent } = setup();
  await control.attach('201');
  setCurrent(pendingCoaching());
  session.requestControl.mockRejectedValueOnce(
    new DataError('COMMAND_CONFLICT', '같은 제어 요청에 다른 내용이 이미 처리되었습니다.'),
  );
  await control.pause();
  expect(control.getState().problem).toEqual({ kind: 'error', code: 'COMMAND_CONFLICT' });
  expect(watch.sendCoachingGuide).toHaveBeenCalledWith('201', guide);
  control.dispose();
});

// S15P31E105-528: S02·S10에 서버 운동시간이 오면 운동 시간의 기준점으로 둔다. 없으면 null(화면 시계).
test('the server running time from S02 and S10 becomes the clock base', async () => {
  const { control, snapshot, setCurrent } = setup();
  setCurrent(view({ movingDurationSec: 600 }));
  await control.attach('201');
  expect(control.getState().clock).toMatchObject({ movingSec: 600, running: true });

  snapshot(view({ stateVersion: 4, state: 'PAUSED', movingDurationSec: 630 }));
  expect(control.getState().clock).toMatchObject({ movingSec: 630, running: false });
  // 더 오래된 버전의 스냅샷으로는 되돌리지 않는다.
  snapshot(view({ stateVersion: 2, movingDurationSec: 100 }));
  expect(control.getState().clock).toMatchObject({ movingSec: 630 });
  snapshot(view({ stateVersion: 5 }));
  expect(control.getState().clock).toBeNull();
  control.dispose();
});
