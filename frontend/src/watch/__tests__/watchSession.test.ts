import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { WatchSessionEvent } from '../../data';

// 네이티브 WatchSession 모듈을 Repositories['watchSession']로 감싸는 계층 (작업 계획 AC-C1·C3).

type Listener = (event: string) => void;

const native = {
  send: jest.fn(),
  drainInbox: jest.fn(),
  ackInbox: jest.fn(),
  setRunActive: jest.fn(),
  getActiveSessionId: jest.fn(),
  pendingBatches: jest.fn(),
  commitBatch: jest.fn(),
  failBatch: jest.fn(),
};

function emitter() {
  let listener: Listener | null = null;
  return {
    addListener: (_name: string, fn: Listener) => {
      listener = fn;
      return { remove: () => (listener = null) };
    },
    fire: (event: object) => listener?.(JSON.stringify(event)),
  };
}

function load() {
  return require('../watchSession.android') as typeof import('../watchSession.android');
}

const result = {
  type: 'COMMAND_RESULT',
  messageId: 'w:1',
  sessionId: '201',
  payload: { commandId: '9007199254740993', result: 'APPLIED', appliedAt: '2026-10-28T01:00:01Z', reasonCode: null },
};

beforeEach(() => {
  Object.values(native).forEach(fn => fn.mockReset().mockResolvedValue(undefined));
  native.drainInbox.mockResolvedValue('[]');
  native.pendingBatches.mockResolvedValue('[]');
  native.send.mockResolvedValue('phone:1');
  (NativeModules as Record<string, unknown>).WatchSession = native;
});

afterAll(() => {
  delete (NativeModules as Record<string, unknown>).WatchSession;
});

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('subscribe drains the inbox first, delivers events and acks them', async () => {
  native.drainInbox.mockResolvedValue(JSON.stringify([result]));
  const events = emitter();
  const watch = load().createNativeWatchSession({ emitter: events });
  const received: WatchSessionEvent[] = [];

  watch.subscribe(event => received.push(event));
  await flush();
  events.fire({
    type: 'COMMAND_REQUEST',
    messageId: 'w:2',
    sessionId: '201',
    payload: { phase: 'REQUEST', action: 'CANCEL', expectedVersion: 1, targetBpm: null },
  });
  await flush();

  expect(received).toEqual([
    {
      type: 'COMMAND_RESULT',
      sessionId: '201',
      commandId: '9007199254740993',
      result: 'APPLIED',
      appliedAt: '2026-10-28T01:00:01Z',
      reasonCode: null,
      pendingBatchCount: null,
      uploadComplete: null,
    },
    { type: 'COMMAND_REQUEST', sessionId: '201', action: 'CANCEL', expectedVersion: 1 },
  ]);
  // F-2: 결과는 서버 저장 확인(persisted=true) 전까지 수신함에 남는다. 조작 요청은 전달 후 지운다.
  expect(native.ackInbox).not.toHaveBeenCalledWith(['w:1']);
  expect(native.ackInbox).toHaveBeenCalledWith(['w:2']);

  await watch.sendReceived('201', { commandId: '9007199254740993', persisted: true, stateVersion: 2 });
  await flush();
  expect(native.ackInbox).toHaveBeenCalledWith(['w:1']);
});

test('sendError reports a refused watch request on the error path', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  await watch.sendError('201', { code: 'COMMAND_PENDING', retryable: false, failedType: 'COMMAND_REQUEST' });

  expect(native.send).toHaveBeenCalledWith(
    '/runway/v1/error',
    'ERROR',
    '201',
    '{"code":"COMMAND_PENDING","retryable":false,"failedType":"COMMAND_REQUEST"}',
  );
});

test('prepare resolves on SESSION_PREPARED for the same session and times out', async () => {
  const events = emitter();
  const watch = load().createNativeWatchSession({ emitter: events, prepareTimeoutMs: 50 });
  const goal = { courseId: '7', comparisonSessionId: null, targetDistanceM: 5000, targetDurationSec: null, targetPaceSecPerKm: null };

  const preparing = watch.prepare('201', { stateVersion: 3, deviceId: '101', goal });
  await flush();
  events.fire({ type: 'SESSION_PREPARED', messageId: 'w:3', sessionId: '999', payload: { stateVersion: 3, ready: true, reasonCode: null } });
  events.fire({ type: 'SESSION_PREPARED', messageId: 'w:4', sessionId: '201', payload: { stateVersion: 3, ready: true, reasonCode: null } });

  expect(await preparing).toEqual({ stateVersion: 3, ready: true, reasonCode: null });
  const [path, type, sessionId, payload] = native.send.mock.calls[0];
  expect([path, type, sessionId]).toEqual(['/runway/v1/session/prepare', 'SESSION_PREPARE', '201']);
  expect(JSON.parse(payload)).toEqual({
    stateVersion: 3,
    deviceId: 101,
    goal: { courseId: 7, comparisonSessionId: null, targetDistanceM: 5000, targetDurationSec: null, targetPaceSecPerKm: null },
    initialBpm: null,
  });

  expect(await watch.prepare('201', { stateVersion: 4, deviceId: '101', goal })).toEqual({
    stateVersion: 4,
    ready: false,
    reasonCode: 'PREPARE_TIMEOUT',
  });
});

