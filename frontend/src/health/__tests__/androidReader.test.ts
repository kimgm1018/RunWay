import { createAndroidReader, type AndroidSdk } from '../androidReader';
import { readAllPages } from '../pagination';
const window = { start: '2026-10-19T15:00:00Z', end: '2026-10-20T03:00:00Z' };
const samsung = 'com.sec.android.app.shealth';
const record = {
  metadata: { id: 'r1', dataOrigin: 'other.app' },
  time: '2026-10-20T00:00:00Z',
  beatsPerMinute: 61,
};
function sdk(overrides: Partial<AndroidSdk> = {}): AndroidSdk {
  return {
    availability: async () => 'available',
    request: async () => {},
    grantedTypes: async () => [
      'RestingHeartRate',
      'HeartRate',
      'Steps',
      'SleepSession',
      'HeartRateVariabilityRmssd',
      'Distance',
      'ExerciseSession',
    ],
    readPage: async () => ({ records: [] }),
    aggregateSteps: async () => null,
    openSettings: async () => {},
    device: async () => ({
      os: 'Android',
      manufacturer: 'Samsung',
      model: 'test',
      version: '14',
    }),
    ...overrides,
  };
}
describe('Android reader', () => {
  test('empty Samsung resting heart rate falls back to actual other origin', async () => {
    const reader = createAndroidReader(
      sdk({
        readPage: async (_type, _period, origin) => {
          if (origin === samsung) {
            return { records: [] };
          }
          return { records: [record] };
        },
      }),
    );
    expect(await reader.readMetric('restingHeartRate', window)).toMatchObject({
      status: 'ready',
      sourceMode: 'healthConnectOther',
      summary: { value: 61, unit: 'bpm' },
      records: [{ source: { id: 'other.app' }, value: 61 }],
    });
  });
  test('Samsung result takes priority over a newer other-origin result', async () => {
    const reader = createAndroidReader(
      sdk({
        readPage: async (_t, _w, origin) => {
          if (origin !== samsung) {
            throw new Error('Other origins must not be read');
          }
          return {
            records: [
              {
                ...record,
                metadata: { id: 's1', dataOrigin: samsung },
                beatsPerMinute: 58,
              },
            ],
          };
        },
      }),
    );
    expect(await reader.readMetric('restingHeartRate', window)).toMatchObject({
      status: 'ready',
      sourceMode: 'samsung',
      summary: { value: 58 },
    });
  });
  test('denied permission does not trigger a query or fallback', async () => {
    const reader = createAndroidReader(
      sdk({
        grantedTypes: async () => [],
        readPage: async () => {
          throw new Error('Must not read');
        },
      }),
    );
    expect(await reader.readMetric('restingHeartRate', window)).toMatchObject({
      status: 'accessRequired',
      records: [],
      summary: { value: null },
    });
  });
  test('Samsung query failure is reported as error, not empty or fallback', async () => {
    const reader = createAndroidReader(
      sdk({
        readPage: async () => {
          throw new Error('Native failure');
        },
      }),
    );
    expect(await reader.readMetric('restingHeartRate', window)).toMatchObject({
      status: 'error',
      records: [],
    });
  });
  test('heart rate samples outside the period do not replace the latest in-range value', async () => {
    const reader = createAndroidReader(
      sdk({
        readPage: async () => ({
          records: [
            {
              metadata: { id: 'hr', dataOrigin: samsung },
              startTime: window.start,
              endTime: window.end,
              samples: [
                { time: '2026-10-20T00:30:00Z', beatsPerMinute: 72 },
                { time: '2026-10-21T00:00:00Z', beatsPerMinute: 140 },
              ],
            },
          ],
        }),
      }),
    );
    const result = await reader.readMetric('heartRate', window);
    expect(result.summary.value).toBe(72);
    expect(result.records).toHaveLength(1);
  });
  test('zero steps in a real record is distinct from no records', async () => {
    const reader = createAndroidReader(
      sdk({
        aggregateSteps: async () => 0,
        readPage: async () => ({
          records: [
            {
              metadata: { id: 'steps', dataOrigin: samsung },
              startTime: window.start,
              endTime: window.end,
              count: 0,
            },
          ],
        }),
      }),
    );
    expect(await reader.readMetric('steps', window)).toMatchObject({
      status: 'ready',
      summary: { value: 0 },
    });
  });
  test('pagination reads all pages and stops on an empty token', async () => {
    expect(
      await readAllPages(async token =>
        token
          ? { records: [2], pageToken: '' }
          : { records: [1], pageToken: 'next' },
      ),
    ).toEqual([1, 2]);
  });
  test('repeated pagination token is an error instead of silent truncation', async () => {
    await expect(
      readAllPages(async () => ({ records: [1], pageToken: 'same' })),
    ).rejects.toThrow();
  });
});
