import {
  dailyRestingHr,
  minValidMinutes,
  readTodayRestingHr,
  requestSamsungAccess,
  restingHrWindow,
} from '../samsungRestingHr';
import {
  checkSleepAccess,
  resetSleepUploads,
  uploadSamsungSleep,
  type NativeSleepAccess,
  type SleepNative,
  type SleepSyncRequest,
  type SleepSyncResponse,
  type SleepUploadDeps,
} from '../samsungSleep';
import type { HealthRecord } from '../types';

// S15P31E105-600. Jest runs in Asia/Seoul (jest.config.js); all heart rate values are synthetic.

const at = (day: number, hour: number, minute = 0, second = 0) =>
  new Date(2026, 10, day, hour, minute, second).toISOString();

function hr(id: string, start: string, value: number): HealthRecord {
  return {
    id,
    metric: 'heartRate',
    startTime: start,
    endTime: start,
    value,
    unit: 'bpm',
    source: { id: 'com.sec.android.wear', name: 'Galaxy Watch' },
  };
}

// `count` one-minute samples on a day from 01:00, bpm from `values` in turn.
function minutes(day: number, count: number, values: number[], prefix = `d${day}`) {
  return Array.from({ length: count }, (_, i) =>
    hr(`${prefix}-${i}`, at(day, 1, i), values[i % values.length]),
  );
}

