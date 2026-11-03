import { appConfig } from '../../../config';
import { todayCondition } from '../../mock/fixtures';
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

const latest = (readinessDate: string) => ({
  id: 101,
  readinessScore: 74.6,
  readinessDate,
  readinessConfidence: 'LOW',
});

// Monday 11.02 08:00 in Korea, still 11.01 in UTC.
const getTodayCondition = createReadinessApi({
  base: async () => todayCondition,
  now: () => new Date('2026-11-01T23:00:00Z'),
});

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('R02 for today (KST) is the score, rounded, with no mock grade beside it', async () => {
  fetchMock.mockResolvedValue(respond(200, latest('2026-11-02')));

  const condition = await getTodayCondition();

  expect(condition).toMatchObject({
    date: '2026-11-02',
    readinessState: 'ready',
    readinessScore: 75,
    readinessSummary: null,
    lastAssessedDate: '2026-11-02',
    // Not in R02: these stay on the base data.
    sleepMinutes: todayCondition.sleepMinutes,
    restingHeartRate: todayCondition.restingHeartRate,
    weeklyLoad: todayCondition.weeklyLoad,
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

  await expect(getTodayCondition()).resolves.toMatchObject({
    readinessState: 'permissionDenied',
    readinessScore: null,
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
