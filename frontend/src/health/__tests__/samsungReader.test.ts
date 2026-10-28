import { createSamsungReader, type SamsungSdk } from '../samsungReader';
import type { HealthRecord } from '../types';
const window = { start: '2026-10-19T15:00:00Z', end: '2026-10-20T06:00:00Z' };
const row: HealthRecord = {
  id: 'test',
  metric: 'heartRate',
  startTime: '2026-10-20T01:00:00Z',
  endTime: '2026-10-20T01:00:00Z',
  source: { id: 'source.app', name: '원본 앱' },
  value: 65,
  unit: 'bpm',
};
function sdk(records: HealthRecord[] = [row]): SamsungSdk {
  return {
    availability: async () => 'available',
    request: async () => {},
    read: jest.fn(async () => records),
    openSettings: async () => {},
    device: async () => ({
      os: 'Android',
      manufacturer: 'Samsung',
      model: 'test',
      version: '16',
    }),
  };
}
test.each(['restingHeartRate', 'hrv'] as const)(
  '%s goes to HC without querying unsupported Samsung type',
  async metric => {
    const api = sdk();
    expect(
      (await createSamsungReader(api).readMetric(metric, window)).status,
    ).toBe('unavailable');
    expect(api.read).not.toHaveBeenCalled();
  },
);
test('keeps origin and filters out-of-window and invalid heart samples', async () => {
  const api = sdk([
    row,
    {
      ...row,
      id: 'old',
      startTime: '2026-10-18T01:00:00Z',
      endTime: '2026-10-18T01:00:00Z',
    },
    { ...row, id: 'invalid', value: NaN },
  ]);
  const result = await createSamsungReader(api).readMetric('heartRate', window);
  expect(result).toMatchObject({
    status: 'ready',
    sourceMode: 'samsungDirect',
    summary: { value: 65 },
  });
  expect(result.records).toEqual([row]);
});
test('zero aggregate is ready; missing aggregate is empty', async () => {
  const steps = {
    ...row,
    metric: 'steps' as const,
    value: 0,
    unit: '걸음',
    aggregation: 'period' as const,
  };
  expect(
    await createSamsungReader(sdk([steps])).readMetric('steps', window),
  ).toMatchObject({ status: 'ready', summary: { value: 0 } });
  expect(
    (await createSamsungReader(sdk([])).readMetric('steps', window)).status,
  ).toBe('empty');
});
test.each(['SAMSUNG_PERMISSION', 'SAMSUNG_POLICY'])(
  'preserves %s as accessRequired',
  async code => {
    const api = {
      ...sdk(),
      read: async () => {
        throw { code };
      },
    };
    expect(
      (await createSamsungReader(api).readMetric('sleep', window)).status,
    ).toBe('accessRequired');
  },
);
test('unknown query failure stays error; unavailability remains fallback eligible', async () => {
  for (const [code, status] of [
    ['SAMSUNG_QUERY', 'error'],
    ['SAMSUNG_UNAVAILABLE', 'unavailable'],
  ] as const) {
    const api = {
      ...sdk(),
      read: async () => {
        throw { code };
      },
    };
    expect(
      (await createSamsungReader(api).readMetric('sleep', window)).status,
    ).toBe(status);
  }
});
test('preserves overnight sleep stages without making duration from session span', async () => {
  const sleep = {
    ...row,
    metric: 'sleep' as const,
    startTime: '2026-10-19T14:00:00Z',
    endTime: '2026-10-19T23:00:00Z',
    value: undefined,
    stages: [],
  };
  expect(
    await createSamsungReader(sdk([sleep])).readMetric('sleep', window),
  ).toMatchObject({
    status: 'ready',
    summary: { value: null },
    records: [{ startTime: sleep.startTime }],
  });
});
test('labels actual exercise distance separately from total travel distance', async () => {
  const distance = {
    ...row,
    metric: 'distance' as const,
    value: 1234,
    unit: 'm',
    distanceKind: 'workout' as const,
  };
  expect(
    await createSamsungReader(sdk([distance])).readMetric('distance', window),
  ).toMatchObject({
    status: 'ready',
    summary: { value: 1234, note: expect.stringContaining('운동') },
  });
});

test('averages Samsung reported duration by wake date without requiring stages or summing seven days', async () => {
  const sleep = {
    ...row,
    metric: 'sleep' as const,
    startTime: '2026-10-19T14:00:00Z',
    endTime: '2026-10-19T23:00:00Z',
    value: undefined,
    stages: [],
    reportedSleepMs: 23400000,
    sleepScore: 84,
  };
  const old = {
    ...sleep,
    id: 'old',
    startTime: '2026-10-18T14:00:00Z',
    endTime: '2026-10-18T23:00:00Z',
    reportedSleepMs: 28800000,
    sleepScore: 90,
  };
  const result = await createSamsungReader(sdk([sleep, old])).readMetric(
    'sleep',
    { ...window, start: '2026-10-12T15:00:00Z' },
  );
  expect(result).toMatchObject({
    status: 'ready',
    summary: {
      value: 26100000,
      unit: 'ms',
      sleepScore: 84,
      note: expect.stringContaining('2일'),
    },
  });
});

test('combines same-day sleep records before averaging and excludes missing days', async () => {
  const sleep = {
    ...row,
    metric: 'sleep' as const,
    value: undefined,
    stages: [],
    reportedSleepMs: 3600000,
  };
  const rows = [
    {
      ...sleep,
      id: 'night',
      startTime: '2026-10-18T15:00:00Z',
      endTime: '2026-10-18T22:00:00Z',
      reportedSleepMs: 21600000,
    },
    {
      ...sleep,
      id: 'nap',
      startTime: '2026-10-19T03:00:00Z',
      endTime: '2026-10-19T04:00:00Z',
    },
    {
      ...sleep,
      id: 'next',
      startTime: '2026-10-19T15:00:00Z',
      endTime: '2026-10-19T23:00:00Z',
      reportedSleepMs: 28800000,
    },
  ];
  const result = await createSamsungReader(sdk(rows)).readMetric('sleep', {
    ...window,
    start: '2026-10-12T15:00:00Z',
  });
  expect(result.summary.value).toBe(27000000);
  expect(result.summary.note).toContain('2일');
});
test('uses real score when duration absent and does not invent duration from score', async () => {
  const sleep = {
    ...row,
    metric: 'sleep' as const,
    startTime: '2026-10-19T14:00:00Z',
    endTime: '2026-10-19T23:00:00Z',
    value: undefined,
    stages: [],
    sleepScore: 77,
  };
  expect(
    await createSamsungReader(sdk([sleep])).readMetric('sleep', window),
  ).toMatchObject({ summary: { value: null, sleepScore: 77 } });
});
test('missing or invalid reported sleep duration and score never become displayed values', async () => {
  const sleep = {
    ...row,
    metric: 'sleep' as const,
    startTime: '2026-10-19T14:00:00Z',
    endTime: '2026-10-19T23:00:00Z',
    value: undefined,
    stages: [],
    reportedSleepMs: NaN,
    sleepScore: 101,
  };
  const result = await createSamsungReader(sdk([sleep])).readMetric(
    'sleep',
    window,
  );
  expect(result.summary.value).toBeNull();
  expect(result.summary.sleepScore).toBeUndefined();
});
