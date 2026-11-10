import { DataError } from '../../data/errors';
import {
  chunkRecords,
  exerciseAccessNative,
  exerciseRecord,
  heartRateHistogram,
  maxBodyBytes,
  resetExerciseUploads,
  uploadSamsungExerciseLoad,
  uploadSamsungHealth,
  type ExerciseHeartRate,
  type ExerciseNative,
  type ExerciseSyncRecord,
  type ExerciseSyncRequest,
  type ExerciseUploadDeps,
} from '../samsungExerciseLoad';
import { requestSamsungAccess } from '../samsungRestingHr';
import type {
  NativeSleepAccess,
  SleepNative,
  SleepSyncRequest,
  SleepSyncResponse,
  SleepUploadDeps,
} from '../samsungSleep';
import type { ReadWindow } from '../types';

// S15P31E105-599 AC-8 (T-8). Jest runs in Asia/Seoul (jest.config.js); all heart rate values are synthetic.

const s = 1000;

describe('운동 심박 히스토그램 (plan 3.1)', () => {
  it('caps a gap at 60 s, gives the last sample 0 s, keeps the first of equal timestamps and drops out-of-range bpm', () => {
    expect(
      heartRateHistogram([
        [0, 100],
        [5 * s, 100.4],
        [10 * s, 101],
        [100 * s, 120],
        [100 * s, 150],
        [110 * s, 250],
        [111 * s, 25],
        [120 * s, 130],
      ]),
    ).toEqual([
      { bpm: 100, seconds: 10 },
      // 90 s to the next valid sample, capped at 60 s.
      { bpm: 101, seconds: 60 },
      // Out-of-range samples are not "next samples": 120 holds until 130's sample.
      { bpm: 120, seconds: 20 },
      // 130 is last: 0 s, so no bucket.
    ]);
  });

  it('sorts by time and keeps the sample that came first for a repeated timestamp', () => {
    expect(
      heartRateHistogram([
        [5 * s, 110],
        [0, 100],
        [5 * s, 150],
        [10 * s, 120],
      ]),
    ).toEqual([
      { bpm: 100, seconds: 5 },
      { bpm: 110, seconds: 5 },
    ]);
  });

  it('rounds bpm half-up and sums milliseconds per bpm before rounding to seconds', () => {
    expect(
      heartRateHistogram([
        [0, 89.5],
        [700, 90.4],
        [1_400, 91],
        [1_800, 92],
        [2_000, 30],
        [2_300, 220],
      ]),
    ).toEqual([
      // 89.5 and 90.4 → 90: 700 + 700 ms → 1 s.
      { bpm: 90, seconds: 1 },
      // 91: 400 ms → 0 s, dropped. 92: 200 ms → 0 s, dropped. 30: 300 ms → 0 s.
    ]);
    expect(
      heartRateHistogram([
        [0, 90],
        [1_499, 91],
        [1_999, 92],
      ]),
    ).toEqual([
      { bpm: 90, seconds: 1 },
      // 500 ms rounds half-up to 1 s.
      { bpm: 91, seconds: 1 },
    ]);
  });

  it('is empty without valid samples', () => {
    expect(heartRateHistogram([])).toEqual([]);
    expect(heartRateHistogram([[0, 10], [5 * s, 300]])).toEqual([]);
    expect(heartRateHistogram([[0, 100]])).toEqual([]);
  });
});

// One exercise starting at a local time, one sample every `step` seconds for `count` samples.
function exercise(
  id: string,
  start: Date,
  count = 61,
  bpm: (i: number) => number = () => 120,
  step = 10,
): ExerciseHeartRate {
  const t0 = start.getTime();
  return {
    id,
    startTime: start.toISOString(),
    endTime: new Date(t0 + (count - 1) * step * s).toISOString(),
    exerciseType: 'RUNNING',
    logs: Array.from({ length: count }, (_, i) => [t0 + i * step * s, bpm(i)]),
  };
}