test('prepare without a watch device id answers not ready and sends nothing', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter(), prepareTimeoutMs: 50 });
  const goal = { courseId: null, comparisonSessionId: null, targetDistanceM: null, targetDurationSec: null, targetPaceSecPerKm: null };

  expect(await watch.prepare('201', { stateVersion: 3, deviceId: '', goal })).toEqual({
    stateVersion: 3,
    ready: false,
    reasonCode: 'DEVICE_ID_MISSING',
  });
  expect(native.send).not.toHaveBeenCalled();
});

test('sendCommand uses start-authorized for START and command(APPLY) otherwise, keeping ids exact', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  await watch.sendCommand('201', { commandId: '9007199254740993', action: 'START', expectedVersion: 1, result: 'PENDING' });
  await watch.sendCommand('201', { commandId: '502', action: 'PAUSE', expectedVersion: 2, result: 'PENDING' });

  expect(native.send.mock.calls[0].slice(0, 3)).toEqual(['/runway/v1/session/start-authorized', 'START_AUTHORIZED', '201']);
  expect(native.send.mock.calls[0][3]).toBe(
    '{"commandId":9007199254740993,"expectedVersion":1,"targetBpm":null,"coachingId":null}',
  );
  expect(native.send.mock.calls[1].slice(0, 3)).toEqual(['/runway/v1/session/command', 'COMMAND_REQUEST', '201']);
  expect(JSON.parse(native.send.mock.calls[1][3])).toEqual({
    phase: 'APPLY',
    action: 'PAUSE',
    expectedVersion: 2,
    targetBpm: null,
    commandId: 502,
    coachingId: null,
  });
});

test('sendReceived reports persisted with the saved version', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  await watch.sendReceived('201', { commandId: '501', persisted: true, stateVersion: 2 });

  expect(native.send).toHaveBeenCalledWith(
    '/runway/v1/session/command-received',
    'COMMAND_RECEIVED',
    '201',
    '{"commandId":501,"persisted":true,"stateVersion":2}',
  );
});

test('setRunActive starts and stops the run service and remembers the session', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  await watch.setRunActive(true, '201');
  await watch.setRunActive(false);

  expect(native.setRunActive.mock.calls).toEqual([[true, '201', false], [false, null, false]]);
});

