import { readWeeklySteps } from '../weeklySteps';
import { emptyResult } from '../catalog';
import type { HealthProvider, MetricStatus } from '../types';
function provider(values: (number | null | 'error')[]): HealthProvider {
  let index = 0;
  return {
    platform: 'android',
    checkAvailability: async () => 'available',
    requestReadAccess: async () => {},
    openAccessSettings: async () => {},
    getDeviceInfo: async () => ({
      os: 'Android',
      manufacturer: 'test',
      model: 'test',
      version: '16',
    }),
    readMetric: jest.fn<
      ReturnType<HealthProvider['readMetric']>,
      Parameters<HealthProvider['readMetric']>
    >(async (metric, window) => {
      const value = values[index++];
      const status: MetricStatus =
        value === 'error' ? 'error' : value === null ? 'empty' : 'ready';
      return {
        ...emptyResult(metric, window, status),
        access: 'granted',
        readRoute: 'samsungDirect',
        sourceMode: 'samsungDirect',
        summary: {
          value: typeof value === 'number' ? value : null,
          unit: '걸음',
        },
        records:
          typeof value === 'number'
            ? [
                {
                  id: window.start,
                  metric,
                  startTime: window.start,
                  endTime: window.end,
                  source: { id: 'samsung', name: '삼성 헬스' },
                  value,
                  unit: '걸음',
                  aggregation: 'period',
                },
              ]
            : [],
      };
    }),
  };
}
const now = new Date('2026-10-20T15:30:00+09:00');
test('queries seven completed local days excluding today; preserves total and daily values', async () => {
  const api = provider([100, 200, 300, 400, 500, 600, 700]);
  const result = await readWeeklySteps(api, now);
  expect(api.readMetric).toHaveBeenCalledTimes(7);
  expect(result.window).toEqual({
    start: '2026-10-12T15:00:00.000Z',
    end: '2026-10-19T15:00:00.000Z',
  });
  expect(result.summary).toMatchObject({ value: 400, unit: '걸음/일' });
  expect(result.stepStatistics).toMatchObject({
    total: 2800,
    availableDays: 7,
    days: expect.any(Array),
  });
  expect(result.stepStatistics!.days.map(d => d.value)).toEqual([
    100, 200, 300, 400, 500, 600, 700,
  ]);
});
test('excludes missing days but counts explicitly returned zero', async () => {
  const result = await readWeeklySteps(
    provider([0, null, 600, null, null, null, null]),
    now,
  );
  expect(result).toMatchObject({
    status: 'ready',
    summary: { value: 300 },
    stepStatistics: { total: 600, availableDays: 2 },
  });
  expect(result.summary.note).toContain('2/7일');
});
test('all missing days are empty, never a zero average', async () => {
  expect(
    await readWeeklySteps(provider(Array(7).fill(null)), now),
  ).toMatchObject({
    status: 'empty',
    summary: { value: null },
    stepStatistics: { availableDays: 0, total: null },
  });
});
test('query errors do not silently count as missing days or successful average', async () => {
  const result = await readWeeklySteps(
    provider([100, 'error', 200, null, null, null, null]),
    now,
  );
  expect(result.status).toBe('error');
  expect(result.summary.value).toBeNull();
  expect(result.stepStatistics!.days[1].status).toBe('error');
});
