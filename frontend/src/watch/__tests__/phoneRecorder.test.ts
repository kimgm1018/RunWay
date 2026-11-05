import { DataError, type PhoneFix } from '../../data';
import { payloadHash } from '../phoneBatch';
import { createPhoneRecorder } from '../phoneRecorder';

// 폰 인계 뒤 폰 GPS batch(S15P31E105-464). 합성 좌표만 쓴다.

function harness(upload: (body: string) => Promise<unknown>) {
  const listeners = new Set<(fix: PhoneFix) => void>();
  const location = {
    start: jest.fn(async () => true),
    stop: jest.fn(async () => undefined),
    subscribe: (listener: (fix: PhoneFix) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestPermission: async () => true,
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
