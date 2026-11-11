import type { SessionEventsStatus, SessionSnapshot } from '../../types';
import { createSessionEvents, tokenExpiresAtMs, type EventSourceFactory } from '../sessionEvents';

// S10 구독: 순서 필터·45초 감시·재접속 backoff·인증 헤더 (sessions.md S10, S15P31E105-257 D-5).

type Listener = (event: { type: string; data?: string | null; xhrStatus?: number }) => void;

class FakeSource {
  listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(public url: string, public options: Parameters<EventSourceFactory>[1]) {}
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeAllEventListeners() {
    this.listeners.clear();
  }
  close() {
    this.closed = true;
  }
  fire(type: string, event: { data?: string | null; xhrStatus?: number } = {}) {
    (this.listeners.get(type) ?? []).forEach(listener => listener({ type, ...event }));
  }
}

function snapshot(change: Record<string, unknown> = {}) {
  return JSON.stringify({
    sessionId: 201,
    controlDeviceId: 101,
    relayDeviceId: 102,
    state: 'RUNNING',
    stateVersion: 3,
    currentBpm: 165,
    startedAt: '2026-10-28T01:00:01Z',
    endedAt: null,
    recordingMode: 'WATCH',
    pendingCommand: null,
    lastCommand: null,
    analysis: { status: 'PENDING' },
    coaching: null,
    serverReceiveAt: '2026-10-28T01:01:00Z',
    serverSendAt: '2026-10-28T01:01:00.010Z',
    groupEndedAt: null,
    ...change,
  });
}

const coaching = (commandId: number, coachingId: number) => ({
  commandId,
  coachingId,
  expectedVersion: 3,
  targetBpm: 170,
  recommendedPaceSecPerKm: 360,
  expiresAt: '2026-10-28T01:01:20Z',
});