describe('EXERCISE_HR_SUMMARY 레코드', () => {
  const computedAt = '2026-11-10T12:00:00.000Z';

  it('builds the record with the local start date and UTC times', () => {
    // 00:30 KST on 11.10 is still 11.09 in UTC.
    const run = exercise('uid-1-0', new Date(2026, 10, 10, 0, 30), 4);
    expect(exerciseRecord(run, computedAt)).toEqual({
      type: 'EXERCISE_HR_SUMMARY',
      exerciseId: 'uid-1-0',
      metricDate: '2026-11-10',
      startedAt: '2026-11-09T15:30:00.000Z',
      endedAt: '2026-11-09T15:30:30.000Z',
      heartRateSeconds: [{ bpm: 120, seconds: 30 }],
      computedAt,
    });
  });

  it('skips a bad id, reversed or over-24h times, no heart rate time, and more heart rate time than the exercise', () => {
    const start = new Date(2026, 10, 9, 7);
    const ok = exercise('uid-2-0', start, 4);
    expect(exerciseRecord(ok, computedAt)).not.toBeNull();
    expect(exerciseRecord({ ...ok, id: 'has space' }, computedAt)).toBeNull();
    expect(exerciseRecord({ ...ok, id: 'x'.repeat(129) }, computedAt)).toBeNull();
    expect(exerciseRecord({ ...ok, id: '' }, computedAt)).toBeNull();
    expect(
      exerciseRecord({ ...ok, endTime: new Date(start.getTime() - s).toISOString() }, computedAt),
    ).toBeNull();
    expect(
      exerciseRecord(
        { ...ok, endTime: new Date(start.getTime() + 24 * 3600 * s + s).toISOString() },
        computedAt,
      ),
    ).toBeNull();
    expect(exerciseRecord({ ...ok, logs: [] }, computedAt)).toBeNull();
    expect(exerciseRecord({ ...ok, logs: [[start.getTime(), 20]] }, computedAt)).toBeNull();
  });

  // 리뷰 B-8: logs outside the exercise are dropped, so the heart rate time never exceeds the exercise.
  it('counts only the logs inside the exercise', () => {
    const start = new Date(2026, 10, 9, 7);
    // 10 minutes of logs, 1-minute exercise: samples at 0..60 s count (the 60 s one is the last, 0 s).
    const clipped = exerciseRecord(
      {
        ...exercise('uid-3-0', start, 61, () => 120, 10),
        endTime: new Date(start.getTime() + 60 * s).toISOString(),
      },
      computedAt,
    );
    expect(clipped?.heartRateSeconds).toEqual([{ bpm: 120, seconds: 60 }]);
    // A log before the start does not count either.
    const early = exercise('uid-4-0', start, 4);
    const record = exerciseRecord(
      { ...early, logs: [[start.getTime() - 30 * s, 150], ...early.logs] },
      computedAt,
    );
    expect(record?.heartRateSeconds).toEqual([{ bpm: 120, seconds: 30 }]);
  });
});

describe('chunkRecords', () => {
  const record = (i: number, buckets: number): ExerciseSyncRecord => ({
    type: 'EXERCISE_HR_SUMMARY',
    exerciseId: `uid-${i}-0`,
    metricDate: '2026-11-09',
    startedAt: '2026-11-09T00:00:00.000Z',
    endedAt: '2026-11-09T05:00:00.000Z',
    heartRateSeconds: Array.from({ length: buckets }, (_, b) => ({ bpm: 30 + b, seconds: 60 })),
    computedAt: '2026-11-10T12:00:00.000Z',
  });

  it('keeps at most 31 records a request', () => {
    const chunks = chunkRecords(Array.from({ length: 40 }, (_, i) => record(i, 1)));
    expect(chunks.map(c => c.length)).toEqual([31, 9]);
  });

  it('keeps every body within 24 KiB', () => {
    const records = Array.from({ length: 12 }, (_, i) => record(i, 191));
    const chunks = chunkRecords(records);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(records);
    for (const chunk of chunks) {
      expect(
        JSON.stringify({ provider: 'SAMSUNG_HEALTH', records: chunk }).length,
      ).toBeLessThanOrEqual(maxBodyBytes);
    }
  });
});

function fakeExercise(
  options: {
    status?: NativeSleepAccess;
    exercises?: ExerciseHeartRate[] | (() => Promise<ExerciseHeartRate[]>);
    state?: string | null;
  } = {},
) {
  let saved: string | null = options.state ?? null;
  const native: ExerciseNative & {
    saved: () => string | null;
    read: jest.Mock<Promise<ExerciseHeartRate[]>, [ReadWindow]>;
  } = {
    status: async () => options.status ?? 'granted',
    read: jest.fn(async (_window: ReadWindow) =>
      typeof options.exercises === 'function'
        ? options.exercises()
        : options.exercises ?? [],
    ),
    loadState: async () => saved,
    saveState: async json => {
      saved = json;
      return true;
    },
    saved: () => saved,
  };
  return native;
}

const ok = (sent: number): SleepSyncResponse => ({
  acceptedCount: sent,
  duplicateCount: 0,
  rejectedCount: 0,
  errors: [],
});

