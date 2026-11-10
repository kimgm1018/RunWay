import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import type { RunRecordDraft } from '../../types';
import { saveRunRecord } from '../runRecords';
import { tokenStore } from '../tokenStore';

// 4.5 러닝 결과 with the server (S15P31E105-529): the run is its session's record (H02). 합성 응답이며 실데이터가 아니다.

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const draft: RunRecordDraft = {
  mode: 'FREE',
  courseId: null,
  groupRunId: null,
  startedAt: '2026-11-08T00:00:00Z',
  durationSec: 1490,
  distanceM: 4100,
  averagePaceSecPerKm: 363,
  averageHeartRate: 150,
  averageCadence: 170,
  route: null,
  goalDistanceM: null,
  goalPaceSecPerKm: null,
  sessionId: '701',
};

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('a personal run reads its session record back from H02 and keeps the server totals', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      sessionId: 701,
      actualDistanceM: 4210.5,
      movingDurationSec: 1500,
      elapsedDurationSec: 1620,
      averagePaceSecPerKm: 356.4,
      averageHeartRate: 151.2,
      averageCadence: null,
      goalAchieved: null,
      courseId: null,
    }),
  );

  await expect(saveRunRecord(draft)).resolves.toEqual({
    recordId: '701',
    server: {
      distanceM: 4210.5,
      durationSec: 1500,
      averagePaceSecPerKm: 356,
      averageHeartRate: 151,
      averageCadence: null,
      goalAchieved: null,
    },
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/running-records/701`);
  expect(init.method).toBe('GET');
  // Nothing is created: the session already stored the run.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  [404, 'RECORD_NOT_FOUND'],
  [503, 'SERVICE_UNAVAILABLE'],
])(
  'a record H02 does not give back (%s %s) is unconfirmed, not lost',
  async (status, code) => {
    fetchMock.mockResolvedValue(
      respond(status, { code, message: '', details: {} }),
    );

    const failure = await saveRunRecord(draft).catch(error => error);
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as DataError).code).toBe('SAVE_UNCONFIRMED');
  },
);

test('a group run has no personal record to open and asks nothing', async () => {
  await expect(
    saveRunRecord({
      ...draft,
      mode: 'GROUP',
      groupRunId: '9',
      sessionId: null,
    }),
  ).resolves.toEqual({ recordId: null, server: null });
  expect(fetchMock).not.toHaveBeenCalled();
});
