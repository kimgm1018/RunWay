import { DataError } from '../../data/errors';
import {
  resetWatchDailyHrUploadState,
  retryDelaysMs,
  uploadWatchDailyHr,
  type SyncRequest,
  type SyncResponse,
  type UploadDeps,
} from '../watchDailyHrUpload';
import type { WatchDailyHr } from '../watchHealth';

// Synthetic values only.
function row(
  metricDate: string,
  revision = 1,
  uploaded = false,
  rejected = false,
): WatchDailyHr {
  return {
    metricDate,
    revision,
    estimatedRestingHrBpm: 58.4,
    method: 'ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2',
    validSampleCount: 812,
    computedAt: `${metricDate}T09:00:00Z`,
    uploaded,
    rejected,
  };
}

function ok(sent: number, rejectedIndexes: number[] = []): SyncResponse {
  return {
    acceptedCount: sent - rejectedIndexes.length,
    duplicateCount: 0,
    rejectedCount: rejectedIndexes.length,
    errors: rejectedIndexes.map(index => ({ index })),
  };
}

const httpError = (status: number, code: DataError['code'] = 'UNKNOWN') =>
  new DataError(code, '요청 실패', null, status);
const networkError = () => new DataError('NETWORK_ERROR', '연결 실패');

let records: WatchDailyHr[];
let token: string | undefined;
let deps: jest.Mocked<UploadDeps>;

beforeEach(() => {
  resetWatchDailyHrUploadState();
  records = [];
  token = 'access-1';
  deps = {
    read: jest.fn(async () => records),
    mark: jest.fn(async (_date: string, _revision: number) => {}),
    reject: jest.fn(async (_date: string, _revision: number) => {}),
    send: jest.fn(async (body: SyncRequest) => ok(body.records.length)),
    withdraw: jest.fn(async () => {}),
    accessToken: jest.fn(() => token),
    wait: jest.fn(async (_ms: number) => {}),
  };
});

test('sends pending records in the W06 shape and marks each after a 200', async () => {
  records = [
    row('2026-10-31', 2),
    row('2026-10-30', 3),
    row('2026-10-29', 1, true),
  ];

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');

  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(deps.send.mock.calls[0][0]).toEqual({
    provider: 'RUNWAY_WATCH',
    records: [
      {
        type: 'DAILY_HR_ESTIMATE',
        metricDate: '2026-10-30',
        revision: 3,
        estimatedRestingHrBpm: 58.4,
        method: 'ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2',
        validSampleCount: 812,
        computedAt: '2026-10-30T09:00:00Z',
      },
      expect.objectContaining({ metricDate: '2026-10-31', revision: 2 }),
    ],
  });
  expect(deps.mark.mock.calls).toEqual([
    ['2026-10-30', 3],
    ['2026-10-31', 2],
  ]);
});

test('a duplicate counts as uploaded', async () => {
  records = [row('2026-10-30', 3)];
  deps.send.mockResolvedValue({
    acceptedCount: 0,
    duplicateCount: 1,
    rejectedCount: 0,
    errors: [],
  });

  await uploadWatchDailyHr(deps);

  expect(deps.mark).toHaveBeenCalledWith('2026-10-30', 3);
});

test('a newer revision of an uploaded date is sent again', async () => {
  records = [row('2026-10-30', 4)];

  await uploadWatchDailyHr(deps);

  expect(deps.send.mock.calls[0][0].records[0].revision).toBe(4);
  expect(deps.mark).toHaveBeenCalledWith('2026-10-30', 4);
});

test('does nothing without records or without a signed-in token', async () => {
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('nothing');
  records = [row('2026-10-30')];
  token = undefined;
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');
  expect(deps.read).toHaveBeenCalledTimes(1);
  expect(deps.send).not.toHaveBeenCalled();
});

