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

// S15P31E105-549: in a WATCH run the phone also uploads its own GPS. The watch position wins per time window and the
// phone fills only where the watch has none; the phone GPS never adds distance nor takes over the shown source.
const gpsAt = (measuredAt: string, coordinates: [number, number], accuracyM: number | null) => ({
  ...gps(measuredAt, coordinates),
  accuracyM,
});

test('a WATCH run keeps the watch source, heart rate and distance when phone GPS arrives', () => {
  const live = createLiveMetrics();
  live.ingest(
    body([
      metric('2026-11-07T01:00:05Z', { heartRateBpm: 150, totalDistanceM: 1000 }),
      gps('2026-11-07T01:00:00Z', [129.13, 35.15]),
    ]),
    'WATCH',
    1000,
  );
  const shown = live.ingest(
    body([
      gps('2026-11-07T01:00:01Z', [129.2, 35.2]),
      gps('2026-11-07T01:01:00Z', [129.13, 35.151]),
    ]),
    'PHONE',
    2000,
    'WATCH',
  );
  expect(shown).toMatchObject({ source: 'WATCH', heartRate: 150, distanceM: 1000 });
  // The phone point 1 s after a watch point is the same window: the watch one is used.
  expect(shown?.route).toEqual([
    [129.13, 35.15],
    [129.13, 35.151],
  ]);
  // A different source starts a new part; the switch is not joined by a line.
  expect(shown?.routeParts).toEqual([[[129.13, 35.15]], [[129.13, 35.151]]]);
});

test('the route leaves out fixes over 30 m and breaks at gaps over 60 s', () => {
  const live = createLiveMetrics();
  const shown = live.ingest(
    body([
      gpsAt('2026-11-07T01:00:00Z', [129.13, 35.15], 5),
      gpsAt('2026-11-07T01:00:05Z', [129.1301, 35.1501], 40),
      gpsAt('2026-11-07T01:00:10Z', [129.1302, 35.1502], null),
      gpsAt('2026-11-07T01:01:20Z', [129.1303, 35.1503], 8),
      gpsAt('2026-11-07T01:01:25Z', [129.1304, 35.1504], 8),
    ]),
    'WATCH',
    1000,
  );
  expect(shown?.routeParts).toEqual([
    [
      [129.13, 35.15],
      [129.1302, 35.1502],
    ],
    [
      [129.1303, 35.1503],
      [129.1304, 35.1504],
    ],
  ]);
  // Distance from GPS alone does not bridge the gap either: about 29 m + 14 m, not 57 m with the gap joined.
  expect(shown?.distanceM).toBeGreaterThan(40);
  expect(shown?.distanceM).toBeLessThan(50);
});

test('after a takeover only the phone GPS since the takeover adds to the watch distance', () => {
  const live = createLiveMetrics();
  live.ingest(body([metric('2026-11-07T01:00:05Z', { totalDistanceM: 1000 })]), 'WATCH', 1000);
  // Phone GPS from the WATCH part of the run: shown on the map, not counted.
  live.ingest(
    body([
      gps('2026-11-07T01:00:10Z', [129.12, 35.14]),
      gps('2026-11-07T01:00:40Z', [129.12, 35.141]),
    ]),
    'PHONE',
    1500,
    'WATCH',
  );
  const after = live.ingest(
    body([
      gps('2026-11-07T01:02:00Z', [129.13, 35.15]),
      gps('2026-11-07T01:02:30Z', [129.13, 35.151]),
    ]),
    'PHONE',
    2000,
  );
  expect(after?.source).toBe('PHONE');
  expect(after?.distanceM).toBeGreaterThan(1100);
  expect(after?.distanceM).toBeLessThan(1120);
});

