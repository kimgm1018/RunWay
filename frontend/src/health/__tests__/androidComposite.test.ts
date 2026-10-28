import { createAndroidComposite } from '../androidComposite';
import { emptyResult } from '../catalog';
import type { HealthProvider, MetricStatus } from '../types';
test('missing HC service is unavailable rather than a query failure during fallback', async () => {
  const hc = {
    ...provider('error'),
    checkAvailability: async () => 'unavailable' as const,
    readMetric: jest.fn(provider('error').readMetric),
  };
  expect(
    await createAndroidComposite(provider('unavailable'), hc).readMetric(
      'hrv',
      window,
    ),
  ).toMatchObject({ status: 'unavailable', readRoute: 'healthConnect' });
  expect(hc.readMetric).not.toHaveBeenCalled();
});
const window = { start: '2026-10-19T15:00:00Z', end: '2026-10-20T03:00:00Z' };
function provider(
  status: MetricStatus,
  value: number | null = null,
): HealthProvider {
  return {
    platform: 'android',
    checkAvailability: async () => 'available',
    requestReadAccess: async () => {},
    openAccessSettings: async () => {},
    getDeviceInfo: async () => ({
      os: 'Android',
      manufacturer: 'Samsung',
      model: 'test',
      version: '16',
    }),
    readMetric: async (metric, period) => ({
      ...emptyResult(metric, period, status),
      summary: { value, unit: 'bpm' },
      sourceMode: status === 'ready' ? 'samsung' : 'none',
    }),
  };
}
test('Samsung direct value has priority without adding or querying HC values', async () => {
  const hc = {
    ...provider('ready', 99),
    readMetric: jest.fn(provider('ready', 99).readMetric),
  };
  const result = await createAndroidComposite(
    provider('ready', 61),
    hc,
  ).readMetric('heartRate', window);
  expect(result).toMatchObject({
    status: 'ready',
    summary: { value: 61 },
    readRoute: 'samsungDirect',
    sourceMode: 'samsungDirect',
  });
  expect(hc.readMetric).not.toHaveBeenCalled();
});
test.each(['empty', 'unavailable'] as const)(
  'successful %s direct result is complemented from HC',
  async status => {
    const result = await createAndroidComposite(
      provider(status),
      provider('ready', 72),
    ).readMetric('heartRate', window);
    expect(result).toMatchObject({
      status: 'ready',
      summary: { value: 72 },
      readRoute: 'healthConnect',
      fallbackFrom: status,
      sourceMode: 'samsung',
    });
  },
);
test.each(['error', 'accessRequired'] as const)(
  '%s is kept explicit and cannot silently become fallback success',
  async status => {
    const hc = {
      ...provider('ready', 99),
      readMetric: jest.fn(provider('ready', 99).readMetric),
    };
    expect(
      await createAndroidComposite(provider(status), hc).readMetric(
        'heartRate',
        window,
      ),
    ).toMatchObject({
      status,
      readRoute: 'samsungDirect',
      summary: { value: null },
    });
    expect(hc.readMetric).not.toHaveBeenCalled();
  },
);
test('unavailable Samsung service still allows HC initialization and permissions', async () => {
  const request = jest.fn(async () => {});
  const direct = {
    ...provider('unavailable'),
    checkAvailability: async () => 'unavailable' as const,
    requestReadAccess: jest.fn(async () => {}),
  };
  const combined = createAndroidComposite(direct, {
    ...provider('empty'),
    requestReadAccess: request,
  });
  expect(await combined.checkAvailability()).toBe('available');
  await combined.requestReadAccess();
  expect(direct.requestReadAccess).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
});
test('permission requests are sequential and HC is attempted after Samsung request error', async () => {
  const events: string[] = [];
  const combined = createAndroidComposite(
    {
      ...provider('empty'),
      requestReadAccess: async () => {
        events.push('samsung');
        throw new Error('denied');
      },
    },
    {
      ...provider('empty'),
      requestReadAccess: async () => {
        events.push('hc');
      },
    },
  );
  await expect(combined.requestReadAccess()).rejects.toThrow();
  expect(events).toEqual(['samsung', 'hc']);
});
