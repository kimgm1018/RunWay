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

  expect(native.setRunActive.mock.calls).toEqual([[true, '201'], [false, null]]);
});

test('the run notification asks for POST_NOTIFICATIONS on Android 13+ before starting', async () => {
  const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
  const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
  Object.defineProperty(Platform, 'Version', { get: () => 33, configurable: true });
  try {
    const watch = load().createNativeWatchSession({ emitter: emitter() });
    await watch.setRunActive(true, '201');

    expect(request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
    expect(native.setRunActive).toHaveBeenCalledWith(true, '201');
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
