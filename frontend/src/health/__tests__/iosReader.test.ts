import { createIosReader, type IosSdk } from '../iosReader';
const window = { start: '2026-10-19T15:00:00Z', end: '2026-10-20T03:00:00Z' };
function sdk(overrides: Partial<IosSdk> = {}): IosSdk {
  return {
    available: async () => true,
    typeAvailable: () => true,
    request: async () => {},
    read: async () => [],
    aggregate: async () => 0,
    openSettings: async () => {},
    device: async () => ({
      os: 'iOS',
      manufacturer: 'Apple',
      model: 'iPhone',
      version: '18',
    }),
    ...overrides,
  };
}
test('authorization completion does not claim read permission granted', async () => {
  const reader = createIosReader(sdk());
  expect((await reader.readMetric('steps', window)).status).toBe(
    'accessRequired',
  );
  await reader.requestReadAccess();
  expect(await reader.readMetric('steps', window)).toMatchObject({
    status: 'empty',
    access: 'unobservable',
    summary: { value: null },
    records: [],
  });
});
test('SDNN keeps its method, unit, actual source and manual flag', async () => {
  const reader = createIosReader(
    sdk({
      read: async () => [
        {
          id: 'a',
          startTime: '2026-10-20T00:00:00Z',
          endTime: '2026-10-20T00:00:00Z',
          source: { id: 'apple.watch', name: 'Apple Watch' },
          value: 42,
          manuallyEntered: true,
        },
      ],
    }),
  );
  await reader.requestReadAccess();
  expect(await reader.readMetric('hrv', window)).toMatchObject({
    status: 'ready',
    access: 'unobservable',
    summary: { value: 42, unit: 'ms', note: 'SDNN' },
    records: [
      { method: 'sdnn', manuallyEntered: true, source: { id: 'apple.watch' } },
    ],
  });
});
test('steps use platform aggregate instead of summing overlapping sources', async () => {
  const reader = createIosReader(
    sdk({
      read: async () =>
        ['phone', 'watch'].map(id => ({
          id,
          startTime: window.start,
          endTime: window.end,
          source: { id, name: id },
          value: 100,
        })),
      aggregate: async () => 120,
    }),
  );
  await reader.requestReadAccess();
  expect((await reader.readMetric('steps', window)).summary.value).toBe(120);
});
test('unavailable type and query failure are distinct from empty records', async () => {
  const unavailable = createIosReader(sdk({ typeAvailable: () => false }));
  await unavailable.requestReadAccess();
  expect((await unavailable.readMetric('hrv', window)).status).toBe(
    'unavailable',
  );
  const failed = createIosReader(
    sdk({
      read: async () => {
        throw new Error('native');
      },
    }),
  );
  await failed.requestReadAccess();
  expect(await failed.readMetric('sleep', window)).toMatchObject({
    status: 'error',
    records: [],
    summary: { value: null },
  });
});
test('split overnight stages preserve the full same-source sleep episode', async () => {
  const source = { id: 'watch', name: 'Watch' };
  const intervals = [
    ['2026-10-19T14:00:00Z', '2026-10-19T14:30:00Z'],
    ['2026-10-19T14:30:00Z', '2026-10-19T16:00:00Z'],
    ['2026-10-19T16:00:00Z', '2026-10-19T22:00:00Z'],
  ];
  const reader = createIosReader(
    sdk({
      read: async () =>
        intervals.map(([startTime, endTime], index) => ({
          id: String(index),
          startTime,
          endTime,
          source,
          stages: [{ startTime, endTime, stage: 'asleep' }],
        })),
    }),
  );
  await reader.requestReadAccess();
  const result = await reader.readMetric('sleep', window);
  expect(result.summary.value).toBe(8 * 3600000);
  expect(result.records[0].startTime).toBe(intervals[0][0]);
});