function setup(options: { token?: string | undefined; random?: number; refreshFails?: boolean; now?: number } = {}) {
  const sources: FakeSource[] = [];
  const snapshots: SessionSnapshot[] = [];
  const statuses: SessionEventsStatus[] = [];
  const unauthorized = jest.fn(async () => {
    if (options.refreshFails) {
      throw new Error('refresh failed');
    }
    token = 'access-2';
  });
  let token: string | undefined = 'token' in options ? options.token : 'access-1';
  const events = createSessionEvents({
    sessionId: '201',
    onSnapshot: next => snapshots.push(next),
    onStatus: next => statuses.push(next),
    createSource: (url, sourceOptions) => {
      const source = new FakeSource(url, sourceOptions);
      sources.push(source);
      return source;
    },
    accessToken: () => token,
    recoverUnauthorized: unauthorized,
    random: () => options.random ?? 0,
    now: () => options.now ?? 0,
  });
  const setToken = (next: string) => {
    token = next;
  };
  return { events, sources, snapshots, statuses, unauthorized, setToken, last: () => sources[sources.length - 1] };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('connects with the bearer header, no token in the URL, and the library reconnect turned off', () => {
  const { sources, events } = setup();

  expect(sources).toHaveLength(1);
  expect(sources[0].url).toBe('https://k15e105.p.ssafy.io/api/v1/running-sessions/201/events');
  expect(sources[0].url).not.toContain('access-1');
  expect(sources[0].options).toEqual({
    headers: { Authorization: 'Bearer access-1' },
    pollingInterval: 0,
    timeout: 0,
    timeoutBeforeConnection: 0,
  });
  events.stop();
  expect(sources[0].closed).toBe(true);
});

test('every event carries a full snapshot; the first after connecting is marked reconnected', () => {
  const { last, snapshots, statuses, events } = setup();

  last().fire('SESSION_STATE', { data: snapshot() });
  last().fire('COACHING_GUIDE', { data: snapshot({ coaching: coaching(501, 701) }) });
  last().fire('SERVER_END', { data: snapshot({ commandId: 600 }) });
  last().fire('ANALYSIS_STATUS', { data: 'not json' });

  expect(snapshots.map(next => [next.event, next.reconnected])).toEqual([
    ['SESSION_STATE', true],
    ['COACHING_GUIDE', false],
    ['SERVER_END', false],
  ]);
  expect(snapshots[0].session).toMatchObject({
    sessionId: '201',
    stateVersion: 3,
    currentBpm: 165,
    serverReceiveAt: '2026-10-28T01:01:00Z',
    serverSendAt: '2026-10-28T01:01:00.010Z',
    coaching: null,
  });
  expect(snapshots[1].session.coaching).toEqual({
    commandId: '501',
    coachingId: '701',
    expectedVersion: 3,
    targetBpm: 170,
    recommendedPaceSecPerKm: 360,
    expiresAt: '2026-10-28T01:01:20Z',
    // 서버가 단계를 보내지 않으면 없음(S15P31E105-579).
    coachingLevel: null,
  });
  expect(statuses).toEqual(['connected']);
  events.stop();
});

test('the coaching level is kept for the voice guide and an unknown one becomes null', () => {
  const { last, snapshots, events } = setup();

  last().fire('COACHING_GUIDE', {
    data: snapshot({ coaching: { ...coaching(501, 701), coachingLevel: 'DANGER' } }),
  });
  last().fire('COACHING_GUIDE', {
    data: snapshot({ stateVersion: 4, coaching: { ...coaching(502, 702), coachingLevel: 'PANIC' } }),
  });

  expect(snapshots.map(next => next.session.coaching?.coachingLevel)).toEqual(['DANGER', null]);
  events.stop();
});

test('older stateVersion is dropped; at the same version only a larger coachingId passes', () => {
  const { last, snapshots, events } = setup();

  last().fire('SESSION_STATE', { data: snapshot({ stateVersion: 4, coaching: coaching(502, 702) }) });
  last().fire('SESSION_STATE', { data: snapshot({ stateVersion: 3 }) });
  last().fire('COACHING_GUIDE', { data: snapshot({ stateVersion: 4, coaching: coaching(501, 701) }) });
  last().fire('COACHING_GUIDE', { data: snapshot({ stateVersion: 4, coaching: coaching(503, 703) }) });
  last().fire('SESSION_STATE', { data: snapshot({ stateVersion: 5, coaching: coaching(504, 600) }) });

  expect(snapshots.map(next => [next.session.stateVersion, next.session.coaching?.coachingId ?? null])).toEqual([
    [4, '702'],
    // 같은 버전의 더 작은 coachingId는 코칭만 비우고 상태는 전달한다(워치 STATE_RESULT용).
    [4, null],
    [4, '703'],
    // 버전이 오르면 coachingId 기준을 새로 잡는다.
    [5, '600'],
  ]);
  events.stop();
});

test('45 s without any server message marks an error, closes, and reconnects with 1 s, 2 s, 4 s backoff', () => {
  const { sources, statuses, snapshots, events } = setup();

  jest.advanceTimersByTime(44_999);
  expect(statuses).toEqual([]);
  jest.advanceTimersByTime(1);
  expect(statuses).toEqual(['error']);
  expect(sources[0].closed).toBe(true);

  jest.advanceTimersByTime(999);
  expect(sources).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(sources).toHaveLength(2);
  expect(statuses).toEqual(['error', 'connecting']);

  // 두 번째 연결도 조용하면 2초 뒤, 그다음은 4초 뒤 다시 연결한다.
  jest.advanceTimersByTime(45_000 + 2000);
  expect(sources).toHaveLength(3);
  jest.advanceTimersByTime(45_000 + 4000);
  expect(sources).toHaveLength(4);

  // 받은 메시지는 감시를 다시 시작하고 backoff를 초기화한다. 재연결 첫 스냅샷은 reconnected다.
  sources[3].fire('SESSION_STATE', { data: snapshot() });
  expect(snapshots[0].reconnected).toBe(true);
  expect(statuses[statuses.length - 1]).toBe('connected');
  jest.advanceTimersByTime(30_000);
  sources[3].fire('SESSION_STATE', { data: snapshot() });
  jest.advanceTimersByTime(30_000);
  expect(sources).toHaveLength(4);
  jest.advanceTimersByTime(15_000);
  expect(sources[3].closed).toBe(true);
  jest.advanceTimersByTime(1000);
  expect(sources).toHaveLength(5);
  events.stop();
});

test('backoff stops growing at 30 s including jitter', () => {
  const { sources, events } = setup({ random: 0.99 });

  // 1,2,4,8,16초(+jitter) 뒤 다섯 번 다시 연결하면 그다음 대기는 30초 상한이다.
  for (let index = 0; index < 5; index += 1) {
    sources[sources.length - 1].fire('error', { xhrStatus: 0 });
    jest.advanceTimersByTime(30_000);
  }
  expect(sources).toHaveLength(6);
  sources[5].fire('error', { xhrStatus: 503 });
  jest.advanceTimersByTime(29_999);
  expect(sources).toHaveLength(6);
  jest.advanceTimersByTime(1);
  expect(sources).toHaveLength(7);
  events.stop();
});

test('a stream error closes the source and retries; stop cancels the pending retry', () => {
  const { sources, statuses, events } = setup();

  sources[0].fire('error', { xhrStatus: 0 });
  expect(sources[0].closed).toBe(true);
  expect(statuses).toEqual(['error']);
  events.stop();
  jest.advanceTimersByTime(60_000);
  expect(sources).toHaveLength(1);
});

const flush = async () => {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
  }
};

test('401 refreshes the token once and reconnects with the new access token', async () => {
  const { sources, unauthorized, events } = setup();
  sources[0].fire('error', { xhrStatus: 401 });
  await flush();

  expect(unauthorized).toHaveBeenCalledTimes(1);
  expect(sources).toHaveLength(2);
  expect(sources[1].options.headers.Authorization).toBe('Bearer access-2');
  expect(events.status()).toBe('connecting');
});