describe('W06 운동 요약 업로드 (AC-8)', () => {
  const now = new Date(2026, 10, 10, 21, 0);

  function deps(
    native: ExerciseNative,
    overrides: Partial<ExerciseUploadDeps> = {},
  ): ExerciseUploadDeps & { send: jest.Mock } {
    return {
      native,
      send: jest.fn(async (body: ExerciseSyncRequest) => ok(body.records.length)),
      consent: async () => 'AGREE',
      sessionKey: () => '1',
      owner: () => '7',
      now: () => now,
      wait: jest.fn(async () => {}),
      ...overrides,
    } as ExerciseUploadDeps & { send: jest.Mock };
  }

  it('reads 28 local days first, then 7, and sends only new or changed exercises', async () => {
    let list = [
      exercise('a-0', new Date(2026, 9, 20, 7)),
      exercise('b-0', new Date(2026, 10, 9, 7)),
    ];
    const native = fakeExercise({ exercises: async () => list });
    const run = deps(native);

    expect(await uploadSamsungExerciseLoad(run)).toBe('done');
    expect(native.read.mock.calls[0][0]).toEqual({
      start: new Date(2026, 9, 14).toISOString(),
      end: now.toISOString(),
    });
    expect(run.send).toHaveBeenCalledTimes(1);
    expect(run.send.mock.calls[0][0]).toEqual({
      provider: 'SAMSUNG_HEALTH',
      records: [
        expect.objectContaining({ exerciseId: 'a-0', metricDate: '2026-10-20' }),
        expect.objectContaining({ exerciseId: 'b-0', metricDate: '2026-11-09' }),
      ],
    });

    expect(await uploadSamsungExerciseLoad(run)).toBe('nothing');
    expect(native.read.mock.calls[1][0]).toEqual({
      start: new Date(2026, 10, 4).toISOString(),
      end: now.toISOString(),
    });
    expect(run.send).toHaveBeenCalledTimes(1);

    // b-0 gets more heart rate (the watch synced later); c-0 is new.
    list = [
      exercise('b-0', new Date(2026, 10, 9, 7), 91),
      exercise('c-0', new Date(2026, 10, 10, 7)),
    ];
    expect(await uploadSamsungExerciseLoad(run)).toBe('done');
    expect(run.send).toHaveBeenCalledTimes(2);
    expect(
      run.send.mock.calls[1][0].records.map((r: ExerciseSyncRecord) => r.exerciseId),
    ).toEqual(['b-0', 'c-0']);
  });

  it('sends requests strictly one after another within the size limit', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      exercise(`m${i}-0`, new Date(2026, 10, 1 + (i % 9), 6), 1200, j => 40 + (j % 180), 3),
    );
    const native = fakeExercise({ exercises: many });
    let inFlight = 0;
    let most = 0;
    const run = deps(native, {
      send: jest.fn(async (body: ExerciseSyncRequest) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise<void>(resolve => setTimeout(resolve, 1));
        inFlight--;
        return ok(body.records.length);
      }),
    });

    expect(await uploadSamsungExerciseLoad(run)).toBe('done');
    const bodies = (run.send as jest.Mock).mock.calls.map(c => c[0] as ExerciseSyncRequest);
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.flatMap(b => b.records)).toHaveLength(12);
    bodies.forEach(body => expect(JSON.stringify(body).length).toBeLessThanOrEqual(maxBodyBytes));
    expect(most).toBe(1);
  });

  it('marks nothing when the request fails and keeps the 28-day read for the next run', async () => {
    const native = fakeExercise({ exercises: [exercise('a-0', new Date(2026, 9, 20, 7))] });
    const failing = deps(native, {
      send: jest.fn(async () => {
        throw new DataError('NETWORK_ERROR', '');
      }),
    });
    expect(await uploadSamsungExerciseLoad(failing)).toBe('retry-later');
    // Three tries, then wait for the next run.
    expect(failing.send).toHaveBeenCalledTimes(3);
    expect(native.saved() ? JSON.parse(native.saved()!).uploaded : {}).toEqual({});

    const unavailable = deps(native, {
      send: jest.fn(async () => {
        throw new DataError('UNKNOWN', '', null, 503);
      }),
    });
    expect(await uploadSamsungExerciseLoad(unavailable)).toBe('retry-later');

    const run = deps(native);
    expect(await uploadSamsungExerciseLoad(run)).toBe('done');
    expect(native.read.mock.calls[2][0].start).toBe(new Date(2026, 9, 14).toISOString());
    expect(run.send).toHaveBeenCalledTimes(1);
  });

  it('keeps earlier chunks marked when a later one fails', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      exercise(`k${i}-0`, new Date(2026, 10, 9, 0, i), 2),
    );
    const native = fakeExercise({ exercises: many });
    const run = deps(native, {
      send: jest
        .fn()
        .mockImplementationOnce(async (body: ExerciseSyncRequest) => ok(body.records.length))
        .mockRejectedValue(new DataError('UNKNOWN', '', null, 500)),
    });
    expect(await uploadSamsungExerciseLoad(run)).toBe('retry-later');
    const state = JSON.parse(native.saved()!);
    expect(Object.keys(state.uploaded)).toHaveLength(31);
    expect(state.full).toBe(false);

    const again = deps(native);
    expect(await uploadSamsungExerciseLoad(again)).toBe('done');
    expect(again.send.mock.calls[0][0].records).toHaveLength(9);
  });

  it('marks a record rejected inside a 200, but not one the server does not understand', async () => {
    const native = fakeExercise({
      exercises: [
        exercise('a-0', new Date(2026, 10, 9, 7)),
        exercise('b-0', new Date(2026, 10, 9, 8)),
      ],
    });
    const run = deps(native, {
      send: jest.fn(async () => ({
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 2,
        errors: [
          { index: 0, code: 'INVALID_RECORD', reason: 'OUT_OF_RANGE' },
          { index: 1, code: 'UNSUPPORTED_RECORD_TYPE' },
        ],
      })),
    });
    expect(await uploadSamsungExerciseLoad(run)).toBe('done');
    const state = JSON.parse(native.saved()!);
    expect(Object.keys(state.uploaded)).toEqual(['a-0']);
    // Not everything went through, so the next run still reads four weeks.
    expect(state.full).toBe(false);
  });

  it('sends nothing without exercise access or server consent, and when signed out', async () => {
    const exercises = [exercise('a-0', new Date(2026, 10, 9, 7))];
    const none = deps(fakeExercise({ status: 'required', exercises }));
    expect(await uploadSamsungExerciseLoad(none)).toBe('no-access');

    const noConsent = deps(fakeExercise({ exercises }), { consent: async () => 'DISAGREE' });
    expect(await uploadSamsungExerciseLoad(noConsent)).toBe('consent-required');
    expect(noConsent.send).not.toHaveBeenCalled();

    const signedOut = deps(fakeExercise({ exercises }), { sessionKey: () => undefined });
    expect(await uploadSamsungExerciseLoad(signedOut)).toBe('signed-out');

    const failingRead = deps(
      fakeExercise({
        exercises: async () => {
          throw { code: 'SAMSUNG_QUERY' };
        },
      }),
    );
    expect(await uploadSamsungExerciseLoad(failingRead)).toBe('retry-later');
  });

  it('does not trust another account’s marks, and a reset clears them', async () => {
    const exercises = [exercise('a-0', new Date(2026, 10, 9, 7))];
    const native = fakeExercise({ exercises });
    const run = deps(native);
    expect(await uploadSamsungExerciseLoad(run)).toBe('done');

    const other = deps(native, { owner: () => '8' });
    expect(await uploadSamsungExerciseLoad(other)).toBe('done');
    expect(native.read.mock.calls[1][0].start).toBe(new Date(2026, 9, 14).toISOString());
    expect(other.send).toHaveBeenCalledTimes(1);

    await resetExerciseUploads(native);
    expect(JSON.parse(native.saved()!)).toMatchObject({ owner: null, full: false, uploaded: {} });
  });

  // 리뷰 B-5: a phone not opened for more than a week re-reads from the day of its last complete run.
  it('reads from the last complete run when it was more than a week ago, at most 28 days', async () => {
    const state = (syncedOn: string) =>
      JSON.stringify({ requested: true, everGranted: true, owner: '7', full: true, syncedOn, uploaded: {} });
    const tenDays = fakeExercise({ exercises: [], state: state('2026-10-31') });
    expect(await uploadSamsungExerciseLoad(deps(tenDays))).toBe('nothing');
    expect(tenDays.read.mock.calls[0][0].start).toBe(new Date(2026, 9, 31).toISOString());
    expect(JSON.parse(tenDays.saved()!).syncedOn).toBe('2026-11-10');

    const longAgo = fakeExercise({ exercises: [], state: state('2026-08-01') });
    await uploadSamsungExerciseLoad(deps(longAgo));
    expect(longAgo.read.mock.calls[0][0].start).toBe(new Date(2026, 9, 14).toISOString());

    const yesterday = fakeExercise({ exercises: [], state: state('2026-11-09') });
    await uploadSamsungExerciseLoad(deps(yesterday));
    expect(yesterday.read.mock.calls[0][0].start).toBe(new Date(2026, 10, 4).toISOString());
  });

  it('keeps the last complete day when a request fails', async () => {
    const state = JSON.stringify({
      requested: true, everGranted: true, owner: '7', full: true, syncedOn: '2026-10-31', uploaded: {},
    });
    const native = fakeExercise({ exercises: [exercise('a-0', new Date(2026, 10, 9, 7))], state });
    const run = deps(native, { send: jest.fn(async () => { throw new Error('offline'); }) });
    expect(await uploadSamsungExerciseLoad(run)).toBe('retry-later');
    expect(JSON.parse(native.saved() ?? state).syncedOn).toBe('2026-10-31');
  });

  it('drops marks older than 35 days', async () => {
    const state = JSON.stringify({
      requested: true,
      everGranted: true,
      owner: '7',
      full: true,
      uploaded: {
        'old-0': { hash: 'x', date: '2026-10-01' },
        'kept-0': { hash: 'y', date: '2026-10-20' },
      },
    });
    const native = fakeExercise({ exercises: [exercise('a-0', new Date(2026, 10, 9, 7))], state });
    expect(await uploadSamsungExerciseLoad(deps(native))).toBe('done');
    expect(Object.keys(JSON.parse(native.saved()!).uploaded).sort()).toEqual(['a-0', 'kept-0']);
  });
});