function fakeNative(
  options: {
    status?: NativeSleepAccess;
    records?: HealthRecord[] | (() => Promise<HealthRecord[]>);
    state?: string | null;
  } = {},
) {
  let saved: string | null = options.state ?? null;
  const native: SleepNative & { saved: () => string | null } = {
    status: async () => options.status ?? 'granted',
    request: jest.fn(async () => true),
    read: jest.fn(async () =>
      typeof options.records === 'function'
        ? options.records()
        : options.records ?? [],
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

describe('폰 일별 RHR 계산 (AC-1)', () => {
  const now = new Date(2026, 10, 9, 21, 0);
  const window = restingHrWindow(now);

  it('averages the lowest ceil(10%) minute means, rounded half-up to one decimal', () => {
    // 40 minutes: four at 50, 51, 52, 53 bpm and the rest at 70 → lowest ceil(4.0)=4 → 51.5.
    const records = minutes(9, 40, [50, 51, 52, 53, 70, 70, 70, 70, 70, 70]).map(
      (r, i) => ({ ...r, value: i < 4 ? 50 + i : 70 }),
    );
    expect(dailyRestingHr(records, window)).toEqual({
      days: [{ date: '2026-11-09', bpm: 51.5, minutes: 40 }],
      insufficient: [],
    });
  });

  it('uses ceil for the lowest share: 31 minutes take the lowest 4', () => {
    const records = minutes(9, 31, [80]).map((r, i) => ({
      ...r,
      value: i < 4 ? [55, 56, 57, 58][i] : 80,
    }));
    expect(dailyRestingHr(records, window).days[0].bpm).toBe(56.5);
  });

  it('rounds half-up to one decimal (리뷰 A-3)', () => {
    // 40 minutes, lowest 4: 57, 57, 57.5, 57.5 → 57.25 → 57.3; 57, 57, 57, 57.2 → 57.05 → 57.1.
    const lowest = (values: number[]) =>
      minutes(9, 40, [80]).map((r, i) => ({ ...r, value: i < 4 ? values[i] : 80 }));
    expect(dailyRestingHr(lowest([57, 57, 57.5, 57.5]), window).days[0].bpm).toBe(57.3);
    expect(dailyRestingHr(lowest([57, 57, 57, 57.2]), window).days[0].bpm).toBe(57.1);
    expect(dailyRestingHr(lowest([57, 57, 57, 57.16]), window).days[0].bpm).toBe(57);
  });

  it('averages samples in the same minute before ranking', () => {
    const base = minutes(9, 30, [60]);
    // Minute 0 gets 40 and 50 → one minute mean of 45, not two values.
    const records = [
      ...base.slice(1),
      hr('a', at(9, 1, 0, 5), 40),
      hr('b', at(9, 1, 0, 40), 50),
    ];
    const result = dailyRestingHr(records, window);
    // 30 minutes, lowest 3: 45, 60, 60.
    expect(result.days[0]).toEqual({ date: '2026-11-09', bpm: 55, minutes: 30 });
  });

  it(`needs ${minValidMinutes} valid minutes: 29 is insufficient and 30 is enough`, () => {
    expect(dailyRestingHr(minutes(9, 29, [60]), window)).toEqual({
      days: [],
      insufficient: ['2026-11-09'],
    });
    expect(dailyRestingHr(minutes(9, 30, [60]), window).days).toEqual([
      { date: '2026-11-09', bpm: 60, minutes: 30 },
    ]);
  });

  it('drops values outside 30~220 bpm, repeated record ids and samples outside the window', () => {
    const records = [
      ...minutes(9, 30, [60]),
      hr('low', at(9, 5, 0), 29),
      hr('high', at(9, 5, 1), 221),
      hr('d9-0', at(9, 5, 2), 31), // same id as an earlier record: counted once
      hr('old', at(2, 23, 59), 40), // before the window (local 11.03 00:00)
      hr('future', new Date(now.getTime() + 60_000).toISOString(), 40),
    ];
    expect(dailyRestingHr(records, window)).toEqual({
      days: [{ date: '2026-11-09', bpm: 60, minutes: 30 }],
      insufficient: [],
    });
  });

  it('splits samples by local date at midnight', () => {
    const records = [
      ...Array.from({ length: 30 }, (_, i) => hr(`a${i}`, at(8, 23, 30 + i), 55)),
      ...Array.from({ length: 30 }, (_, i) => hr(`b${i}`, at(9, 0, i), 65)),
    ];
    expect(dailyRestingHr(records, window).days).toEqual([
      { date: '2026-11-08', bpm: 55, minutes: 30 },
      { date: '2026-11-09', bpm: 65, minutes: 30 },
    ]);
  });
});

describe('오늘 RHR 읽기', () => {
  const now = new Date(2026, 10, 9, 21, 0);

  it('reads only today’s samples for the display (리뷰 A-2·B-5)', async () => {
    const native = fakeNative({ records: minutes(9, 40, [57]) });
    await readTodayRestingHr(native, now);
    expect(native.read).toHaveBeenCalledWith({
      start: new Date(2026, 10, 9).toISOString(),
      end: now.toISOString(),
    });
  });

  it('returns only today, never an earlier day', async () => {
    const native = fakeNative({ records: minutes(8, 40, [58]) });
    expect(await readTodayRestingHr(native, now)).toEqual({ status: 'insufficient' });

    const today = fakeNative({ records: minutes(9, 40, [57]) });
    expect(await readTodayRestingHr(today, now)).toEqual({
      status: 'ready',
      date: '2026-11-09',
      bpm: 57,
    });
  });

  it.each([
    ['SAMSUNG_PERMISSION', 'accessRequired'],
    ['SAMSUNG_POLICY', 'accessRequired'],
    ['SAMSUNG_UNAVAILABLE', 'unavailable'],
    ['SAMSUNG_QUERY', 'error'],
  ])('maps a %s read failure to %s', async (code, status) => {
    const native = fakeNative({
      records: async () => {
        throw { code };
      },
    });
    expect(await readTodayRestingHr(native, now)).toEqual({ status });
  });
});

describe('심박 권한 (AC-2)', () => {
  it('tells not requested, denied, revoked, granted and unavailable apart like sleep', async () => {
    expect(await checkSleepAccess(fakeNative({ status: 'required' }))).toBe('notRequested');
    expect(await checkSleepAccess(fakeNative({ status: 'unavailable' }))).toBe('unavailable');
    const denied = fakeNative({
      status: 'required',
      state: JSON.stringify({ requested: true, everGranted: false, owner: null, uploaded: {} }),
    });
    expect(await checkSleepAccess(denied)).toBe('denied');
    const revoked = fakeNative({
      status: 'required',
      state: JSON.stringify({ requested: true, everGranted: true, owner: null, uploaded: {} }),
    });
    expect(await checkSleepAccess(revoked)).toBe('revoked');
    expect(await checkSleepAccess(fakeNative())).toBe('granted');
  });

  it('asks for sleep and heart rate in one dialog and records each answer', async () => {
    const sleep = fakeNative({ status: 'granted' });
    const heart = fakeNative({ status: 'required' });
    const request = jest.fn(async () => ({ sleep: true, heartRate: false }));

    expect(await requestSamsungAccess(sleep, heart, request)).toEqual({
      sleep: 'granted',
      heartRate: 'denied',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(heart.saved()!)).toMatchObject({ requested: true, everGranted: false });
    expect(JSON.parse(sleep.saved()!)).toMatchObject({ requested: true, everGranted: true });
  });

  it('does not record a request that never showed the dialog as a denial', async () => {
    const sleep = fakeNative({ status: 'required' });
    const heart = fakeNative({ status: 'required' });
    const request = jest.fn(async () => {
      throw { code: 'SAMSUNG_QUERY' };
    });

    expect(await requestSamsungAccess(sleep, heart, request)).toEqual({
      sleep: 'notRequested',
      heartRate: 'notRequested',
    });
  });
});

describe('W06 업로드 — 수면과 한 요청 (AC-5)', () => {
  const now = new Date(2026, 10, 9, 21, 0);
  const sleepSession: HealthRecord = {
    id: 's9',
    metric: 'sleep',
    startTime: at(8, 23),
    endTime: at(9, 6),
    source: { id: 'com.sec.android.app.shealth', name: '삼성 헬스' },
    reportedSleepMs: 400 * 60_000,
  };
  const ok = (sent: number): SleepSyncResponse => ({
    acceptedCount: sent,
    duplicateCount: 0,
    rejectedCount: 0,
    errors: [],
  });

  function deps(
    native: SleepNative,
    heart: SleepNative | undefined,
    overrides: Partial<SleepUploadDeps> = {},
  ): SleepUploadDeps & { send: jest.Mock } {
    return {
      native,
      heart,
      send: jest.fn(async (body: SleepSyncRequest) => ok(body.records.length)),
      consent: async () => 'AGREE',
      sessionKey: () => '1',
      owner: () => '7',
      now: () => now,
      wait: jest.fn(async () => {}),
      ...overrides,
    } as SleepUploadDeps & { send: jest.Mock };
  }

  it('sends changed sleep and resting heart rate days in one SAMSUNG_HEALTH request, once', async () => {
    const sleep = fakeNative({ records: [sleepSession] });
    const heart = fakeNative({ records: [...minutes(8, 40, [58]), ...minutes(9, 30, [57])] });
    const run = deps(sleep, heart);

    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send).toHaveBeenCalledTimes(1);
    expect(run.send).toHaveBeenCalledWith({
      provider: 'SAMSUNG_HEALTH',
      records: [
        { type: 'DAILY_SLEEP_SUMMARY', metricDate: '2026-11-09', sleepDurationMin: 400, computedAt: now.toISOString() },
        { type: 'DAILY_RESTING_HR', metricDate: '2026-11-08', restingHrBpm: 58, method: 'DAILY_LOWER_10PCT_MINUTE_MEAN_V1', validMinuteCount: 40, computedAt: now.toISOString() },
        { type: 'DAILY_RESTING_HR', metricDate: '2026-11-09', restingHrBpm: 57, method: 'DAILY_LOWER_10PCT_MINUTE_MEAN_V1', validMinuteCount: 30, computedAt: now.toISOString() },
      ],
    });

    expect(await uploadSamsungSleep(run)).toBe('nothing');
    expect(run.send).toHaveBeenCalledTimes(1);
  });

  it('resends only a resting heart rate whose value changed (today updates during the day)', async () => {
    let today = minutes(9, 30, [57]);
    const heart = fakeNative({ records: async () => today });
    const run = deps(fakeNative({ status: 'required' }), heart);
    expect(await uploadSamsungSleep(run)).toBe('done');

    today = [...today, ...minutes(9, 10, [50], 'later').map((r, i) => ({ ...r, startTime: at(9, 3, i) }))];
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send).toHaveBeenCalledTimes(2);
    expect(run.send.mock.calls[1][0].records).toEqual([
      expect.objectContaining({ type: 'DAILY_RESTING_HR', metricDate: '2026-11-09', restingHrBpm: 50, validMinuteCount: 40 }),
    ]);
  });

  it('sends resting heart rate alone when only heart rate access is granted, and nothing without either', async () => {
    const heart = fakeNative({ records: minutes(9, 30, [57]) });
    const run = deps(fakeNative({ status: 'required' }), heart);
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send.mock.calls[0][0].records.map((r: { type: string }) => r.type)).toEqual(['DAILY_RESTING_HR']);

    const none = deps(fakeNative({ status: 'required' }), fakeNative({ status: 'required' }));
    expect(await uploadSamsungSleep(none)).toBe('no-access');
    expect(none.send).not.toHaveBeenCalled();
  });

  it('still sends sleep when the heart rate read fails, and retries later when nothing could be read', async () => {
    const failing = fakeNative({
      records: async () => {
        throw { code: 'SAMSUNG_QUERY' };
      },
    });
    const run = deps(fakeNative({ records: [sleepSession] }), failing);
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send.mock.calls[0][0].records.map((r: { type: string }) => r.type)).toEqual(['DAILY_SLEEP_SUMMARY']);

    const onlyFailing = deps(fakeNative({ status: 'required' }), failing);
    expect(await uploadSamsungSleep(onlyFailing)).toBe('retry-later');
  });

  it('marks a duplicate (the watch value won on the server) so it is not resent', async () => {
    const heart = fakeNative({ records: minutes(9, 30, [57]) });
    const run = deps(fakeNative({ status: 'required' }), heart, {
      send: jest.fn(async () => ({ acceptedCount: 0, duplicateCount: 1, rejectedCount: 0, errors: [] })),
    });
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(JSON.parse(heart.saved()!).uploaded).toEqual({ '2026-11-09': 57 });
    expect(await uploadSamsungSleep(run)).toBe('nothing');
  });

  it('leaves a resting heart rate unmarked when a server without the contract rejects it (리뷰 A-1)', async () => {
    const sleep = fakeNative({ records: [sleepSession] });
    const heart = fakeNative({ records: minutes(9, 30, [57]) });
    const old = deps(sleep, heart, {
      send: jest.fn(async () => ({
        acceptedCount: 1,
        duplicateCount: 0,
        rejectedCount: 1,
        errors: [{ index: 1, code: 'INVALID_RECORD', field: null, reason: 'UNKNOWN_FIELD' }],
      })),
    });
    expect(await uploadSamsungSleep(old)).toBe('done');
    expect(JSON.parse(sleep.saved()!).uploaded).toEqual({ '2026-11-09': 400 });
    expect(JSON.parse(heart.saved()!).uploaded).toEqual({});

    // Once the server knows DAILY_RESTING_HR the same day goes through; the marked sleep is not resent.
    const updated = deps(sleep, heart);
    expect(await uploadSamsungSleep(updated)).toBe('done');
    expect(updated.send.mock.calls[0][0].records).toEqual([
      expect.objectContaining({ type: 'DAILY_RESTING_HR', metricDate: '2026-11-09' }),
    ]);
  });

  it('marks a resting heart rate rejected for its value (same content cannot succeed)', async () => {
    const heart = fakeNative({ records: minutes(9, 30, [57]) });
    const run = deps(fakeNative({ status: 'required' }), heart, {
      send: jest.fn(async () => ({
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 1,
        errors: [{ index: 0, code: 'INVALID_RECORD', field: 'metricDate', reason: 'OUT_OF_RANGE' }],
      })),
    });
    expect(await uploadSamsungSleep(run)).toBe('nothing');
    expect(JSON.parse(heart.saved()!).uploaded).toEqual({ '2026-11-09': 57 });
  });

  it('keeps values unsent without server consent', async () => {
    const heart = fakeNative({ records: minutes(9, 30, [57]) });
    const noConsent = deps(fakeNative({ status: 'required' }), heart, { consent: async () => 'DISAGREE' });
    expect(await uploadSamsungSleep(noConsent)).toBe('consent-required');
    expect(noConsent.send).not.toHaveBeenCalled();
    expect(JSON.parse(heart.saved()!).uploaded).toEqual({});
  });

  it('does not trust resting heart rate marks of another account, and a reset clears them', async () => {
    const marks = JSON.stringify({ requested: true, everGranted: true, owner: '3', uploaded: { '2026-11-09': 57 } });
    const heart = fakeNative({ records: minutes(9, 30, [57]), state: marks });
    const run = deps(fakeNative({ status: 'required' }), heart);
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(JSON.parse(heart.saved()!)).toMatchObject({ owner: '7', uploaded: { '2026-11-09': 57 } });

    await resetSleepUploads(heart);
    expect(JSON.parse(heart.saved()!)).toMatchObject({ everGranted: true, owner: null, uploaded: {} });
  });
});
