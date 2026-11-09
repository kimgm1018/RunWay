import { DataError } from '../../data/errors';
import {
  checkSleepAccess,
  dailySleep,
  readTodaySleep,
  requestSleepAccess,
  resetSleepUploads,
  sleepRetryDelaysMs,
  sleepWindow,
  uploadSamsungSleep,
  type NativeSleepAccess,
  type SleepNative,
  type SleepSyncRequest,
  type SleepSyncResponse,
  type SleepUploadDeps,
} from '../samsungSleep';
import type { HealthRecord } from '../types';

// S15P31E105-572. Jest runs in Asia/Seoul (jest.config.js); all sleep values are synthetic.

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

function session(
  id: string,
  start: string,
  end: string,
  extra: Partial<HealthRecord> = {},
): HealthRecord {
  return {
    id,
    metric: 'sleep',
    startTime: start,
    endTime: end,
    source: { id: 'com.sec.android.app.shealth', name: '삼성 헬스' },
    ...extra,
  } as HealthRecord;
}

function fakeNative(
  options: {
    status?: NativeSleepAccess | (() => Promise<NativeSleepAccess>);
    granted?: boolean;
    records?: HealthRecord[] | (() => Promise<HealthRecord[]>);
    state?: string | null;
  } = {},
) {
  let saved: string | null = options.state ?? null;
  const native: SleepNative & { saved: () => string | null } = {
    status: async () =>
      typeof options.status === 'function'
        ? options.status()
        : options.status ?? 'granted',
    request: jest.fn(async () => options.granted ?? true),
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

const uploadedOf = (native: { saved: () => string | null }) =>
  JSON.parse(native.saved() ?? '{"uploaded":{}}').uploaded;

describe('기상일 집계 (AC7)', () => {
  const now = new Date(2026, 10, 9, 9, 0);
  const window = sleepWindow(now);

  it('reads local midnight six days back until now', () => {
    expect(window).toEqual({
      start: new Date(2026, 10, 3).toISOString(),
      end: now.toISOString(),
    });
  });

  it('puts a session that crosses midnight on its local wake date and adds naps that day', () => {
    const { days } = dailySleep(
      [
        session('night', at(8, 23, 30), at(9, 6, 30), { reportedSleepMs: 6.5 * 3600_000 }),
        session('nap', at(8, 14), at(8, 14, 30), { reportedSleepMs: 30 * 60_000 }),
        session('earlier', at(7, 0, 10), at(7, 7, 0), { reportedSleepMs: 400 * 60_000 }),
      ],
      window,
    );
    expect(days).toEqual([
      { date: '2026-11-07', minutes: 400 },
      { date: '2026-11-08', minutes: 30 },
      { date: '2026-11-09', minutes: 390 },
    ]);
  });

  it('counts overlapping and repeated sessions once', () => {
    const night = session('a', at(8, 23), at(9, 7), { reportedSleepMs: 420 * 60_000 });
    const merged = dailySleep(
      [night, { ...night, id: 'a-copy' }, session('b', at(9, 1), at(9, 3))],
      window,
    );
    // The overlap has no full stage cover, so the day cannot be resolved and is left out.
    expect(merged).toEqual({ days: [], unresolved: ['2026-11-09'] });
    expect(dailySleep([night, { ...night, id: 'a-copy' }], window).days).toEqual([
      { date: '2026-11-09', minutes: 420 },
    ]);
  });

  it('uses stages when no duration is given and skips a day whose stages leave time unknown', () => {
    const staged = session('staged', at(8, 0), at(8, 2), {
      stages: [
        { startTime: at(8, 0), endTime: at(8, 1, 30), stage: 'light' },
        { startTime: at(8, 1, 30), endTime: at(8, 2), stage: 'awake' },
      ],
    } as Partial<HealthRecord>);
    const partial = session('partial', at(7, 0), at(7, 2), {
      stages: [{ startTime: at(7, 0), endTime: at(7, 1), stage: 'deep' }],
    } as Partial<HealthRecord>);
    expect(dailySleep([staged, partial], window)).toEqual({
      days: [{ date: '2026-11-08', minutes: 90 }],
      unresolved: ['2026-11-07'],
    });
  });

  it('leaves out sessions still in progress, zero sleep and sessions outside the window', () => {
    expect(
      dailySleep(
        [
          session('running', at(9, 1), at(9, 10), { reportedSleepMs: 60_000 }),
          session('zero', at(8, 1), at(8, 2), { reportedSleepMs: 0 }),
          session('old', at(1, 1), at(1, 7), { reportedSleepMs: 360 * 60_000 }),
        ],
        window,
      ).days,
    ).toEqual([]);
  });

  it('counts a session ending on the first day of the window in full, even if it began the night before', () => {
    // Window starts 11-03 00:00; the native read starts 36 hours earlier, so this session reaches the reader whole.
    expect(
      dailySleep(
        [session('edge', at(2, 23), at(3, 6), { reportedSleepMs: 420 * 60_000 })],
        window,
      ).days,
    ).toEqual([{ date: '2026-11-03', minutes: 420 }]);
  });

  it('treats a total beyond a day as unresolved instead of cutting it to 1440', () => {
    expect(
      dailySleep(
        [session('long', at(6, 0), at(7, 1), { reportedSleepMs: 1441 * 60_000 })],
        window,
      ),
    ).toEqual({ days: [], unresolved: ['2026-11-07'] });
  });

  it('keeps two decimals of minutes', () => {
    expect(
      dailySleep(
        [session('s', at(8, 0), at(8, 7), { reportedSleepMs: 25_000_123 })],
        window,
      ).days,
    ).toEqual([{ date: '2026-11-08', minutes: 416.67 }]);
  });
});

describe('권한 상태 (AC9)', () => {
  it('tells not requested, denied, revoked, granted and unavailable apart', async () => {
    expect(await checkSleepAccess(fakeNative({ status: 'unavailable' }))).toBe('unavailable');
    expect(await checkSleepAccess(fakeNative({ status: 'required' }))).toBe('notRequested');

    const denied = fakeNative({ status: 'required', granted: false });
    expect(await requestSleepAccess(denied)).toBe('denied');
    expect(await checkSleepAccess(denied)).toBe('denied');

    let status: NativeSleepAccess = 'granted';
    const revoked = fakeNative({ status: async () => status });
    expect(await checkSleepAccess(revoked)).toBe('granted');
    status = 'required';
    expect(await checkSleepAccess(revoked)).toBe('revoked');
  });

  it('shows granted after allowing and returning to the app', async () => {
    let status: NativeSleepAccess = 'required';
    const native = fakeNative({ status: async () => status, granted: false });
    expect(await requestSleepAccess(native)).toBe('denied');
    // Allowed in Samsung Health, then back: the next check reads the OS state.
    status = 'granted';
    expect(await checkSleepAccess(native)).toBe('granted');
  });

  it('treats a permission error as not granted and other SDK errors as unavailable', async () => {
    const permission = fakeNative({
      status: () => Promise.reject({ code: 'SAMSUNG_PERMISSION' }),
    });
    const policy = fakeNative({
      status: () => Promise.reject({ code: 'SAMSUNG_POLICY' }),
    });
    expect(await checkSleepAccess(permission)).toBe('notRequested');
    expect(await checkSleepAccess(policy)).toBe('unavailable');
  });

  it('keeps the access history when sent marks are reset for another account', async () => {
    const native = fakeNative({
      state: JSON.stringify({ requested: true, everGranted: true, uploaded: { '2026-11-08': 400 } }),
    });
    await resetSleepUploads(native);
    expect(JSON.parse(native.saved()!)).toEqual({
      requested: true,
      everGranted: true,
      owner: null,
      uploaded: {},
    });
  });

  it('does not record a request that never showed the dialog as a denial', async () => {
    const native = fakeNative({ status: 'required' });
    (native.request as jest.Mock).mockRejectedValueOnce({ code: 'SAMSUNG_QUERY' });
    expect(await requestSleepAccess(native)).toBe('notRequested');
  });
});

describe('오늘 수면 읽기', () => {
  const now = new Date(2026, 10, 9, 9, 0);

  it('returns today’s wake date first', async () => {
    const native = fakeNative({
      records: [session('s', at(8, 23), at(9, 6), { reportedSleepMs: 400 * 60_000 })],
    });
    expect(await readTodaySleep(native, now)).toEqual({
      status: 'ready',
      date: '2026-11-09',
      minutes: 400,
    });
  });

  it('falls back to the latest night in the window with its own wake date', async () => {
    const older = fakeNative({
      records: [
        session('a', at(5, 23), at(6, 6), { reportedSleepMs: 294 * 60_000 }),
        session('b', at(2, 23), at(3, 6), { reportedSleepMs: 326 * 60_000 }),
      ],
    });
    expect(await readTodaySleep(older, now)).toEqual({
      status: 'ready',
      date: '2026-11-06',
      minutes: 294,
    });
  });

  it('says unresolved for an unresolved night today instead of an older night', async () => {
    const native = fakeNative({
      records: [
        session('old', at(7, 23), at(8, 6), { reportedSleepMs: 400 * 60_000 }),
        session('today', at(9, 0), at(9, 6)),
      ],
    });
    expect(await readTodaySleep(native, now)).toEqual({ status: 'unresolved' });
  });

  it('tells no record from a failed read', async () => {
    const outsideWindow = fakeNative({
      records: [session('s', at(1, 23), at(2, 6), { reportedSleepMs: 400 * 60_000 })],
    });
    expect(await readTodaySleep(outsideWindow, now)).toEqual({ status: 'empty' });
    const unknown = fakeNative({ records: [session('s', at(9, 0), at(9, 6))] });
    expect(await readTodaySleep(unknown, now)).toEqual({ status: 'unresolved' });
    const failing = fakeNative({ records: () => Promise.reject({ code: 'SAMSUNG_QUERY' }) });
    expect(await readTodaySleep(failing, now)).toEqual({ status: 'error' });
    const revoked = fakeNative({ records: () => Promise.reject({ code: 'SAMSUNG_PERMISSION' }) });
    expect(await readTodaySleep(revoked, now)).toEqual({ status: 'accessRequired' });
  });
});

describe('W06 업로드 (AC8)', () => {
  const now = new Date(2026, 10, 9, 9, 0);
  const records = [
    session('d9', at(8, 23), at(9, 6), { reportedSleepMs: 400 * 60_000 }),
    session('d8', at(7, 23), at(8, 6, 30), { reportedSleepMs: 410.5 * 60_000 }),
  ];
  const ok = (sent: number): SleepSyncResponse => ({
    acceptedCount: sent,
    duplicateCount: 0,
    rejectedCount: 0,
    errors: [],
  });

  function deps(
    native: SleepNative,
    overrides: Partial<SleepUploadDeps> = {},
  ): SleepUploadDeps & { send: jest.Mock; wait: jest.Mock } {
    return {
      native,
      send: jest.fn(async (body: SleepSyncRequest) => ok(body.records.length)),
      consent: async () => 'AGREE',
      sessionKey: () => '1',
      owner: () => '7',
      now: () => now,
      wait: jest.fn(async () => {}),
      ...overrides,
    } as SleepUploadDeps & { send: jest.Mock; wait: jest.Mock };
  }

  it('sends each changed wake date once as SAMSUNG_HEALTH and nothing on a repeated read', async () => {
    const native = fakeNative({ records });
    const run = deps(native);

    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send).toHaveBeenCalledWith({
      provider: 'SAMSUNG_HEALTH',
      records: [
        { type: 'DAILY_SLEEP_SUMMARY', metricDate: '2026-11-08', sleepDurationMin: 410.5, computedAt: now.toISOString() },
        { type: 'DAILY_SLEEP_SUMMARY', metricDate: '2026-11-09', sleepDurationMin: 400, computedAt: now.toISOString() },
      ],
    });

    expect(await uploadSamsungSleep(run)).toBe('nothing');
    expect(run.send).toHaveBeenCalledTimes(1);
  });

  it('sends only the date whose value changed', async () => {
    const native = fakeNative({
      records,
      state: JSON.stringify({ requested: true, everGranted: true, owner: '7', uploaded: { '2026-11-08': 410.5, '2026-11-09': 380 } }),
    });
    const run = deps(native);
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send.mock.calls[0][0].records).toEqual([
      expect.objectContaining({ metricDate: '2026-11-09', sleepDurationMin: 400 }),
    ]);
  });

  it('drops marks older than the read window', async () => {
    const native = fakeNative({
      records,
      state: JSON.stringify({ requested: true, everGranted: true, owner: '7', uploaded: { '2026-10-30': 300 } }),
    });
    await uploadSamsungSleep(deps(native));
    expect(JSON.parse(native.saved()!).uploaded).toEqual({
      '2026-11-08': 410.5,
      '2026-11-09': 400,
    });
  });

  it('does not read or send without sleep access, and sends nothing without server consent', async () => {
    const noAccess = fakeNative({ status: 'required', records });
    const run = deps(noAccess);
    expect(await uploadSamsungSleep(run)).toBe('no-access');
    expect(noAccess.read).not.toHaveBeenCalled();

    const withdrawn = deps(fakeNative({ records }), { consent: async () => 'DISAGREE' });
    expect(await uploadSamsungSleep(withdrawn)).toBe('consent-required');
    expect(withdrawn.send).not.toHaveBeenCalled();
  });

  it('stops on 403 and keeps the values unsent', async () => {
    const native = fakeNative({ records });
    const run = deps(native, {
      send: jest.fn(async () => {
        throw new DataError('CONSENT_REQUIRED', '', null, 403);
      }),
    });
    expect(await uploadSamsungSleep(run)).toBe('consent-required');
    expect(uploadedOf(native)).toEqual({});
  });

  it('retries no answer and 503 three times in a run, then waits for the next run', async () => {
    const native = fakeNative({ records });
    const run = deps(native, {
      send: jest.fn(async () => {
        throw new DataError('UNKNOWN', '', null, 503);
      }),
    });
    expect(await uploadSamsungSleep(run)).toBe('retry-later');
    expect(run.send).toHaveBeenCalledTimes(3);
    expect(run.wait.mock.calls.map(call => call[0])).toEqual(sleepRetryDelaysMs);
    expect(uploadedOf(native)).toEqual({});
  });

  it('does not rerun a 500 at once and resends it on the next run', async () => {
    const native = fakeNative({ records });
    const send = jest
      .fn()
      .mockRejectedValueOnce(new DataError('UNKNOWN', '', null, 500))
      .mockImplementation(async (body: SleepSyncRequest) => ok(body.records.length));
    const run = deps(native, { send });
    expect(await uploadSamsungSleep(run)).toBe('retry-later');
    expect(send).toHaveBeenCalledTimes(1);
    expect(await uploadSamsungSleep(run)).toBe('done');
  });

  it('does not resend a record rejected inside a 200 with the same content', async () => {
    const native = fakeNative({ records });
    const run = deps(native, {
      send: jest.fn(async () => ({
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 2,
        errors: [{ index: 0 }, { index: 1 }],
      })),
    });
    expect(await uploadSamsungSleep(run)).toBe('nothing');
    expect(await uploadSamsungSleep(run)).toBe('nothing');
    expect(run.send).toHaveBeenCalledTimes(1);
  });

  it.each([400, 413, 422])(
    'keeps the days unsent after a whole-request %i and sends them on the next run, without an immediate rerun',
    async status => {
      const native = fakeNative({ records });
      const send = jest
        .fn()
        .mockRejectedValueOnce(new DataError('UNKNOWN', '', null, status))
        .mockImplementation(async (body: SleepSyncRequest) => ok(body.records.length));
      const run = deps(native, { send });
      expect(await uploadSamsungSleep(run)).toBe('retry-later');
      expect(send).toHaveBeenCalledTimes(1);
      expect(uploadedOf(native)).toEqual({});
      // e.g. the server is deployed with the SAMSUNG_HEALTH contract after the app.
      expect(await uploadSamsungSleep(run)).toBe('done');
      expect(send.mock.calls[1][0].records).toHaveLength(2);
    },
  );

  it('does not trust marks left by another account', async () => {
    const native = fakeNative({
      records,
      state: JSON.stringify({ requested: true, everGranted: true, owner: '3', uploaded: { '2026-11-08': 410.5, '2026-11-09': 400 } }),
    });
    const run = deps(native);
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send.mock.calls[0][0].records).toHaveLength(2);
    expect(JSON.parse(native.saved()!)).toMatchObject({
      owner: '7',
      uploaded: { '2026-11-08': 410.5, '2026-11-09': 400 },
    });
  });

  it('does not trust marks when the account is unknown', async () => {
    const native = fakeNative({ records });
    const run = deps(native, { owner: () => undefined });
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(await uploadSamsungSleep(run)).toBe('done');
    expect(run.send).toHaveBeenCalledTimes(2);
  });

  it('a sign-out reset during an upload is not overwritten by the upload marks', async () => {
    const native = fakeNative({ records });
    let release: () => void = () => {};
    let key: string | undefined = '1';
    const run = deps(native, {
      sessionKey: () => key,
      send: jest.fn(
        (body: SleepSyncRequest) =>
          new Promise<SleepSyncResponse>(resolve => {
            release = () => resolve(ok(body.records.length));
          }),
      ),
    });
    const upload = uploadSamsungSleep(run);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    // Signing out clears the session and the marks while the answer is on its way.
    key = undefined;
    const reset = resetSleepUploads(native);
    release();
    expect(await upload).toBe('signed-out');
    await reset;
    expect(JSON.parse(native.saved()!)).toMatchObject({ owner: null, uploaded: {} });
  });

  it('does not trust a 200 whose counts do not add up', async () => {
    const native = fakeNative({ records });
    const run = deps(native, { send: jest.fn(async () => ok(1)) });
    expect(await uploadSamsungSleep(run)).toBe('retry-later');
    expect(uploadedOf(native)).toEqual({});
  });

  it('drops the answer when the account changed while the request was in flight', async () => {
    let key = '1';
    const native = fakeNative({ records });
    const run = deps(native, {
      sessionKey: () => key,
      send: jest.fn(async (body: SleepSyncRequest) => {
        key = '2';
        return ok(body.records.length);
      }),
    });
    expect(await uploadSamsungSleep(run)).toBe('signed-out');
    expect(uploadedOf(native)).toEqual({});
  });

  it('runs one upload at a time', async () => {
    const native = fakeNative({ records });
    let release: () => void = () => {};
    const run = deps(native, {
      send: jest.fn(
        (body: SleepSyncRequest) =>
          new Promise<SleepSyncResponse>(resolve => {
            release = () => resolve(ok(body.records.length));
          }),
      ),
    });
    const first = uploadSamsungSleep(run);
    const second = uploadSamsungSleep(run);
    expect(second).toBe(first);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    release();
    expect(await first).toBe('done');
    expect(run.send).toHaveBeenCalledTimes(1);
  });
});
