jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: () => true,
  isObjectTypeAvailable: () => true,
  requestAuthorization: async () => true,
  queryCategorySamples: jest.fn(),
}));
jest.mock('react-native-device-info', () => ({
  getModel: () => 'iPhone',
  getSystemVersion: () => '18',
}));
import * as HK from '@kingstinct/react-native-healthkit';
import { provider } from '../healthProvider.ios';
test('native sleep query includes pre-midnight stages and preserves an inBed episode', async () => {
  const sourceRevision = {
    source: { name: 'Watch', bundleIdentifier: 'watch' },
  };
  const stage = (uuid: string, start: string, end: string, value: number) => ({
    uuid,
    startDate: new Date(start),
    endDate: new Date(end),
    value,
    sourceRevision,
    metadata: {},
  });
  const records = [
    stage('bed', '2026-10-19T14:00:00Z', '2026-10-19T22:00:00Z', 0),
    stage('1', '2026-10-19T14:00:00Z', '2026-10-19T14:30:00Z', 3),
    stage('2', '2026-10-19T14:30:00Z', '2026-10-19T22:00:00Z', 4),
  ];
  (HK.queryCategorySamples as jest.Mock).mockImplementation(
    async (_id, options) =>
      records.filter(r => r.endDate > options.filter.date.startDate),
  );
  await provider.requestReadAccess();
  const result = await provider.readMetric('sleep', {
    start: '2026-10-19T15:00:00Z',
    end: '2026-10-20T03:00:00Z',
  });
  expect(result.summary.value).toBe(8 * 3600000);
  expect(result.records[0].stages).toHaveLength(3);
});