test('the run notification asks for POST_NOTIFICATIONS on Android 13+ before starting', async () => {
  const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
  const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
  Object.defineProperty(Platform, 'Version', { get: () => 33, configurable: true });
  try {
    const watch = load().createNativeWatchSession({ emitter: emitter() });
    await watch.setRunActive(true, '201');

    expect(request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
    expect(native.setRunActive).toHaveBeenCalledWith(true, '201', false);
  } finally {
    request.mockRestore();
    if (version) {
      Object.defineProperty(Platform, 'Version', version);
    }
  }
});

test('getActiveSessionId reads the remembered session', async () => {
  native.getActiveSessionId.mockResolvedValue('201');
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  expect(await watch.getActiveSessionId()).toBe('201');
});

test('a SESSION_PREPARED nobody waits for is cleared from the inbox', async () => {
  native.drainInbox.mockResolvedValue(
    JSON.stringify([{ type: 'SESSION_PREPARED', messageId: 'w:9', sessionId: '201', payload: { stateVersion: 1, ready: true, reasonCode: null } }]),
  );
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  watch.subscribe(() => undefined);
  await flush();

  expect(native.ackInbox).toHaveBeenCalledWith(['w:9']);
});

test('stored and new watch batches reach the listener with their body text, and acks go to native', async () => {
  const body = '{"deviceId":101,"id":"00000000-0000-4000-8000-000000000101","items":[{}],"sessionId":201}';
  const stored = { type: 'BATCH_DATA', sessionId: '201', batchId: '00000000-0000-4000-8000-000000000101', deviceId: '101', itemCount: 1, body };
  native.pendingBatches.mockResolvedValue(JSON.stringify([stored]));
  const events = emitter();
  const watch = load().createNativeWatchSession({ emitter: events });
  const received: WatchSessionEvent[] = [];

  watch.subscribe(event => received.push(event));
  await flush();
  await flush();
  events.fire({ ...stored, batchId: '00000000-0000-4000-8000-000000000102' });

  expect(received).toEqual([
    { type: 'BATCH_DATA', sessionId: '201', batchId: '00000000-0000-4000-8000-000000000101', deviceId: '101', itemCount: 1, body },
    { type: 'BATCH_DATA', sessionId: '201', batchId: '00000000-0000-4000-8000-000000000102', deviceId: '101', itemCount: 1, body },
  ]);
  expect(native.ackInbox).not.toHaveBeenCalled();

  await watch.commitBatch('00000000-0000-4000-8000-000000000101', 1);
  await watch.failBatch('00000000-0000-4000-8000-000000000102', 'INVALID_BATCH');
  expect(native.commitBatch).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000101', 1);
  expect(native.failBatch).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000102', 'INVALID_BATCH');
});

// S15P31E105-257 워치 BPM·코칭 중계.
test('SET_BPM requests, COACHING_RESULT and STATE_QUERY reach the listener; results stay until persisted', async () => {
  const events = emitter();
  const watch = load().createNativeWatchSession({ emitter: events });
  const received: WatchSessionEvent[] = [];
  watch.subscribe(event => received.push(event));
  await flush();

  events.fire({
    type: 'COMMAND_REQUEST',
    messageId: 'w:10',
    sessionId: '201',
    payload: { phase: 'REQUEST', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 },
  });
  events.fire({
    type: 'COMMAND_REQUEST',
    messageId: 'w:11',
    sessionId: '201',
    payload: { phase: 'REQUEST', action: 'SET_BPM', expectedVersion: 3, targetBpm: 250 },
  });
  events.fire({
    type: 'COACHING_RESULT',
    messageId: 'w:12',
    sessionId: '201',
    payload: { commandId: '9007199254740993', coachingId: '701', result: 'IGNORED', appliedAt: null, reasonCode: 'GUIDE_STALE' },
  });
  events.fire({
    type: 'STATE_QUERY',
    messageId: 'w:13',
    sessionId: '201',
    payload: { scope: 'SERVER', clientSendAt: '2026-10-28T01:00:59.900Z' },
  });

  expect(received).toEqual([
    { type: 'COMMAND_REQUEST', sessionId: '201', action: 'SET_BPM', expectedVersion: 3, targetBpm: 172 },
    {
      type: 'COACHING_RESULT',
      sessionId: '201',
      commandId: '9007199254740993',
      coachingId: '701',
      result: 'IGNORED',
      appliedAt: null,
      reasonCode: 'GUIDE_STALE',
    },
    { type: 'STATE_QUERY', sessionId: '201', scope: 'SERVER', clientSendAt: '2026-10-28T01:00:59.900Z' },
  ]);
  // 범위를 벗어난 BPM 요청은 전달하지 않고 지운다. 코칭 결과는 서버 저장 확인 전까지 남긴다.
  expect(native.ackInbox).toHaveBeenCalledWith(['w:11']);
  expect(native.ackInbox).not.toHaveBeenCalledWith(['w:12']);
  await watch.sendReceived('201', { commandId: '9007199254740993', persisted: true, stateVersion: 5 });
  expect(native.ackInbox).toHaveBeenCalledWith(['w:12']);
});

test('sendBpmCommand and sendCoachingGuide keep int64 ids exact', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  await watch.sendBpmCommand('201', {
    commandId: '9007199254740993',
    action: 'SET_BPM',
    expectedVersion: 3,
    targetBpm: 172,
    coachingId: null,
    result: 'PENDING',
  });
  await watch.sendCoachingGuide('201', {
    commandId: '9007199254740995',
    coachingId: '9007199254740997',
    expectedVersion: 3,
    targetBpm: 170,
    recommendedPaceSecPerKm: 360,
    expiresAt: '2026-10-28T01:01:20Z',
  });

  expect(native.send.mock.calls[0]).toEqual([
    '/runway/v1/session/command',
    'COMMAND_REQUEST',
    '201',
    '{"phase":"APPLY","action":"SET_BPM","expectedVersion":3,"targetBpm":172,"commandId":9007199254740993,"coachingId":null}',
  ]);
  expect(native.send.mock.calls[1]).toEqual([
    '/runway/v1/coaching/guide',
    'COACHING_GUIDE',
    '201',
    '{"commandId":9007199254740995,"coachingId":9007199254740997,"expectedVersion":3,"targetBpm":170,' +
      '"recommendedPaceSecPerKm":360,"expiresAt":"2026-10-28T01:01:20Z"}',
  ]);
});