// A-4·A-8/B-8 (S15P31E105-549 review).
test('a position-only update is not a new sample, and the phone adds distance only after the takeover time', () => {
  const live = createLiveMetrics();
  const first = live.ingest(
    body([metric('2026-11-07T01:00:05Z', { heartRateBpm: 150, totalDistanceM: 1000 })]),
    'WATCH',
    1000,
  );
  expect(first?.newSample).toBe(true);
  const gpsOnly = live.ingest(body([gps('2026-11-07T01:00:30Z', [129.12, 35.14])]), 'PHONE', 1500, 'WATCH');
  expect(gpsOnly?.newSample).toBe(false);

  live.setPhoneSince(Date.parse('2026-11-07T01:02:00Z'));
  // The first phone batch after the takeover still holds a point from before it.
  const after = live.ingest(
    body([
      gps('2026-11-07T01:01:55Z', [129.13, 35.149]),
      gps('2026-11-07T01:02:00Z', [129.13, 35.15]),
      gps('2026-11-07T01:02:30Z', [129.13, 35.151]),
    ]),
    'PHONE',
    2000,
  );
  expect(after?.distanceM).toBeGreaterThan(1100);
  expect(after?.distanceM).toBeLessThan(1120);
});

// S15P31E105-549 실기기 피드백: 실내에서 가만히 있어 정확도 나쁜 위치만 와도 지도에 지금 위치 점은 보여야 한다.
test('with only inaccurate fixes the route stays empty but the current position is still known', () => {
  const live = createLiveMetrics();
  const shown = live.ingest(
    body([
      gpsAt('2026-11-07T01:00:00Z', [129.13, 35.15], 60),
      gpsAt('2026-11-07T01:00:05Z', [129.1301, 35.1501], 80),
    ]),
    'PHONE',
    1000,
    'WATCH',
  );
  expect(shown?.route).toEqual([]);
  expect(shown?.here).toEqual([129.1301, 35.1501]);
  // Once a usable fix arrives, it is the current position even if a worse one is newer.
  const better = live.ingest(
    body([
      gpsAt('2026-11-07T01:00:10Z', [129.1302, 35.1502], 6),
      gpsAt('2026-11-07T01:00:12Z', [129.2, 35.2], 90),
    ]),
    'PHONE',
    2000,
    'WATCH',
  );
  expect(better?.here).toEqual([129.1302, 35.1502]);
});

// S15P31E105-549 실기기 피드백: 워치 속도·워치 GPS가 아직 없으면 폰 GPS 조각으로 페이스를 보인다.
test('a WATCH run without watch speed or watch GPS shows the pace from the phone GPS part', () => {
  const live = createLiveMetrics();
  live.ingest(body([metric('2026-11-07T01:00:05Z', { heartRateBpm: 120 })]), 'WATCH', 1000);
  // About 111 m in 30 s from the phone → about 4′30″/km.
  const shown = live.ingest(
    body([
      gps('2026-11-07T01:01:00Z', [129.13, 35.15]),
      gps('2026-11-07T01:01:30Z', [129.13, 35.151]),
    ]),
    'PHONE',
    2000,
    'WATCH',
  );
  expect(shown?.source).toBe('WATCH');
  expect(shown?.paceSecPerKm).toBeGreaterThan(260);
  expect(shown?.paceSecPerKm).toBeLessThan(280);
  // No watch distance has come: the screen shows the phone GPS length meanwhile (S15P31E105-549, display only).
  expect(shown?.distanceM).toBeCloseTo(111, 0);
});