test('a rejected record is not marked and is not resent in a later run', async () => {
  records = [row('2026-10-30'), row('2026-10-31')];
  deps.send.mockResolvedValueOnce(ok(2, [1]));

  await uploadWatchDailyHr(deps);
  expect(deps.mark.mock.calls).toEqual([['2026-10-30', 1]]);
  expect(deps.reject.mock.calls).toEqual([['2026-10-31', 1]]);

  records = [row('2026-10-31')];
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('nothing');
  expect(deps.send).toHaveBeenCalledTimes(1);

  // The watch recomputed the date: the new revision is a new record.
  records = [row('2026-10-31', 2)];
  await uploadWatchDailyHr(deps);
  expect(deps.mark).toHaveBeenLastCalledWith('2026-10-31', 2);
});

test.each([400, 413, 422])(
  'a %i is not retried and the records are stored as rejected',
  async status => {
    records = [row('2026-10-30')];
    deps.send.mockRejectedValueOnce(httpError(status));

    await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.mark).not.toHaveBeenCalled();
    expect(deps.reject).toHaveBeenCalledWith('2026-10-30', 1);

    await expect(uploadWatchDailyHr(deps)).resolves.toBe('nothing');
    expect(deps.send).toHaveBeenCalledTimes(1);
  },
);

test('a rejection stored on the phone is not resent after the app restarts', async () => {
  // A restart forgets this run's set; the phone store still says rejected.
  resetWatchDailyHrUploadState();
  records = [row('2026-10-30', 2, false, true), row('2026-10-31')];

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(deps.send.mock.calls[0][0].records.map(r => r.metricDate)).toEqual([
    '2026-10-31',
  ]);
});

test('a rejection that could not be stored is still skipped in this run', async () => {
  records = [row('2026-10-30')];
  // The phone write was lost: the store keeps reading the record as not rejected.
  deps.send.mockResolvedValueOnce(ok(1, [0]));

  await uploadWatchDailyHr(deps);
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('nothing');
  expect(deps.send).toHaveBeenCalledTimes(1);
});

test('no answer or 503 retries the same request with a limit, then succeeds', async () => {
  records = [row('2026-10-30')];
  deps.send
    .mockRejectedValueOnce(networkError())
    .mockRejectedValueOnce(httpError(503, 'SERVER_ERROR'));

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');

  expect(deps.send).toHaveBeenCalledTimes(3);
  expect(deps.send.mock.calls[2][0]).toEqual(deps.send.mock.calls[0][0]);
  expect(deps.wait.mock.calls).toEqual(retryDelaysMs.map(ms => [ms]));
  expect(deps.mark).toHaveBeenCalledTimes(1);
});

test('stops after three failed tries and keeps the record for the next run', async () => {
  records = [row('2026-10-30')];
  deps.send.mockRejectedValue(networkError());

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('retry-later');
  expect(deps.send).toHaveBeenCalledTimes(1 + retryDelaysMs.length);
  expect(deps.mark).not.toHaveBeenCalled();

  deps.send.mockImplementation(async body => ok(body.records.length));
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.mark).toHaveBeenCalledWith('2026-10-30', 1);
});

test('a 500 is not rerun immediately but is sent again in the next run', async () => {
  records = [row('2026-10-30')];
  deps.send.mockRejectedValueOnce(httpError(500, 'SERVER_ERROR'));

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('retry-later');
  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(deps.wait).not.toHaveBeenCalled();

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.send).toHaveBeenCalledTimes(2);
});

test('a withdrawn consent stops the upload and clears the phone records', async () => {
  records = [
    row('2026-10-30'),
    ...Array.from({ length: 31 }, (_, i) =>
      row(`2026-09-${String(i + 1).padStart(2, '0')}`),
    ),
  ];
  deps.send.mockRejectedValue(httpError(403, 'CONSENT_REQUIRED'));

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('consent-withdrawn');

  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(deps.withdraw).toHaveBeenCalledTimes(1);
  expect(deps.mark).not.toHaveBeenCalled();
});

test('a 401 stops without retrying', async () => {
  records = [row('2026-10-30')];
  deps.send.mockRejectedValue(httpError(401, 'UNAUTHORIZED'));

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');
  expect(deps.send).toHaveBeenCalledTimes(1);
  expect(deps.mark).not.toHaveBeenCalled();
});