test('sendServerState carries BPM, commands with the coaching guide, server times and the echoed clientSendAt', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });
  const guide = {
    commandId: '501',
    coachingId: '701',
    expectedVersion: 3,
    targetBpm: 165,
    recommendedPaceSecPerKm: 360,
    expiresAt: '2026-10-29T01:00:20Z',
  };

  await watch.sendServerState(
    '201',
    {
      sessionId: '201',
      controlDeviceId: '101',
      relayDeviceId: '102',
      state: 'RUNNING',
      stateVersion: 3,
      startedAt: '2026-10-28T01:00:01Z',
      endedAt: null,
      recordingMode: 'WATCH',
      pendingCommand: {
        commandId: '501',
        action: 'COACHING',
        expectedVersion: 3,
        result: 'PENDING',
        appliedAt: null,
        reasonCode: null,
        targetBpm: 165,
        coachingId: '701',
        coachingGuide: guide,
      },
      lastCommand: { commandId: '500', action: 'START', expectedVersion: 1, result: 'APPLIED', appliedAt: '2026-10-28T01:00:01Z', reasonCode: null },
      analysisStatus: 'PENDING',
      currentBpm: 160,
      coaching: null,
      serverReceiveAt: '2026-10-28T01:01:00Z',
      serverSendAt: '2026-10-28T01:01:00.010Z',
    },
    '2026-10-28T01:00:59.900Z',
  );

  const [path, type, sessionId, payload] = native.send.mock.calls[0];
  expect([path, type, sessionId]).toEqual(['/runway/v1/session/state-result', 'STATE_RESULT', '201']);
  expect(JSON.parse(payload)).toEqual({
    scope: 'SERVER',
    recordingMode: 'WATCH',
    state: 'RUNNING',
    stateVersion: 3,
    currentBpm: 160,
    pendingCommand: {
      commandId: 501,
      action: 'COACHING',
      targetBpm: 165,
      expectedVersion: 3,
      coachingId: 701,
      result: 'PENDING',
      appliedAt: null,
      reasonCode: null,
      coachingGuide: { ...guide, commandId: 501, coachingId: 701 },
    },
    lastCommand: {
      commandId: 500,
      action: 'START',
      targetBpm: null,
      expectedVersion: 1,
      coachingId: null,
      result: 'APPLIED',
      appliedAt: '2026-10-28T01:00:01Z',
      reasonCode: null,
      coachingGuide: null,
    },
    pendingBatchCount: 0,
    clientSendAt: '2026-10-28T01:00:59.900Z',
    serverReceiveAt: '2026-10-28T01:01:00Z',
    serverSendAt: '2026-10-28T01:01:00.010Z',
    comparison: null,
  });
});

test('sendServerState passes the S02 record comparison to the watch as it is (S15P31E105-422)', async () => {
  const watch = load().createNativeWatchSession({ emitter: emitter() });
  const comparison = {
    status: 'AVAILABLE' as const,
    targetStartedAt: '2026-10-20T01:00:00Z',
    distanceM: 1000,
    currentElapsedSec: 280,
    pastElapsedSec: 300,
  };

  await watch.sendServerState('201', {
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
    comparison,
  });

  const payload = JSON.parse(native.send.mock.calls[0][3]);
  expect(payload.comparison).toEqual(comparison);
});

// 폰 인계(S15P31E105-464): 수신 차단은 저장 확인이 없는 batch 이벤트를 돌려주고, 위치 유형은 켤 때만 전달한다.
test('blockBatches returns the frozen batches; setRunActive passes the location type', async () => {
  const extra = native as unknown as Record<string, jest.Mock>;
  extra.blockBatches = jest.fn().mockResolvedValue(
    JSON.stringify([
      { type: 'BATCH_DATA', sessionId: '201', batchId: 'b-1', deviceId: '101', itemCount: 2, body: '{"id":"b-1"}' },
    ]),
  );
  extra.unblockBatches = jest.fn().mockResolvedValue(undefined);
  const watch = load().createNativeWatchSession({ emitter: emitter() });

  expect(await watch.blockBatches!('201')).toEqual([
    { type: 'BATCH_DATA', sessionId: '201', batchId: 'b-1', deviceId: '101', itemCount: 2, body: '{"id":"b-1"}' },
  ]);
  await watch.unblockBatches!('201');
  expect(extra.unblockBatches).toHaveBeenCalledWith('201');

  native.setRunActive.mockClear();
  await watch.setRunActive(true, '201', { location: true });
  await watch.setRunActive(false, undefined, { location: true });
  expect(native.setRunActive.mock.calls).toEqual([[true, '201', true], [false, null, false]]);
});
