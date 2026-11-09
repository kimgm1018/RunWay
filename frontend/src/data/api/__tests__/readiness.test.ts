import { appConfig } from '../../../config';
import { createReadinessApi } from '../readiness';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const latest = (
  readinessDate: string,
  health: {
    restingHrBpm?: number | null;
    restingHrSource?: string | null;
    sleepDurationMin?: number | null;
    healthUpdatedAt?: string | null;
  } = {},
) => ({
  id: 101,
  readinessScore: 74.6,
  readinessDate,
  readinessConfidence: 'LOW',
  restingHrBpm: 58.4,
  sleepDurationMin: 431.6,
  healthUpdatedAt: '2026-11-01T21:05:00Z',
  ...health,
});

// Monday 11.02 08:00 in Korea, still 11.01 in UTC.
const getTodayCondition = createReadinessApi({
  now: () => new Date('2026-11-01T23:00:00Z'),
});

// Nothing in R02 backs these, so API mode never shows them (no mock values).
const unbacked = {
  condition: null,
  readinessSummary: null,
  sleepLabel: null,
  restingHeartRateLabel: null,
  weeklyLoad: null,
  weeklyLoadLabel: null,
  aiAdvice: null,
};

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('R02 for today (KST) is the score with that day\'s own sleep and resting heart rate', async () => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-11-02')));

  const condition = await getTodayCondition();

  expect(condition).toEqual({
    date: '2026-11-02',
    syncedAt: '2026-11-01T21:05:00Z',
    readinessState: 'ready',
    readinessScore: 75,
    sleepMinutes: 432,
    restingHeartRate: 58,
    lastAssessedDate: '2026-11-02',
    ...unbacked,
  });
  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(
    `${appConfig.apiBaseUrl}/readiness-assessments/latest`,
  );
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

test('R02 from an earlier day is 2.P′ 오래된 데이터 without a score', async () => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-10-30')));

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'stale',
    readinessScore: null,
    lastAssessedDate: '2026-10-30',
  });
});

test('R02 with no result yet (404) is 준비도 수집 중', async () => {
  fetchMock.mockResolvedValue(
    respond(404, { code: 'ASSESSMENT_NOT_FOUND', message: '', details: {} }),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'collecting',
    readinessScore: null,
    lastAssessedDate: null,
  });
});

test('R02 without health consent (403) is 권한 없음', async () => {
  fetchMock.mockResolvedValue(
    respond(403, { code: 'CONSENT_REQUIRED', message: '', details: {} }),
  );

  await expect(getTodayCondition()).resolves.toEqual({
    date: '2026-11-02',
    syncedAt: null,
    readinessState: 'permissionDenied',
    readinessScore: null,
    sleepMinutes: null,
    restingHeartRate: null,
    lastAssessedDate: null,
    ...unbacked,
  });
});

test('R02 passes other failures on', async () => {
  fetchMock.mockResolvedValue(
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
  );

  await expect(getTodayCondition()).rejects.toMatchObject({
    code: 'SERVER_ERROR',
  });
});

test('R02 one day ahead of KST (watch time zone) still counts as today', async () => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-11-03')));

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'ready',
    restingHeartRate: 58,
  });
});

test('R02 with only some metrics leaves the missing ones unknown', async () => {
  fetchMock.mockResolvedValue(
    respond(200, latest('2026-11-02', { sleepDurationMin: null })),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'ready',
    sleepMinutes: null,
    restingHeartRate: 58,
    syncedAt: '2026-11-01T21:05:00Z',
  });
});

// S15P31E105-600: the resting heart rate names its source (D-9).
test.each([
  ['RUNWAY_WATCH', 'RunWay 워치'],
  ['SAMSUNG_HEALTH', '삼성 헬스'],
  [null, null],
  ['SOMETHING_NEW', null],
])('R02 resting heart rate source %s is labelled %s', async (source, label) => {
  fetchMock.mockResolvedValue(
    respond(200, latest('2026-11-02', { restingHrSource: source })),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    restingHeartRate: 58,
    restingHeartRateLabel: label,
  });
});

test('no resting heart rate means no source label', async () => {
  fetchMock.mockResolvedValue(
    respond(
      200,
      latest('2026-11-02', { restingHrBpm: null, restingHrSource: 'SAMSUNG_HEALTH' }),
    ),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    restingHeartRate: null,
    restingHeartRateLabel: null,
  });
});

test('R02 with no health row for the day shows no metrics or sync time', async () => {
  fetchMock.mockResolvedValue(
    respond(
      200,
      latest('2026-11-02', {
        restingHrBpm: null,
        sleepDurationMin: null,
        healthUpdatedAt: null,
      }),
    ),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'ready',
    readinessScore: 75,
    sleepMinutes: null,
    restingHeartRate: null,
    syncedAt: null,
  });
});

test('an earlier day\'s metrics are not shown as today\'s', async () => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-11-01')));

  await expect(getTodayCondition()).resolves.toEqual({
    date: '2026-11-02',
    syncedAt: null,
    readinessState: 'stale',
    readinessScore: null,
    sleepMinutes: null,
    restingHeartRate: null,
    lastAssessedDate: '2026-11-01',
    ...unbacked,
  });
});

test('no result yet carries no mock metrics', async () => {
  fetchMock.mockResolvedValue(
    respond(404, { code: 'ASSESSMENT_NOT_FOUND', message: '', details: {} }),
  );

  await expect(getTodayCondition()).resolves.toEqual({
    date: '2026-11-02',
    syncedAt: null,
    readinessState: 'collecting',
    readinessScore: null,
    sleepMinutes: null,
    restingHeartRate: null,
    lastAssessedDate: null,
    ...unbacked,
  });
});

// KST midnight is 15:00 UTC: just before it, 11.01 is still today; from it, 11.01 is an earlier day.
test.each([
  ['2026-11-01T14:59:59Z', 'ready'],
  ['2026-11-01T15:00:00Z', 'stale'],
])('around KST midnight (%s) an 11.01 result is %s', async (at, state) => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-11-01')));
  const read = createReadinessApi({ now: () => new Date(at) });

  const condition = await read();

  expect(condition.readinessState).toBe(state);
  expect(condition.restingHeartRate).toBe(state === 'ready' ? 58 : null);
});

test('a server without the metric fields leaves them unknown, not undefined', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      id: 101,
      readinessScore: 74.6,
      readinessDate: '2026-11-02',
      readinessConfidence: 'LOW',
    }),
  );

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'ready',
    sleepMinutes: null,
    restingHeartRate: null,
    syncedAt: null,
  });
});