test('never retries or marks with another account after the token changes', async () => {
  records = [row('2026-10-30')];
  deps.send.mockImplementationOnce(async () => {
    token = 'access-2';
    throw networkError();
  });

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');
  expect(deps.send).toHaveBeenCalledTimes(1);

  token = 'access-1';
  deps.send.mockImplementationOnce(async body => {
    token = undefined;
    return ok(body.records.length);
  });
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');
  expect(deps.mark).not.toHaveBeenCalled();
});

test('a 200 whose counts do not match is not taken as uploaded', async () => {
  records = [row('2026-10-30')];
  deps.send.mockResolvedValueOnce({
    acceptedCount: 2,
    duplicateCount: 0,
    rejectedCount: 0,
    errors: [],
  });

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('retry-later');
  expect(deps.mark).not.toHaveBeenCalled();
});

test('a 200 that repeats a rejected index is not taken as uploaded', async () => {
  records = [row('2026-10-29'), row('2026-10-30'), row('2026-10-31')];
  // Counts add up (1 + 2 = 3) but index 1 appears twice, so index 2's outcome is unknown.
  deps.send.mockResolvedValueOnce({
    acceptedCount: 1,
    duplicateCount: 0,
    rejectedCount: 2,
    errors: [{ index: 1 }, { index: 1 }],
  });

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('retry-later');
  expect(deps.mark).not.toHaveBeenCalled();

  // Nothing was taken as rejected: the next run sends all three again.
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.send.mock.calls[1][0].records).toHaveLength(3);
});

test('a 400 that arrives after the token changed does not skip the records for the next account', async () => {
  records = [row('2026-10-30')];
  deps.send.mockImplementationOnce(async () => {
    token = 'access-2';
    throw httpError(400, 'VALIDATION_ERROR');
  });

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.send).toHaveBeenCalledTimes(2);
});

test('a CONSENT_REQUIRED that arrives after the token changed leaves the new session alone', async () => {
  records = [row('2026-10-30')];
  deps.send.mockImplementationOnce(async () => {
    token = 'access-2';
    throw httpError(403, 'CONSENT_REQUIRED');
  });

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('signed-out');
  expect(deps.withdraw).not.toHaveBeenCalled();
});

test('resetting the state lets skipped records be sent again', async () => {
  records = [row('2026-10-30')];
  deps.send.mockRejectedValueOnce(httpError(400, 'VALIDATION_ERROR'));
  await uploadWatchDailyHr(deps);
  await expect(uploadWatchDailyHr(deps)).resolves.toBe('nothing');

  resetWatchDailyHrUploadState();

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('done');
  expect(deps.mark).toHaveBeenCalledWith('2026-10-30', 1);
});

test('splits more than 31 records into requests sent one after another', async () => {
  records = Array.from({ length: 33 }, (_, i) =>
    row(
      `2026-${i < 31 ? '08' : '09'}-${String((i % 31) + 1).padStart(2, '0')}`,
    ),
  );
  let active = 0;
  deps.send.mockImplementation(async body => {
    active++;
    expect(active).toBe(1);
    await Promise.resolve();
    active--;
    return ok(body.records.length);
  });

  await uploadWatchDailyHr(deps);

  expect(deps.send.mock.calls.map(([body]) => body.records.length)).toEqual([
    31, 2,
  ]);
  expect(deps.mark).toHaveBeenCalledTimes(33);
});

test('overlapping triggers share one run instead of sending twice', async () => {
  records = [row('2026-10-30')];
  const first = uploadWatchDailyHr(deps);
  const second = uploadWatchDailyHr(deps);

  await expect(Promise.all([first, second])).resolves.toEqual(['done', 'done']);
  expect(deps.send).toHaveBeenCalledTimes(1);
});

