import { DataError, type PhoneFix } from '../../data';
import { payloadHash } from '../phoneBatch';
import { createPhoneRecorder } from '../phoneRecorder';

// 폰 인계 뒤 폰 GPS batch(S15P31E105-464). 합성 좌표만 쓴다.

function harness(
  upload: (body: string) => Promise<unknown>,
  options: Partial<Parameters<typeof createPhoneRecorder>[0]> = {},
) {
  const listeners = new Set<(fix: PhoneFix) => void>();
  const location = {
    start: jest.fn(async () => true),
    stop: jest.fn(async () => undefined),
    subscribe: (listener: (fix: PhoneFix) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestPermission: async () => true,
    current: async (): Promise<PhoneFix> => {
      throw new DataError('LOCATION_UNAVAILABLE', '현재 위치 없음');
    },
  };
  // Drive finishWait/retry from a test clock so suite load cannot burn the 50ms budget (S15P31E105-565).
  let fakeNow = 0;
  const sleep = async (ms: number) => {
    fakeNow += ms;
  };
  let n = 1;
  const bodies: string[] = [];
  const recorder = createPhoneRecorder({
    sessionId: '5001',
    deviceId: '102',
    location,
    upload: body => {
      bodies.push(body);
      return upload(body) as never;
    },
    newId: () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`,
    flushMs: 60_000,
    retryDelaysMs: [0],
    finishWaitMs: 50,
    finishRetryMs: 10,
    sleep,
    now: () => fakeNow,
    ...options,
  });
  const fix = (latitude: number, longitude: number, time = Date.UTC(2026, 10, 6, 1, 0, 0)) =>
    listeners.forEach(listener =>
      listener({ latitude, longitude, accuracyM: null, altitudeM: 12.345, time }),
    );
  return { recorder, location, bodies, fix };
}

const commit = async (body: string) => {
  const parsed = JSON.parse(body);
  return { status: 'COMMITTED', batchId: parsed.id, acceptedCount: parsed.items.length };
};

test('the body is a W07 batch of GPS points with a valid hash and the phone deviceId', async () => {
  const { recorder, bodies, fix } = harness(commit);
  await recorder.start();
  recorder.resume();
  fix(35.15, 129.11);

  expect(await recorder.finish()).toBe(true);

  expect(bodies).toHaveLength(1);
  // 키는 JCS 순서, ID는 숫자 토큰 그대로.
  expect(bodies[0].startsWith('{"deviceId":102,"id":"00000000-0000-4000-8000-000000000001","items":[')).toBe(true);
  const body = JSON.parse(bodies[0]);
  expect(body.items).toEqual([
    {
      type: 'GPS_POINT',
      measuredAt: '2026-11-06T01:00:00.000Z',
      coordinates: [129.11, 35.15],
      accuracyM: null,
      altitudeM: 12.35,
    },
  ]);
  expect(body.payloadHash).toBe(payloadHash(body.id, '102', '5001', body.items));
});

test('disposing during a retry delay does not upload after the run is cancelled', async () => {
  let releaseRetry!: () => void;
  let enteredRetry!: () => void;
  const waiting = new Promise<void>(resolve => {
    enteredRetry = resolve;
  });
  const { recorder, fix, bodies } = harness(() => Promise.reject(new DataError('NETWORK_ERROR', 'offline')), {
    retryDelaysMs: [0, 1000],
    sleep: () => {
      enteredRetry();
      return new Promise<void>(resolve => {
        releaseRetry = resolve;
      });
    },
  });
  await recorder.start();
  recorder.resume();
  fix(35.1, 129.1);
  recorder.pause();
  await waiting;
  recorder.dispose();
  releaseRetry();
  await recorder.finish();
  expect(bodies).toHaveLength(1);
});

test('points while paused or before resume are not recorded; invalid fixes are dropped', async () => {
  const { recorder, bodies, fix } = harness(commit);
  await recorder.start();
  fix(35.1, 129.1);
  recorder.resume();
  fix(91, 129.1);
  fix(35.2, 129.2);
  recorder.pause();
  fix(35.3, 129.3);

  await recorder.finish();

  const coordinates = bodies.flatMap(body => JSON.parse(body).items.map((i: { coordinates: number[] }) => i.coordinates));
  expect(coordinates).toEqual([[129.2, 35.2]]);
});

test('finish keeps resending the same body until COMMITTED, and gives up after the wait', async () => {
  let down = 2;
  const flaky = async (body: string) => {
    if (down-- > 0) {
      throw new DataError('NETWORK_ERROR', '응답 없음');
    }
    return commit(body);
  };
  const { recorder, bodies, fix, location } = harness(flaky);
  await recorder.start();
  recorder.resume();
  fix(35.1, 129.1);

  expect(await recorder.finish()).toBe(true);
  expect(new Set(bodies).size).toBe(1);
  expect(location.stop).toHaveBeenCalled();
  expect(recorder.openCount()).toBe(0);

  const never = harness(() => Promise.reject(new DataError('SERVER_ERROR', '장애')));
  await never.recorder.start();
  never.recorder.resume();
  never.fix(35.1, 129.1);
  expect(await never.recorder.finish()).toBe(false);
  expect(never.recorder.openCount()).toBe(1);
});

test('a batch the server refuses for good is not waited for', async () => {
  const { recorder, fix } = harness(() => Promise.reject(new DataError('INVALID_BATCH', '거절')));
  await recorder.start();
  recorder.resume();
  fix(35.1, 129.1);

  expect(await recorder.finish()).toBe(true);
});

// S15P31E105-549: in a WATCH run the recorder follows every server state change; a repeated pause must not resend.
test('a repeated pause does not resend a batch that is still unconfirmed', async () => {
  let calls = 0;
  const { recorder, fix } = harness(async () => {
    calls += 1;
    throw new DataError('UNAUTHORIZED', '로그인 필요');
  });
  await recorder.start();
  recorder.resume();
  fix(35.15, 129.11);
  recorder.pause();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  recorder.pause();
  recorder.pause();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  recorder.dispose();
});

// A-10 (S15P31E105-549 review): a quality value beyond NUMERIC(10,2) is sent as unknown, not as a refused batch.
test('accuracy or altitude beyond the DB scale is sent as null', () => {
  const { gpsItem } = jest.requireActual('../phoneBatch') as typeof import('../phoneBatch');
  expect(
    gpsItem({ latitude: 35.15, longitude: 129.11, accuracyM: 1e9, altitudeM: -2e8, time: 0 }),
  ).toMatchObject({ accuracyM: null, altitudeM: null });
});