test('while the watch distance is quiet the screen bridges pace and distance with phone GPS, never going back', () => {
  // S15P31E105-549: watch screen off → Health Services sends distance about once a minute. Synthetic values.
  const base = Date.parse('2026-11-07T01:00:00Z');
  const live = createLiveMetrics();
  // A fresh watch distance: shown as it is.
  expect(
    live.ingest(
      body([metric('2026-11-07T01:00:00Z', { heartRateBpm: 120, totalDistanceM: 500, speedMps: 3 })]),
      'WATCH',
      base + 1_000,
    )?.distanceM,
  ).toBe(500);
  // Phone GPS 10 s later while the watch is fresh: the watch values stay.
  const fresh = live.ingest(
    body([gps('2026-11-07T01:00:05Z', [129.13, 35.15]), gps('2026-11-07T01:00:10Z', [129.13, 35.15027])]),
    'PHONE',
    base + 11_000,
    'WATCH',
  );
  expect(fresh?.distanceM).toBe(500);
  // 30 s without a watch distance: distance = watch 500 m + phone GPS since that watch sample, pace from phone GPS.
  const bridged = live.ingest(
    body([gps('2026-11-07T01:00:30Z', [129.13, 35.15081])]),
    'PHONE',
    base + 31_000,
    'WATCH',
  );
  expect(bridged?.distanceM).toBeGreaterThan(585);
  expect(bridged?.distanceM).toBeLessThan(595);
  // The last 20 s of phone GPS: about 60 m → about 5′33″/km.
  expect(bridged?.paceSecPerKm).toBeGreaterThan(320);
  expect(bridged?.paceSecPerKm).toBeLessThan(345);
  // The late watch batch (measured a minute ago) with a smaller total does not move the screen back.
  const late = live.ingest(
    body([metric('2026-11-07T01:00:20Z', { heartRateBpm: 125, totalDistanceM: 560, speedMps: 3 })]),
    'WATCH',
    base + 80_000,
  );
  expect(late?.distanceM).toBeGreaterThan(585);
});

test('the watch screen values (LIVE_METRICS) show until a newer batch value or 5 s without one', () => {
  // S15P31E105-549: display only, the route stays from the batches.
  const live = createLiveMetrics();
  live.ingest(
    body([
      metric('2026-11-10T01:00:00Z', { heartRateBpm: 140, totalDistanceM: 1000, speedMps: 3 }),
      gps('2026-11-10T01:00:00Z', [127.0, 37.5]),
    ]),
    'WATCH',
    0,
  );
  const shown = live.show(
    { measuredAt: '2026-11-10T01:00:04Z', heartRate: 150, cadence: 170, distanceM: 1012, paceSecPerKm: 330 },
    1_000,
  );
  expect(shown).toMatchObject({ heartRate: 150, cadence: 170, distanceM: 1012, paceSecPerKm: 330, newSample: false });
  expect(shown?.route).toHaveLength(1);
  // An older display value than the shown one changes nothing.
  expect(
    live.show({ measuredAt: '2026-11-10T01:00:03Z', heartRate: 1, cadence: 1, distanceM: 1, paceSecPerKm: 1 }, 1_500),
  ).toBeNull();
  // A batch older than the display value keeps the display numbers.
  expect(
    live.ingest(body([metric('2026-11-10T01:00:02Z', { heartRateBpm: 141 })]), 'WATCH', 2_000),
  ).toMatchObject({ heartRate: 150, paceSecPerKm: 330 });
  // Over 5 s since the last display value: the batch values again.
  expect(
    live.ingest(body([metric('2026-11-10T01:00:03Z', { heartRateBpm: 142 })]), 'WATCH', 6_001),
  ).toMatchObject({ heartRate: 142 });
  // A newer batch measurement wins over the display value.
  live.show({ measuredAt: '2026-11-10T01:00:05Z', heartRate: 155, cadence: 170, distanceM: 1020, paceSecPerKm: 320 }, 7_000);
  expect(
    live.ingest(body([metric('2026-11-10T01:00:06Z', { heartRateBpm: 160 })]), 'WATCH', 7_500),
  ).toMatchObject({ heartRate: 160 });
});

test('display values do not apply after a takeover or without a measurement time', () => {
  const live = createLiveMetrics();
  expect(
    live.show({ measuredAt: null, heartRate: 150, cadence: null, distanceM: null, paceSecPerKm: null }, 0),
  ).toBeNull();
  live.ingest(body([gps('2026-11-10T01:00:00Z', [127.0, 37.5])]), 'PHONE', 0, 'PHONE');
  expect(
    live.show({ measuredAt: '2026-11-10T01:00:04Z', heartRate: 150, cadence: null, distanceM: 10, paceSecPerKm: 300 }, 1_000),
  ).toBeNull();
});

