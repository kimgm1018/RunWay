import { routeLengthM, type LngLat } from '../geo';

// 러닝 중 화면의 실측값(S15P31E105-517). 폰은 워치 batch와 인계 후 폰 batch를 W07에 원문 그대로 올린다. 그 원문을
// 화면용으로 한 번 더 읽어 심박·케이던스·거리·페이스·지나온 길을 만든다. 서버로 가는 본문은 바꾸지 않는다.
// 형식은 devices-health.md W07 items(METRIC_SAMPLE · GPS_POINT)다. 값·좌표는 로그에 남기지 않는다.

export type LiveMetrics = {
  // WATCH: 워치 batch. PHONE: 폰 기록(인계 후) batch, GPS만 있다.
  source: 'WATCH' | 'PHONE';
  heartRate: number | null;
  cadence: number | null;
  distanceM: number | null;
  paceSecPerKm: number | null;
  route: LngLat[];
  // 받은 측정 중 가장 늦은 측정 시각(기기 기준)과, 이 폰이 새 값을 받은 시각(폰 시계, ms).
  measuredAt: string | null;
  receivedAt: number;
};

type Reading = { at: number; value: number };
type Point = { at: number; position: LngLat };
type Located = Point & { from: LiveMetrics['source'] };

export type BatchItems = {
  metrics: {
    at: number;
    heartRate: number | null;
    cadence: number | null;
    speedMps: number | null;
    totalDistanceM: number | null;
  }[];
  points: Point[];
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// W07 본문에서 화면에 쓸 항목만 읽는다. 형식이 맞지 않는 항목은 건너뛰고, 본문이 JSON이 아니면 빈 결과다.
export function readBatchItems(body: string): BatchItems {
  const result: BatchItems = { metrics: [], points: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return result;
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return result;
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const at =
      typeof entry.measuredAt === 'string' ? Date.parse(entry.measuredAt) : NaN;
    if (!Number.isFinite(at)) {
      continue;
    }
    if (entry.type === 'METRIC_SAMPLE') {
      result.metrics.push({
        at,
        heartRate:
          finite(entry.heartRateBpm) && entry.heartRateBpm > 0
            ? entry.heartRateBpm
            : null,
        cadence:
          finite(entry.cadenceSpm) && entry.cadenceSpm >= 0
            ? entry.cadenceSpm
            : null,
        speedMps:
          finite(entry.speedMps) && entry.speedMps >= 0 ? entry.speedMps : null,
        totalDistanceM:
          finite(entry.totalDistanceM) && entry.totalDistanceM >= 0
            ? entry.totalDistanceM
            : null,
      });
    } else if (entry.type === 'GPS_POINT') {
      const coordinates = entry.coordinates;
      if (
        Array.isArray(coordinates) &&
        finite(coordinates[0]) &&
        finite(coordinates[1]) &&
        Math.abs(coordinates[0]) <= 180 &&
        Math.abs(coordinates[1]) <= 90
      ) {
        result.points.push({ at, position: [coordinates[0], coordinates[1]] });
      }
    }
  }
  return result;
}

// Below this speed the runner is standing; a pace from it would be minutes per km, so it shows as none.
const movingMps = 0.5;
// The pace from GPS alone looks back this far, and needs at least this much time between points.
const paceWindowMs = 30_000;
const paceMinSpanMs = 10_000;

// 한 세션의 실측값을 모은다. 같은 batch를 다시 받아도(재전송·재실행 복원) 값이 겹치지 않는다: 지표는 측정 시각이
// 가장 늦은 값이 이기고, 위치는 측정 시각·좌표로 한 번만 넣는다. 늦게 도착한 옛 값은 최신 값을 덮지 않는다.
export function createLiveMetrics() {
  let source: LiveMetrics['source'] = 'WATCH';
  let heartRate: Reading | null = null;
  let cadence: Reading | null = null;
  let speed: Reading | null = null;
  let distance: Reading | null = null;
  let points: Located[] = [];
  const seen = new Set<string>();
  let latestAt: number | null = null;
  let current: LiveMetrics | null = null;

  const newer = (reading: Reading | null, at: number, value: number | null) =>
    value !== null && (reading === null || at >= reading.at)
      ? { at, value }
      : reading;

  const lengthOf = (list: Point[]) =>
    list.length >= 2 ? routeLengthM(list.map(point => point.position)) : null;

  function gpsPace(list: Point[]): number | null {
    if (list.length < 2) {
      return null;
    }
    const end = list[list.length - 1];
    const window = list.filter(point => point.at >= end.at - paceWindowMs);
    const span = end.at - window[0].at;
    if (window.length < 2 || span < paceMinSpanMs) {
      return null;
    }
    const metres = routeLengthM(window.map(point => point.position));
    const mps = metres / (span / 1000);
    return mps >= movingMps ? 1000 / mps : null;
  }

  return {
    // Reads one W07 body. Returns the new values when it brought anything new, otherwise null.
    ingest(
      body: string,
      from: LiveMetrics['source'],
      receivedAt: number,
    ): LiveMetrics | null {
      const { metrics, points: incoming } = readBatchItems(body);
      let changed = false;
      for (const metric of metrics) {
        const key = `m|${metric.at}|${metric.heartRate}|${metric.cadence}|${metric.speedMps}|${metric.totalDistanceM}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        changed = true;
        heartRate = newer(heartRate, metric.at, metric.heartRate);
        cadence = newer(cadence, metric.at, metric.cadence);
        speed = newer(speed, metric.at, metric.speedMps);
        distance = newer(distance, metric.at, metric.totalDistanceM);
        latestAt = Math.max(latestAt ?? metric.at, metric.at);
      }
      const added: Located[] = [];
      for (const point of incoming) {
        const key = `p|${point.at}|${point.position[0]}|${point.position[1]}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        added.push({ ...point, from });
        latestAt = Math.max(latestAt ?? point.at, point.at);
      }
      if (added.length > 0) {
        changed = true;
        points = [...points, ...added].sort((a, b) => a.at - b.at);
      }
      if (!changed) {
        return null;
      }
      source = from;
      const route = points.map(point => point.position);
      const phonePoints = points.filter(point => point.from === 'PHONE');
      const watchPoints = points.filter(point => point.from === 'WATCH');
      const phoneLength = lengthOf(phonePoints);
      // The watch's own total, else the length of its GPS; after a takeover the phone's GPS adds on.
      const watchLength = distance?.value ?? lengthOf(watchPoints);
      const total =
        watchLength === null && phoneLength === null
          ? null
          : (watchLength ?? 0) + (phoneLength ?? 0);
      const phone = source === 'PHONE';
      current = {
        source,
        // The phone measures no heart rate or cadence, so after a takeover the watch's last ones do not stay up.
        heartRate: phone ? null : heartRate?.value ?? null,
        cadence: phone ? null : cadence?.value ?? null,
        distanceM: total,
        paceSecPerKm: phone
          ? gpsPace(phonePoints)
          : speed !== null
          ? speed.value >= movingMps
            ? 1000 / speed.value
            : null
          : gpsPace(watchPoints),
        route,
        measuredAt: latestAt === null ? null : new Date(latestAt).toISOString(),
        receivedAt,
      };
      return current;
    },
    current: () => current,
  };
}