describe('삼성 헬스 W06 순서와 권한', () => {
  const now = new Date(2026, 10, 10, 21, 0);

  function sleepNative(status: NativeSleepAccess = 'required') {
    let saved: string | null = null;
    const native: SleepNative & { saved: () => string | null } = {
      status: async () => status,
      request: async () => false,
      read: async () => [],
      loadState: async () => saved,
      saveState: async json => {
        saved = json;
        return true;
      },
      saved: () => saved,
    };
    return native;
  }

  it('runs the exercise upload only after the sleep/resting heart rate upload finished', async () => {
    const order: string[] = [];
    const sleep: SleepUploadDeps = {
      native: {
        ...sleepNative('granted'),
        read: async () => [
          {
            id: 's1',
            metric: 'sleep',
            startTime: new Date(2026, 10, 9, 23).toISOString(),
            endTime: new Date(2026, 10, 10, 6).toISOString(),
            source: { id: 'com.sec.android.app.shealth', name: '삼성 헬스' },
            reportedSleepMs: 400 * 60_000,
          },
        ],
      },
      send: jest.fn(async (body: SleepSyncRequest) => {
        order.push('sleep:start');
        await new Promise<void>(resolve => setTimeout(resolve, 5));
        order.push('sleep:end');
        return ok(body.records.length);
      }),
      consent: async () => 'AGREE',
      sessionKey: () => '1',
      owner: () => '7',
      now: () => now,
      wait: async () => {},
    };
    const exerciseDeps: ExerciseUploadDeps = {
      ...sleep,
      native: fakeExercise({ exercises: [exercise('a-0', new Date(2026, 10, 9, 7))] }),
      send: jest.fn(async (body: ExerciseSyncRequest) => {
        order.push('exercise');
        return ok(body.records.length);
      }),
    };
    const first = uploadSamsungHealth(sleep, exerciseDeps);
    const second = uploadSamsungHealth(sleep, exerciseDeps);
    expect(second).toBe(first);
    expect(await first).toBe('done');
    expect(order).toEqual(['sleep:start', 'sleep:end', 'exercise']);
  });

  it('records the exercise answer of the combined dialog', async () => {
    const denied = fakeExercise({ status: 'required' });
    const request = jest.fn(async () => ({ sleep: true, heartRate: true, exercise: false }));
    expect(
      await requestSamsungAccess(
        sleepNative('granted'),
        sleepNative('granted'),
        request,
        exerciseAccessNative(denied),
      ),
    ).toEqual({ sleep: 'granted', heartRate: 'granted', exercise: 'denied' });
    expect(JSON.parse(denied.saved()!)).toMatchObject({ requested: true, everGranted: false });

    const granted = fakeExercise({ status: 'granted' });
    expect(
      await requestSamsungAccess(
        sleepNative('granted'),
        sleepNative('granted'),
        async () => ({ sleep: true, heartRate: true, exercise: true }),
        exerciseAccessNative(granted),
      ),
    ).toMatchObject({ exercise: 'granted' });
    expect(JSON.parse(granted.saved()!)).toMatchObject({ requested: true, everGranted: true });
  });
});