test('fresh watch display values (step estimate while the screen is off) win over the phone GPS bridge', () => {
  // S15P31E105-549, synthetic values.
  const base = Date.parse('2026-11-07T01:00:00Z');
  const live = createLiveMetrics();
  live.ingest(
    body([gps('2026-11-07T01:00:00Z', [129.13, 35.15]), gps('2026-11-07T01:00:20Z', [129.13, 35.1509])]),
    'PHONE',
    base + 21_000,
    'WATCH',
  );
  const shown = live.show(
    { measuredAt: '2026-11-07T01:00:21Z', heartRate: 120, cadence: 150, distanceM: 80, paceSecPerKm: 400 },
    base + 22_000,
  );
  // Pace and cadence from the watch; the distance does not go back below the 100 m the phone GPS already showed.
  expect(shown).toMatchObject({ paceSecPerKm: 400, cadence: 150 });
  expect(shown?.distanceM).toBeCloseTo(100, 0);
  // Without the watch for over 5 s the phone GPS carries on.
  const later = live.ingest(
    body([gps('2026-11-07T01:00:30Z', [129.13, 35.15135])]),
    'PHONE',
    base + 31_000,
    'WATCH',
  );
  expect(later?.distanceM).toBeGreaterThan(145);
  expect(later?.paceSecPerKm).not.toBe(400);
});

test('the screen distance does not drop when the phone takes over after bridging (review)', () => {
  const base = Date.parse('2026-11-07T01:00:00Z');
  const live = createLiveMetrics();
  live.ingest(body([metric('2026-11-07T01:00:00Z', { heartRateBpm: 120, totalDistanceM: 500 })]), 'WATCH', base + 1_000);
  // Watch quiet: the phone GPS bridges about 100 m.
  const bridged = live.ingest(
    body([gps('2026-11-07T01:00:20Z', [129.13, 35.15]), gps('2026-11-07T01:00:50Z', [129.13, 35.1509])]),
    'PHONE',
    base + 51_000,
    'WATCH',
  );
  expect(bridged?.distanceM).toBeGreaterThan(590);
  // Takeover: phone records from now; the first phone fix after it must not pull the distance back to 500 m.
  live.setPhoneSince(Date.parse('2026-11-07T01:01:00Z'));
  const after = live.ingest(body([gps('2026-11-07T01:01:05Z', [129.13, 35.1510])]), 'PHONE', base + 66_000, 'PHONE');
  expect(after?.source).toBe('PHONE');
  expect(after?.distanceM).toBeGreaterThanOrEqual(bridged!.distanceM!);
});

test('the bridge does not draw a straight line across a pause or a gap over 60 s (review)', () => {
  const base = Date.parse('2026-11-07T01:00:00Z');
  const live = createLiveMetrics();
  live.ingest(body([metric('2026-11-07T01:00:00Z', { heartRateBpm: 120, totalDistanceM: 0 })]), 'WATCH', base + 1_000);
  const bridged = live.ingest(
    body([
      gps('2026-11-07T01:00:20Z', [129.13, 35.15]),
      gps('2026-11-07T01:00:30Z', [129.13, 35.15009]),
      // 2 min later, about 1 km away (a pause): not added.
      gps('2026-11-07T01:02:30Z', [129.13, 35.159]),
      gps('2026-11-07T01:02:40Z', [129.13, 35.15909]),
    ]),
    'PHONE',
    base + 161_000,
    'WATCH',
  );
  // Two parts of about 10 m each, not the 1 km between them.
  expect(bridged?.distanceM).toBeLessThan(30);
});

test('the same display values twice do not redraw the screen (review)', () => {
  const live = createLiveMetrics();
  const values = { measuredAt: '2026-11-07T01:00:05Z', heartRate: 150, cadence: 170, distanceM: 100, paceSecPerKm: 330 };
  expect(live.show(values, 1_000)).not.toBeNull();
  expect(live.show({ ...values, measuredAt: '2026-11-07T01:00:06Z' }, 1_300)).toBeNull();
  expect(live.show({ ...values, measuredAt: '2026-11-07T01:00:07Z', paceSecPerKm: 320 }, 1_600)?.paceSecPerKm).toBe(320);
});

