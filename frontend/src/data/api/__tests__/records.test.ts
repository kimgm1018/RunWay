import { appConfig } from '../../../config';
import { createRecordsApi } from '../records';
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

// H01 rows: a morning solo run with a decimal distance and pace, and an evening group run.
const solo = {
  id: 101,
  courseId: null,
  startedAt: '2026-10-28T22:10:00Z',
  totalDistance: 5020.5,
  movingDuration: 1800,
  averagePace: 358.52,
  goalAchieved: true,
};
const group = {
  id: 102,
  courseId: 7,
  startedAt: '2026-10-30T10:00:00Z',
  totalDistance: 6000,
  movingDuration: 2160,
  averagePace: 360,
  goalAchieved: null,
};

const statistics = {
  runCount: 2,
  totalDistanceM: 11020.5,
  totalDurationSec: 3960,
  averagePaceSecPerKm: 359.26,
  breakdown: [
    { week: 1, distanceM: 0 },
    { week: 5, distanceM: 11020.5 },
  ],
  heartRateZones: [
    { zone: 2, ratio: 0.5 },
    { zone: 1, ratio: 0.1 },
  ],
  previousPeriod: {
    runCount: 1,
    totalDistanceM: 4000,
    averagePaceSecPerKm: 371.4,
    runCountDelta: 1,
    totalDistanceMDelta: 7020.5,
    averagePaceSecPerKmDelta: -12.14,
  },
};

type Route = (url: URL) => ReturnType<typeof respond> | undefined;

// Answers by path; anything else fails the test.
function serve(route: Route) {
  fetchMock.mockImplementation(async (address: string) => {
    const url = new URL(address);
    const answer = route(url);
    if (!answer) {
      throw new Error(`unexpected request ${address}`);
    }
    return answer;
  });
}

const base = `${appConfig.apiBaseUrl}/running-records`;

function requested() {
  return fetchMock.mock.calls.map(([url]) => new URL(url));
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('H01 recent runs ask for solo runs in the chosen order', async () => {
  serve(() => respond(200, { items: [solo] }));
  const { records } = createRecordsApi();

  const recent = await records.getRecent('pace', 4);

  const [url] = requested();
  expect(`${url.origin}${url.pathname}`).toBe(base);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    runType: 'SOLO',
    sort: 'PACE',
    limit: '4',
  });
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer access-1',
  );
  expect(recent).toEqual([
    {
      id: '101',
      // 07:10 in Korea.
      title: '아침 러닝',
      startedAt: '2026-10-28T22:10:00Z',
      distanceM: 5020.5,
      durationSec: 1800,
      averagePaceSecPerKm: 359,
      shape: [],
      runType: 'SOLO',
      group: null,
      goalAchieved: true,
    },
  ]);
});

test('H01 month covers the Korean month, keeps run types and follows the cursor', async () => {
  serve(url => {
    if (url.pathname.endsWith('/statistics')) {
      return respond(200, statistics);
    }
    const runType = url.searchParams.get('runType');
    if (runType === 'GROUP') {
      return respond(200, { items: [group] });
    }
    // Solo runs come in two pages.
    return url.searchParams.get('cursor') === 'next'
      ? respond(200, {
          items: [{ ...solo, id: 100, startedAt: '2026-10-01T00:00:00Z' }],
        })
      : respond(200, { items: [solo], page: 'next' });
  });
  const { records } = createRecordsApi();

  const month = await records.getMonth('2026-10', 'ALL');

  const lists = requested().filter(url =>
    url.pathname.endsWith('/running-records'),
  );
  expect(lists).toHaveLength(3);
  expect(lists[0].searchParams.get('from')).toBe('2026-09-30T15:00:00.000Z');
  expect(lists[0].searchParams.get('to')).toBe('2026-10-31T15:00:00.000Z');
  expect(lists[0].searchParams.get('limit')).toBe('50');
  const stats = requested().find(url => url.pathname.endsWith('/statistics'))!;
  expect(Object.fromEntries(stats.searchParams)).toEqual({
    period: 'MONTH',
    baseDate: '2026-10-01',
  });
  expect(month.summary).toEqual({
    runCount: 2,
    totalDistanceM: 11020.5,
    totalDurationSec: 3960,
    averagePaceSecPerKm: 359,
  });
  expect(month.records.map(run => [run.id, run.runType, run.title])).toEqual([
    ['102', 'GROUP', '저녁 러닝'],
    ['101', 'SOLO', '아침 러닝'],
    ['100', 'SOLO', '아침 러닝'],
  ]);
});