test('a trigger for a new session runs after the previous session run instead of sharing its result', async () => {
  records = [row('2026-10-30')];
  let release!: () => void;
  let active = 0;
  deps.send.mockImplementation(async body => {
    active++;
    expect(active).toBe(1);
    if (deps.send.mock.calls.length === 1) {
      await new Promise<void>(resolve => {
        release = resolve;
      });
    }
    active--;
    return ok(body.records.length);
  });

  const first = uploadWatchDailyHr(deps);
  await new Promise<void>(resolve => setImmediate(() => resolve()));
  // Signed out and back in while the first request is still open.
  token = 'access-2';
  const second = uploadWatchDailyHr(deps);
  const third = uploadWatchDailyHr(deps);
  release();

  await expect(first).resolves.toBe('signed-out');
  await expect(second).resolves.toBe('done');
  expect(third).toBe(second);
  expect(deps.send).toHaveBeenCalledTimes(2);
  expect(deps.mark).toHaveBeenCalledTimes(1);
  expect(deps.mark).toHaveBeenCalledWith('2026-10-30', 1);
});

test('an unexpected failure resolves quietly with nothing marked', async () => {
  records = [row('2026-10-30')];
  deps.read.mockRejectedValueOnce(new Error('storage'));

  await expect(uploadWatchDailyHr(deps)).resolves.toBe('retry-later');
  expect(deps.send).not.toHaveBeenCalled();
});

describe('with the app wiring', () => {
  const { appConfig } = require('../../config');
  const native = {
    setHealthConsent: jest.fn(async () => {}),
    republishConsent: jest.fn(async () => {}),
    getDailyHr: jest.fn(),
    markUploaded: jest.fn(async () => {}),
    markRejected: jest.fn(async () => {}),
  };
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.resetModules();
    // Android build of the bridge so the native module is used.
    jest.doMock('../watchHealth', () => require('../watchHealth.android'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    Object.values(native).forEach(fn => fn.mockClear());
  });

  afterAll(() => {
    jest.dontMock('../watchHealth');
  });

  function load() {
    const upload =
      require('../watchDailyHrUpload') as typeof import('../watchDailyHrUpload');
    const store = require('../../data/api/tokenStore')
      .tokenStore as typeof import('../../data/api/tokenStore').tokenStore;
    // resetModules gives a fresh react-native, so the bridge goes on that instance.
    require('react-native').NativeModules.WatchHealth = native;
    return { upload, store };
  }

  function respond(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }

  test('POSTs to W06 with the access token and marks through the native module', async () => {
    const { upload, store } = load();
    store.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    native.getDailyHr.mockResolvedValue([row('2026-10-30', 3)]);
    fetchMock.mockResolvedValue(respond(200, ok(1)));

    await expect(upload.uploadWatchDailyHr()).resolves.toBe('done');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${appConfig.apiBaseUrl}/health-records/sync`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(JSON.parse(init.body).records[0]).not.toHaveProperty('uploaded');
    expect(native.markUploaded).toHaveBeenCalledWith('2026-10-30', 3);
  });

  test('a rejected record is stored through the native module', async () => {
    const { upload, store } = load();
    store.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    native.getDailyHr.mockResolvedValue([row('2026-10-30', 3)]);
    fetchMock.mockResolvedValue(respond(200, ok(1, [0])));

    await expect(upload.uploadWatchDailyHr()).resolves.toBe('done');
    expect(native.markRejected).toHaveBeenCalledWith('2026-10-30', 3);
    expect(native.markUploaded).not.toHaveBeenCalled();
  });

  test('CONSENT_REQUIRED withdraws consent on the phone and watch', async () => {
    const { upload, store } = load();
    store.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    native.getDailyHr.mockResolvedValue([row('2026-10-30')]);
    fetchMock.mockResolvedValue(
      respond(403, { code: 'CONSENT_REQUIRED', message: '동의 필요' }),
    );

    await expect(upload.uploadWatchDailyHr()).resolves.toBe(
      'consent-withdrawn',
    );
    expect(native.setHealthConsent).toHaveBeenCalledWith('DISAGREE');
    expect(native.markUploaded).not.toHaveBeenCalled();
  });
});