// S15P31E105-783: a phone GPS jump (speed over MAX_BRIDGE_SPEED_MPS) is not added to the bridged distance. Synthetic values.
describe('phone GPS bridge ignores jumps', () => {
  const base = Date.parse('2026-11-07T01:00:00Z');
  const bridgeOf = (points: Array<[string, number]>) => {
    const live = createLiveMetrics();
    live.ingest(
      body([
        metric('2026-11-07T01:00:00Z', {
          heartRateBpm: 120,
          totalDistanceM: 0,
        }),
      ]),
      'WATCH',
      base + 1_000,
    );
    return live.ingest(
      body(points.map(([at, lat]) => gps(at, [129.13, lat]))),
      'PHONE',
      base + 61_000,
      'WATCH',
    )?.distanceM;
  };

  test('one jump in the middle adds nothing and the reference moves to the new place', () => {
    const metres = bridgeOf([
      ['2026-11-07T01:00:20Z', 35.15],
      ['2026-11-07T01:00:30Z', 35.15009], // ~10 m
      ['2026-11-07T01:00:40Z', 35.25], // ~11 km in 10 s: ignored
      ['2026-11-07T01:00:50Z', 35.25009], // ~10 m from the new place
    ]);
    expect(metres).toBeGreaterThan(18);
    expect(metres).toBeLessThan(22);
  });

  test('normal consecutive segments all add up', () => {
    const metres = bridgeOf([
      ['2026-11-07T01:00:20Z', 35.15],
      ['2026-11-07T01:00:30Z', 35.15027], // ~30 m, 3 m/s
      ['2026-11-07T01:00:40Z', 35.15054],
      ['2026-11-07T01:00:50Z', 35.15081],
    ]);
    expect(metres).toBeGreaterThan(88);
    expect(metres).toBeLessThan(92);
  });

  test('a jump at the very first point does not count and later points do', () => {
    const metres = bridgeOf([
      ['2026-11-07T01:00:20Z', 35.5], // wrong first fix, ~39 km away
      ['2026-11-07T01:00:30Z', 35.15],
      ['2026-11-07T01:00:40Z', 35.15027], // ~30 m
    ]);
    expect(metres).toBeGreaterThan(28);
    expect(metres).toBeLessThan(32);
  });

  test('the limit itself counts: 11.7 m in 1 s is added, 12.6 m in 1 s is not', () => {
    const under = bridgeOf([
      ['2026-11-07T01:00:20Z', 35.15],
      ['2026-11-07T01:00:21Z', 35.150105],
    ]);
    expect(under).toBeGreaterThan(11);
    const over = bridgeOf([
      ['2026-11-07T01:00:20Z', 35.15],
      ['2026-11-07T01:00:21Z', 35.150113],
    ]);
    expect(over).toBe(0);
  });

  test('a jump does not make the bridged pace absurd', () => {
    const live = createLiveMetrics();
    live.ingest(
      body([
        metric('2026-11-07T01:00:00Z', {
          heartRateBpm: 120,
          totalDistanceM: 0,
        }),
      ]),
      'WATCH',
      base + 1_000,
    );
    const out = live.ingest(
      body(
        (
          [
            ['2026-11-07T01:00:20Z', 35.15],
            ['2026-11-07T01:00:30Z', 35.25],
            ['2026-11-07T01:00:40Z', 35.25027],
            ['2026-11-07T01:00:50Z', 35.25054],
          ] as Array<[string, number]>
        ).map(([at, lat]) => gps(at, [129.13, lat])),
      ),
      'PHONE',
      base + 61_000,
      'WATCH',
    );
    // 30 m per 10 s is about 5'33"/km, not the 0'01"/km a 11 km step would give.
    expect(out?.paceSecPerKm).toBeGreaterThan(300);
    expect(out?.paceSecPerKm).toBeLessThan(380);
  });
});