test('H01 month with one tab asks for that run type only', async () => {
  serve(url =>
    url.pathname.endsWith('/statistics')
      ? respond(200, { ...statistics, runCount: 0, previousPeriod: null })
      : respond(200, { items: [] }),
  );
  const { records } = createRecordsApi();

  const month = await records.getMonth('2026-12', 'GROUP');

  const lists = requested().filter(url =>
    url.pathname.endsWith('/running-records'),
  );
  expect(lists.map(url => url.searchParams.get('runType'))).toEqual(['GROUP']);
  expect(lists[0].searchParams.get('to')).toBe('2026-12-31T15:00:00.000Z');
  expect(month.records).toEqual([]);
});

test('H02 and H03 fill the detail of a listed run', async () => {
  serve(url => {
    if (url.pathname.endsWith('/101/splits')) {
      return respond(200, {
        splits: [
          {
            startDistanceM: 0,
            endDistanceM: 1000,
            paceSecPerKm: 355.6,
            averageHeartRate: 150,
            averageCadence: 170,
          },
          {
            startDistanceM: 1000,
            endDistanceM: 1020.5,
            paceSecPerKm: null,
            averageHeartRate: null,
            averageCadence: null,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/101')) {
      return respond(200, {
        sessionId: 101,
        targetDistanceM: 5000,
        targetDurationSec: 1800,
        actualDistanceM: 5020.5,
        movingDurationSec: 1795,
        elapsedDurationSec: 1900,
        averagePaceSecPerKm: 357.53,
        averageHeartRate: 150,
        averageCadence: 170,
        goalAchieved: true,
        courseId: 7,
        targetPaceSecPerKm: 360,
        comparisonSessionId: null,
      });
    }
    return respond(200, { items: [solo] });
  });
  const { records } = createRecordsApi();
  await records.getRecent('recent', 1);
  fetchMock.mockClear();

  const detail = await records.getDetail('101');

  // The listed row is reused, so only H02 and H03 go out.
  expect(
    requested().map(url => url.pathname.split('/running-records')[1]),
  ).toEqual(['/101', '/101/splits']);
  expect(detail).toMatchObject({
    id: '101',
    title: '아침 러닝',
    startedAt: '2026-10-28T22:10:00Z',
    distanceM: 5020.5,
    durationSec: 1795,
    averagePaceSecPerKm: 358,
    goalAchieved: true,
    route: null,
    targetDurationSec: 1800,
    targetPaceSecPerKm: 360,
    aiAdvice: null,
    courseId: '7',
    myCourseId: null,
  });
  expect(detail.splits.map(split => split.paceSecPerKm)).toEqual([356, null]);
});

test('H02 for a run not listed yet finds it in H01 first', async () => {
  serve(url => {
    if (url.pathname.endsWith('/splits')) {
      return respond(200, { splits: [] });
    }
    if (url.pathname.endsWith('/102')) {
      return respond(200, {
        sessionId: 102,
        targetDistanceM: null,
        targetDurationSec: null,
        actualDistanceM: null,
        movingDurationSec: null,
        elapsedDurationSec: null,
        averagePaceSecPerKm: null,
        averageHeartRate: null,
        averageCadence: null,
        goalAchieved: null,
        courseId: null,
        targetPaceSecPerKm: null,
        comparisonSessionId: null,
      });
    }
    return url.searchParams.get('runType') === 'GROUP'
      ? respond(200, { items: [group] })
      : respond(200, { items: [solo] });
  });
  const { records } = createRecordsApi();

  const detail = await records.getDetail('102');

  expect(detail).toMatchObject({
    runType: 'GROUP',
    startedAt: '2026-10-30T10:00:00Z',
    // Missing H02 values fall back to the list row.
    distanceM: 6000,
    durationSec: 2160,
    averagePaceSecPerKm: 360,
    courseId: null,
    splits: [],
  });
});

test('H02 errors such as a deleted run are passed on', async () => {
  serve(() =>
    respond(404, { code: 'RECORD_NOT_FOUND', message: '', details: {} }),
  );
  const { records } = createRecordsApi();
  await expect(records.getDetail('999')).rejects.toMatchObject({
    code: 'RECORD_NOT_FOUND',
  });
});

test('H06 statistics become bars, zones in order and the previous period', async () => {
  serve(() => respond(200, statistics));
  const { records } = createRecordsApi();

  const result = await records.getStatistics('MONTH', '2026-10-15');

  expect(Object.fromEntries(requested()[0].searchParams)).toEqual({
    period: 'MONTH',
    baseDate: '2026-10-15',
  });
  expect(result).toEqual({
    runCount: 2,
    totalDistanceM: 11020.5,
    totalDurationSec: 3960,
    averagePaceSecPerKm: 359,
    breakdown: [0, 11020.5],
    heartRateZones: [0.1, 0.5],
    previousPeriod: {
      runCount: 1,
      totalDistanceM: 4000,
      averagePaceSecPerKm: 371,
    },
  });
});

test('H06 without earlier runs or heart rate leaves those parts empty', async () => {
  serve(() =>
    respond(200, {
      ...statistics,
      averagePaceSecPerKm: null,
      heartRateZones: [],
      previousPeriod: { ...statistics.previousPeriod, runCount: 0 },
    }),
  );
  const { records } = createRecordsApi();

  const result = await records.getStatistics('WEEK', '2026-10-15');

  expect(result.averagePaceSecPerKm).toBeNull();
  expect(result.heartRateZones).toEqual([]);
  expect(result.previousPeriod).toBeNull();
});

test('H07 pace trend keeps empty months and rounds the paces', async () => {
  serve(() =>
    respond(200, {
      items: [
        { month: '2026-09', averagePaceSecPerKm: 371.6, runCount: 2 },
        { month: '2026-10', averagePaceSecPerKm: null, runCount: 0 },
      ],
      changeSecPerKm: null,
    }),
  );
  const { records } = createRecordsApi();

  const trend = await records.getPaceTrend(6);

  expect(requested()[0].pathname).toMatch(
    /\/running-records\/statistics\/pace-trend$/,
  );
  expect(requested()[0].searchParams.get('months')).toBe('6');
  expect(trend).toEqual({
    items: [
      { month: '2026-09', averagePaceSecPerKm: 372, runCount: 2 },
      { month: '2026-10', averagePaceSecPerKm: null, runCount: 0 },
    ],
    changeSecPerKm: null,
  });
});

test('2.1 러닝 분석 sums the weekday bars and turns the pace delta into an improvement', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-31T03:00:00Z') });
  serve(url =>
    url.pathname.endsWith('/statistics')
      ? respond(200, statistics)
      : url.searchParams.get('runType') === 'GROUP'
      ? respond(200, { items: [group] })
      : respond(200, { items: [solo] }),
  );
  const { getMonthlySummary } = createRecordsApi();

  const summary = await getMonthlySummary();
  jest.useRealTimers();

  expect(requested()[0].searchParams.get('baseDate')).toBe('2026-10-01');
  expect(summary).toEqual({
    month: '2026-10',
    runCount: 2,
    totalDistanceM: 11020.5,
    averagePaceSecPerKm: 359,
    // Thursday 07:10 and Friday 19:00 in Korea; Friday ran farther.
    weekdayRatios: [0, 0, 0, 5020.5 / 6000, 1, 0, 0],
    paceImprovementSec: 12,
  });
});

test('S09 deletes the run by its session ID and forgets it', async () => {
  serve(url =>
    url.pathname.endsWith('/running-sessions/201')
      ? respond(200, { id: 201, deletedAt: '2026-10-29T09:00:00Z' })
      : undefined,
  );
  const { records } = createRecordsApi();
  await expect(records.remove('201')).resolves.toBeUndefined();
  const [address, init] = fetchMock.mock.calls[0];
  expect(address).toBe(`${appConfig.apiBaseUrl}/running-sessions/201`);
  expect(init.method).toBe('DELETE');
  expect(init.body).toBeUndefined();
});

test('S09 errors such as a run still being analysed are passed on', async () => {
  serve(() =>
    respond(409, { code: 'INVALID_STATE', message: '', details: {} }),
  );
  const { records } = createRecordsApi();
  await expect(records.remove('201')).rejects.toMatchObject({
    code: 'INVALID_STATE',
    status: 409,
  });
});