test('a second 401 right after a refresh stops instead of looping; a later 401 after events refreshes again', async () => {
  const looping = setup();
  looping.sources[0].fire('error', { xhrStatus: 401 });
  await flush();
  looping.sources[1].fire('error', { xhrStatus: 401 });
  await flush();
  jest.advanceTimersByTime(120_000);
  expect(looping.unauthorized).toHaveBeenCalledTimes(1);
  expect(looping.sources).toHaveLength(2);
  expect(looping.events.status()).toBe('error');

  const recovered = setup();
  recovered.sources[0].fire('error', { xhrStatus: 401 });
  await flush();
  recovered.sources[1].fire('SESSION_STATE', { data: snapshot() });
  recovered.sources[1].fire('error', { xhrStatus: 401 });
  await flush();
  expect(recovered.unauthorized).toHaveBeenCalledTimes(2);
  expect(recovered.sources).toHaveLength(3);
});

test('a failed refresh stops for good (the http layer signs out); 404 stops without retry', async () => {
  const failing = setup({ refreshFails: true });
  failing.sources[0].fire('error', { xhrStatus: 401 });
  await flush();
  jest.advanceTimersByTime(120_000);
  expect(failing.unauthorized).toHaveBeenCalledTimes(1);
  expect(failing.sources).toHaveLength(1);
  expect(failing.events.status()).toBe('error');

  const missing = setup();
  missing.sources[0].fire('error', { xhrStatus: 404 });
  jest.advanceTimersByTime(120_000);
  expect(missing.sources).toHaveLength(1);
  expect(missing.unauthorized).not.toHaveBeenCalled();
});

test('without an access token nothing connects', () => {
  const { sources, events } = setup({ token: undefined });

  expect(sources).toHaveLength(0);
  expect(events.status()).toBe('error');
});

// 서명 없는 테스트용 JWT. exp는 초 단위. React Native 타입 정의에는 btoa가 없다.
const { btoa } = globalThis as unknown as { btoa: (data: string) => string };
const base64Url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
const jwt = (exp: number) =>
  ['{"alg":"none"}', JSON.stringify({ sub: '1', exp })].map(base64Url).join('.') + '.sig';

test('reads exp from the access token and ignores tokens that are not JWTs', () => {
  expect(tokenExpiresAtMs(jwt(1_000))).toBe(1_000_000);
  expect(tokenExpiresAtMs('access-1')).toBeNull();
  expect(tokenExpiresAtMs('a.not-base64-json.c')).toBeNull();
});

test('10 s before the token expires it refreshes and reconnects, since the server ends the stream silently', async () => {
  const { sources, unauthorized, events } = setup({ token: jwt(1_000), now: 1_000_000 - 20_000 });
  sources[0].fire('SESSION_STATE', { data: snapshot() });

  jest.advanceTimersByTime(9_999);
  expect(unauthorized).not.toHaveBeenCalled();
  expect(sources).toHaveLength(1);

  jest.advanceTimersByTime(1);
  await flush();
  expect(unauthorized).toHaveBeenCalledTimes(1);
  expect(sources[0].closed).toBe(true);
  expect(sources).toHaveLength(2);
  expect(sources[1].options.headers.Authorization).toBe('Bearer access-2');
  expect(events.status()).toBe('connecting');

  // 갱신 직후의 401도 한 번은 다시 갱신한다(미리 연결은 401 복구 횟수에 세지 않는다).
  sources[1].fire('error', { xhrStatus: 401 });
  await flush();
  expect(unauthorized).toHaveBeenCalledTimes(2);
});

test('a token already refreshed by another request is used without refreshing again', async () => {
  const { sources, unauthorized, setToken } = setup({ token: jwt(1_000), now: 1_000_000 - 20_000 });
  setToken('access-3');

  jest.advanceTimersByTime(10_000);
  await flush();
  expect(unauthorized).not.toHaveBeenCalled();
  expect(sources).toHaveLength(2);
  expect(sources[1].options.headers.Authorization).toBe('Bearer access-3');
});

test('a failed early refresh stops like a failed 401 refresh; stop cancels the early reconnect', async () => {
  const failing = setup({ token: jwt(1_000), now: 1_000_000 - 20_000, refreshFails: true });
  jest.advanceTimersByTime(10_000);
  await flush();
  jest.advanceTimersByTime(120_000);
  expect(failing.sources).toHaveLength(1);
  expect(failing.events.status()).toBe('error');

  const stopped = setup({ token: jwt(1_000), now: 1_000_000 - 20_000 });
  stopped.events.stop();
  jest.advanceTimersByTime(120_000);
  await flush();
  expect(stopped.unauthorized).not.toHaveBeenCalled();
  expect(stopped.sources).toHaveLength(1);
});
