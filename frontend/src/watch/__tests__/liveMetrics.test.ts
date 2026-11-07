import { createLiveMetrics, readBatchItems } from '../liveMetrics';

// 러닝 중 화면 실측값(S15P31E105-517): W07 본문(devices-health.md items)을 화면용으로 읽는다. 합성 값이며 실데이터가 아니다.

const metric = (
  measuredAt: string,
  values: Partial<{
    heartRateBpm: number | null;
    cadenceSpm: number | null;
    speedMps: number | null;
    totalDistanceM: number | null;
  }>,
) => ({
  type: 'METRIC_SAMPLE',
  measuredAt,
  elapsedDurationSec: 1,
  heartRateBpm: null,
  cadenceSpm: null,
  speedMps: null,
  gradePercent: null,
  totalDistanceM: null,
  routeProgressM: null,
  isHrMeasured: values.heartRateBpm != null,
  ...values,
});

const gps = (measuredAt: string, coordinates: [number, number]) => ({
  type: 'GPS_POINT',
  measuredAt,
  coordinates,
  accuracyM: 5,
  altitudeM: null,
});

const body = (items: unknown[]) =>
  JSON.stringify({
    id: '00000000-0000-4000-8000-000000000101',
    deviceId: 101,
    sessionId: 5001,
    schemaVersion: '1',
    items,
    payloadHash: '0'.repeat(64),
  });

test('reads heart rate, cadence, speed, distance and GPS from a W07 body and skips what does not fit', () => {
  const items = readBatchItems(
    body([
      metric('2026-11-07T01:00:01Z', { heartRateBpm: 142, cadenceSpm: 168 }),
      gps('2026-11-07T01:00:01Z', [129.13, 35.15]),
      { type: 'GPS_POINT', measuredAt: 'not a time', coordinates: [129.13, 35.15] },
      { type: 'GPS_POINT', measuredAt: '2026-11-07T01:00:02Z', coordinates: [500, 35.15] },
      { type: 'UNKNOWN', measuredAt: '2026-11-07T01:00:02Z' },
    ]),
  );
  expect(items.metrics).toEqual([
    {
      at: Date.parse('2026-11-07T01:00:01Z'),
      heartRate: 142,
      cadence: 168,
      speedMps: null,
      totalDistanceM: null,
    },
  ]);
  expect(items.points).toHaveLength(1);
  expect(readBatchItems('not json')).toEqual({ metrics: [], points: [] });
  expect(readBatchItems('{"items":3}')).toEqual({ metrics: [], points: [] });
});

test('the newest measurement wins, a resent batch changes nothing, and a late old value does not cover a newer one', () => {
  const live = createLiveMetrics();
  const first = body([
    metric('2026-11-07T01:00:05Z', { heartRateBpm: 150, cadenceSpm: 170, speedMps: 3, totalDistanceM: 520 }),
    gps('2026-11-07T01:00:00Z', [129.13, 35.15]),
    gps('2026-11-07T01:00:05Z', [129.1301, 35.1501]),
  ]);
  const shown = live.ingest(first, 'WATCH', 1000);
  expect(shown).toMatchObject({
    source: 'WATCH',
    heartRate: 150,
    cadence: 170,
    distanceM: 520,
    measuredAt: '2026-11-07T01:00:05.000Z',
    receivedAt: 1000,
  });
  expect(shown?.paceSecPerKm).toBeCloseTo(1000 / 3);
  expect(shown?.route).toHaveLength(2);

  // The same batch again (retry, restore after a relaunch): nothing new.
  expect(live.ingest(first, 'WATCH', 2000)).toBeNull();

  // An older sample that arrives late fills nothing over the newer values.
  const late = live.ingest(
    body([metric('2026-11-07T01:00:02Z', { heartRateBpm: 120, totalDistanceM: 300 })]),
    'WATCH',
    3000,
  );
  expect(late).toMatchObject({ heartRate: 150, distanceM: 520 });

  // Standing still: a speed under walking pace shows no pace instead of tens of minutes per km.
  const standing = live.ingest(
    body([metric('2026-11-07T01:00:10Z', { speedMps: 0.1 })]),
    'WATCH',
    4000,
  );
  expect(standing?.paceSecPerKm).toBeNull();
  // A sample without a heart rate keeps the last measured one; it is not turned into zero.
  expect(standing?.heartRate).toBe(150);
});

test('after a takeover the phone GPS adds to the watch distance and no heart rate or cadence stays up', () => {
  const live = createLiveMetrics();
  live.ingest(
    body([metric('2026-11-07T01:00:05Z', { heartRateBpm: 150, cadenceSpm: 170, totalDistanceM: 1000 })]),
    'WATCH',
    1000,
  );
  // About 111 m north over 30 s from the phone.
  const phone = live.ingest(
    body([
      gps('2026-11-07T01:01:00Z', [129.13, 35.15]),
      gps('2026-11-07T01:01:30Z', [129.13, 35.151]),
    ]),
    'PHONE',
    2000,
  );
  expect(phone?.source).toBe('PHONE');
  expect(phone?.heartRate).toBeNull();
  expect(phone?.cadence).toBeNull();
  expect(phone?.distanceM).toBeGreaterThan(1100);
  expect(phone?.distanceM).toBeLessThan(1120);
  // About 111 m in 30 s → about 4′30″/km from GPS alone.
  expect(phone?.paceSecPerKm).toBeGreaterThan(260);
  expect(phone?.paceSecPerKm).toBeLessThan(280);
});

test('with GPS only the distance is the length of the points', () => {
  const live = createLiveMetrics();
  const shown = live.ingest(
    body([
      gps('2026-11-07T01:00:00Z', [129.13, 35.15]),
      gps('2026-11-07T01:00:20Z', [129.13, 35.1505]),
    ]),
    'WATCH',
    1000,
  );
  expect(shown?.distanceM).toBeGreaterThan(50);
  expect(shown?.distanceM).toBeLessThan(60);
  expect(shown?.heartRate).toBeNull();
});
