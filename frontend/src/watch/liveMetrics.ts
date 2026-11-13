import { distanceM as pointDistanceM, type LngLat } from '../geo';
import { currentPace, type DistanceSample } from './paceRule';

// 러닝 중 화면의 실측값(S15P31E105-517). 폰은 워치 batch와 인계 후 폰 batch를 W07에 원문 그대로 올린다. 그 원문을
// 화면용으로 한 번 더 읽어 심박·케이던스·거리·페이스·지나온 길을 만든다. 서버로 가는 본문은 바꾸지 않는다.
// 형식은 devices-health.md W07 items(METRIC_SAMPLE · GPS_POINT)다. 값·좌표는 로그에 남기지 않는다.

export type LiveMetrics = {
  // 기록 출처. WATCH: 워치 기록. PHONE: 폰 기록(인계 후), GPS만 있다. WATCH 기록 중 폰 GPS 보완 batch는 출처를 바꾸지 않는다.
  source: 'WATCH' | 'PHONE';
  heartRate: number | null;
  cadence: number | null;
  distanceM: number | null;
  paceSecPerKm: number | null;
  // 지나온 길(S15P31E105-549). 측정 시각 구간마다 워치 위치를 우선하고 워치 위치가 없는 구간만 폰 위치로 채운다.
  // route는 고른 위치 전체, routeParts는 출처 전환·60초 넘는 공백에서 끊은 조각이다. 조각 사이는 선으로 잇지 않는다.
  route: LngLat[];
  routeParts: LngLat[][];
  // 지금 위치(S15P31E105-549). 경로에 쓸 수 있는 가장 최근 위치, 없으면 정확도와 상관없이 가장 최근 위치다.
  // 실내·정지처럼 경로가 비어도 지도에 점 하나는 보이게 한다. 경로(route)와 거리 계산에는 쓰지 않는다.
  here: LngLat | null;
  // 쓸 수 있는 위치(정확도 30m 이내 또는 모름)를 이 폰이 마지막으로 받은 시각(폰 시계 ms). 아직 없으면 null.
  // 워치·폰 어느 쪽 위치든 된다. 화면이 "위치 확인 중"을 판단할 때 쓴다(S15P31E105-549).
  positionReceivedAt: number | null;
  // 이번에 새 측정값(METRIC_SAMPLE)이 들어왔는지. 위치만 새로 온 갱신은 심박·케이던스 평균에 다시 넣지 않는다.
  newSample: boolean;
  // 받은 측정 중 가장 늦은 측정 시각(기기 기준)과, 이 폰이 새 값을 받은 시각(폰 시계, ms).
  measuredAt: string | null;
  receivedAt: number;
};

// 워치가 화면에 보인 값(S15P31E105-549 LIVE_METRICS). measuredAt은 워치 측정 시각(ISO)이다.
export type WatchShown = {
  measuredAt: string | null;
  heartRate: number | null;
  cadence: number | null;
  distanceM: number | null;
  paceSecPerKm: number | null;
};

// 표시값은 받은 뒤 이 시간 동안만 batch 값 대신 쓴다. 그 뒤로는 batch 값으로 돌아간다(메시지가 끊긴 경우).
export const LIVE_FRESH_MS = 5_000;

// 워치 화면이 꺼지면 Health Services가 거리·속도를 1분쯤 모아서 준다(S15P31E105-549). 워치 거리가 이 시간 넘게 새로 오지
// 않으면 그동안 화면의 페이스·거리를 폰 GPS로 잇는다. 표시 전용이며 기록·서버 값은 바꾸지 않는다.
export const WATCH_DISTANCE_QUIET_MS = 15_000;
const PHONE_PACE_SPAN_MS = 60_000;

type Reading = { at: number; value: number };
type Point = { at: number; position: LngLat; accuracyM?: number | null };
type Located = Point & { from: LiveMetrics['source'] };

// 통합 설계 9.7 GPS 출처 선택. 서버 S11 경로 조회와 같은 기준이다.
// 정확도 30m 넘는 위치는 쓰지 않는다(정확도를 모르면 쓴다). 폰 위치는 ±15초 안에 쓸 수 있는 워치 위치가 없을 때만 쓴다.
// 출처가 바뀌거나 이웃 위치 사이가 60초를 넘으면 조각을 나눈다.
const MAX_ACCURACY_M = 30;
const WATCH_HOLD_MS = 15_000;
const PART_GAP_MS = 60_000;
// 폰 GPS 보완 거리·페이스에서 두 위치 사이 속도가 이 값(m/s, 시속 43 km)을 넘으면 위치가 튄 것으로 보고 그 구간 거리는
// 더하지 않는다(S15P31E105-783). 기준점은 새 위치로 옮겨 이후 구간은 정상으로 더한다. 정상 러닝은 2~6 m/s, 전력 질주도
// 10 m/s 안팎이라 12 m/s 위는 사람이 달린 속도가 아니다. 정확도 30 m 필터가 못 거르는 시작 직후·실내외 전환 튐을 막는다.
export const MAX_BRIDGE_SPEED_MPS = 12;

const usable = (point: Point) =>
  point.accuracyM === null || point.accuracyM === undefined || point.accuracyM <= MAX_ACCURACY_M;

// points는 측정 시각 순이어야 한다(ingest가 정렬해 둔다). 러닝 내내 화면 갱신마다 부르므로 선형 시간으로 고른다.
export function selectRoute(points: Located[]): Located[][] {
  const watchTimes = points
    .filter(point => point.from === 'WATCH' && usable(point))
    .map(point => point.at);
  // 정렬된 워치 시각을 앞에서부터 따라가며 각 폰 위치의 가장 가까운 워치 시각만 본다.
  let cursor = 0;
  const near = (at: number) => {
    while (cursor < watchTimes.length && watchTimes[cursor] < at - WATCH_HOLD_MS) {
      cursor += 1;
    }
    return cursor < watchTimes.length && watchTimes[cursor] <= at + WATCH_HOLD_MS;
  };
  const chosen = points.filter(point =>
    !usable(point) ? false : point.from === 'WATCH' ? true : !near(point.at),
  );
  const parts: Located[][] = [];
  for (const point of chosen) {
    const part = parts[parts.length - 1];
    const last = part?.[part.length - 1];
    if (last && last.from === point.from && point.at - last.at <= PART_GAP_MS) {
      if (point.at !== last.at) {
        part.push(point);
      }
    } else {
      parts.push([point]);
    }
  }
  return parts;
}

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
        result.points.push({
          at,
          position: [coordinates[0], coordinates[1]],
          accuracyM: finite(entry.accuracyM) ? entry.accuracyM : null,
        });
      }
    }
  }
  return result;
}

// 한 세션의 실측값을 모은다. 같은 batch를 다시 받아도(재전송·재실행 복원) 값이 겹치지 않는다: 지표는 측정 시각이
// 가장 늦은 값이 이기고, 위치는 측정 시각·좌표로 한 번만 넣는다. 늦게 도착한 옛 값은 최신 값을 덮지 않는다.
export function createLiveMetrics() {
  let source: LiveMetrics['source'] = 'WATCH';
  let heartRate: Reading | null = null;
  let cadence: Reading | null = null;
  let speed: Reading | null = null;
  let distance: Reading | null = null;
  // 워치 누적 거리 표본(측정 시각 순). 현재 페이스 공통 규칙(paceRule)에 쓴다.
  let distances: DistanceSample[] = [];
  let points: Located[] = [];
  let positionReceivedAt: number | null = null;
  // 인계 뒤 폰이 기록한 첫 위치의 측정 시각. 없으면 폰 GPS는 거리에 더하지 않는다.
  let phoneSince: number | null = null;
  const seen = new Set<string>();
  let latestAt: number | null = null;
  // 측정값(METRIC_SAMPLE) 중 가장 늦은 측정 시각. 워치 표시값(LIVE_METRICS)과 어느 쪽이 새 값인지 비교한다.
  let latestMetricAt: number | null = null;
  // batch로 만든 값과, 워치가 화면에 보인 값(S15P31E105-549 LIVE_METRICS). 표시값은 batch보다 새롭고 받은 지
  // LIVE_FRESH_MS 이내일 때만 심박·케이던스·거리·페이스를 대신한다. 경로·위치는 batch만 쓴다.
  let fromBatches: LiveMetrics | null = null;
  let shown: (WatchShown & { at: number; receivedAt: number }) | null = null;
  let current: LiveMetrics | null = null;

  // 폰이 방금 측정한 워치 거리를 batch로 마지막에 받은 시각(폰 시계).
  let watchDistanceAt: number | null = null;
  // 폰 GPS로 이은 화면 거리가 워치 값이 늦게 와도 뒤로 가지 않게 한 러닝 동안 보인 가장 큰 거리.
  let shownDistance: number | null = null;

  // 워치 거리가 끊긴 동안의 폰 GPS 보완(S15P31E105-549). 마지막 워치 거리 측정 뒤의 폰 위치 길이를 더하고, 페이스는 최근
  // 60초 폰 위치 조각으로 계산한다. 폰 위치가 없으면 null(보완하지 않음).
  const phoneBridge = (): { distanceM: number | null; paceSecPerKm: number | null } | null => {
    const recent = points.filter(point => point.from === 'PHONE' && usable(point));
    if (recent.length === 0) {
      return null;
    }
    const last = recent[recent.length - 1].at;
    const since = distance?.at ?? null;
    const after = since === null ? recent : recent.filter(point => point.at >= since);
    // 일시정지·위치 끊김으로 60초 넘게 비면 그 사이를 직선으로 잇지 않는다(경로 조각과 같은 기준).
    let added = 0;
    let part: Point[] = [];
    for (const point of after) {
      if (part.length > 0 && point.at - part[part.length - 1].at > PART_GAP_MS) {
        added += lengthOf(part) ?? 0;
        part = [];
      }
      part.push(point);
    }
    added += lengthOf(part) ?? 0;
    return {
      distanceM: (distance?.value ?? 0) + added,
      paceSecPerKm: gpsPace(recent.filter(point => point.at >= last - PHONE_PACE_SPAN_MS)),
    };
  };

  const overlay = (base: LiveMetrics, now: number): LiveMetrics => {
    let next = base;
    const liveShown =
      shown !== null &&
      base.source === 'WATCH' &&
      now - shown.receivedAt <= LIVE_FRESH_MS &&
      (latestMetricAt === null || shown.at >= latestMetricAt);
    if (liveShown && shown) {
      next = {
        ...next,
        heartRate: shown.heartRate ?? next.heartRate,
        cadence: shown.cadence ?? next.cadence,
        distanceM:
          shown.distanceM === null ? next.distanceM : Math.max(shown.distanceM, next.distanceM ?? 0),
        // 워치가 서 있다고 본 null도 그대로 보인다(워치 화면과 같게).
        paceSecPerKm: shown.paceSecPerKm,
      };
    }
    // 워치가 방금 보낸 거리(LIVE_METRICS, 화면이 꺼진 동안에는 걸음 추정)가 있으면 그 값을 보이고, 워치 값이 끊겼을 때만
    // 폰 GPS로 잇는다.
    const watchLive = liveShown && shown?.distanceM !== null;
    if (
      base.source === 'WATCH' &&
      !watchLive &&
      (watchDistanceAt === null || now - watchDistanceAt > WATCH_DISTANCE_QUIET_MS)
    ) {
      const bridge = phoneBridge();
      if (bridge) {
        next = {
          ...next,
          distanceM: Math.max(bridge.distanceM ?? 0, next.distanceM ?? 0),
          paceSecPerKm: bridge.paceSecPerKm,
        };
      }
    }
    // 화면 거리는 러닝 중 줄지 않는다. 폰 인계로 출처가 바뀌어도 그동안 보인 거리 아래로 내려가지 않는다.
    if (next.distanceM !== null) {
      shownDistance = Math.max(shownDistance ?? 0, next.distanceM);
      next = { ...next, distanceM: shownDistance };
    }
    return next;
  };

  const newer = (reading: Reading | null, at: number, value: number | null) =>
    value !== null && (reading === null || at >= reading.at)
      ? { at, value }
      : reading;

  // 구간 속도가 MAX_BRIDGE_SPEED_MPS 이하인 구간만 더한다. 같은 시각 두 위치는 거리가 0일 때만 더한다.
  const stepM = (from: Point, to: Point) => {
    const metres = pointDistanceM(from.position, to.position);
    const seconds = (to.at - from.at) / 1000;
    return metres <= MAX_BRIDGE_SPEED_MPS * Math.max(seconds, 0) ? metres : 0;
  };

  const lengthOf = (list: Point[]) =>
    list.length >= 2
      ? list.slice(1).reduce((sum, point, index) => sum + stepM(list[index], point), 0)
      : null;

  // GPS 위치 조각을 누적 거리 표본으로 바꿔 같은 페이스 규칙에 넣는다(S15P31E105-549 2안).
  function gpsPace(list: Point[]): number | null {
    const samples: DistanceSample[] = [];
    let metres = 0;
    list.forEach((point, index) => {
      if (index > 0) {
        metres += stepM(list[index - 1], point);
      }
      samples.push({ at: point.at, metres });
    });
    return currentPace(samples, null);
  }

  return {
    // Reads one W07 body. from: who made the batch. recording: who records the run now; a phone GPS batch in a
    // WATCH run only fills the route (S15P31E105-549). Returns the new values when it brought anything new, else null.
    ingest(
      body: string,
      from: LiveMetrics['source'],
      receivedAt: number,
      recording: LiveMetrics['source'] = from,
    ): LiveMetrics | null {
      const { metrics, points: incoming } = readBatchItems(body);
      let changed = false;
      let newSample = false;
      for (const metric of metrics) {
        const key = `m|${metric.at}|${metric.heartRate}|${metric.cadence}|${metric.speedMps}|${metric.totalDistanceM}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        changed = true;
        newSample = true;
        heartRate = newer(heartRate, metric.at, metric.heartRate);
        cadence = newer(cadence, metric.at, metric.cadence);
        speed = newer(speed, metric.at, metric.speedMps);
        // 방금 측정한 워치 거리(받은 시각 기준 WATCH_DISTANCE_QUIET_MS 이내)가 왔을 때만 워치 거리가 이어진다고 본다.
        // 화면이 꺼진 동안 모였다가 1분 늦게 온 거리는 폰 GPS 보완을 끝내지 않는다.
        if (
          from === 'WATCH' &&
          metric.totalDistanceM !== null &&
          receivedAt - metric.at <= WATCH_DISTANCE_QUIET_MS
        ) {
          watchDistanceAt = Math.max(watchDistanceAt ?? receivedAt, receivedAt);
        }
        distance = newer(distance, metric.at, metric.totalDistanceM);
        if (metric.totalDistanceM !== null && !distances.some(sample => sample.at === metric.at)) {
          distances = [...distances, { at: metric.at, metres: metric.totalDistanceM }]
            .sort((a, b) => a.at - b.at)
            .slice(-120);
        }
        latestAt = Math.max(latestAt ?? metric.at, metric.at);
        latestMetricAt = Math.max(latestMetricAt ?? metric.at, metric.at);
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
        if (added.some(usable)) {
          positionReceivedAt = receivedAt;
        }
      }
      if (!changed) {
        return null;
      }
      const phoneRecords = from === 'PHONE' && recording === 'PHONE';
      if (phoneRecords && added.length > 0 && phoneSince === null) {
        // 인계 시각을 모르면(앱 재실행 뒤 등) 폰이 기록을 맡은 뒤 처음 받은 위치부터 더한다.
        phoneSince = Math.min(...added.map(point => point.at));
      }
      if (phoneRecords || from === 'WATCH') {
        source = from;
      }
      const parts = selectRoute(points);
      const latestUsable = [...points].reverse().find(usable);
      const latest = points.length > 0 ? points[points.length - 1] : null;
      const here = (latestUsable ?? latest)?.position ?? null;
      const route = parts.flat().map(point => point.position);
      const routeParts = parts.map(part => part.map(point => point.position));
      const since = phoneSince;
      const partsLength = (list: Located[][]) => {
        const lengths = list.map(lengthOf).filter((length): length is number => length !== null);
        return lengths.length > 0 ? lengths.reduce((sum, length) => sum + length, 0) : null;
      };
      const phonePoints = points.filter(
        point => point.from === 'PHONE' && usable(point) && (since === null || point.at >= since),
      );
      const watchParts = parts.filter(part => part[0].from === 'WATCH');
      const phoneLength =
        since === null
          ? null
          : partsLength(
              parts
                .filter(part => part[0].from === 'PHONE')
                .map(part => part.filter(point => point.at >= since)),
            );
      // The watch's own total, else the length of its GPS; after a takeover the phone's GPS adds on.
      const watchLength = distance?.value ?? partsLength(watchParts);
      const total =
        watchLength === null && phoneLength === null
          ? null
          : (watchLength ?? 0) + (phoneLength ?? 0);
      const phone = source === 'PHONE';
      fromBatches = {
        source,
        // The phone measures no heart rate or cadence, so after a takeover the watch's last ones do not stay up.
        heartRate: phone ? null : heartRate?.value ?? null,
        cadence: phone ? null : cadence?.value ?? null,
        distanceM: total,
        // 현재 페이스 공통 규칙(paceRule, 워치와 같은 규칙). 워치 기록 중에는 워치 누적 거리·속도로, 둘 다 없으면 지금
        // 이어지는 경로 조각(워치 GPS, 없으면 폰 GPS)으로 계산한다. 폰 기록 중에는 폰 GPS로 계산한다.
        paceSecPerKm: phone
          ? gpsPace(phonePoints)
          : distances.length > 0 || speed !== null
          ? currentPace(distances, speed ? { at: speed.at, mps: speed.value } : null)
          : gpsPace(parts.length > 0 ? parts[parts.length - 1] : []),
        route,
        routeParts,
        here,
        positionReceivedAt,
        newSample,
        measuredAt: latestAt === null ? null : new Date(latestAt).toISOString(),
        receivedAt,
      };
      current = overlay(fromBatches, receivedAt);
      return current;
    },
    // 워치 화면 표시값(LIVE_METRICS, 약 1초마다). 기록·평균·경로에는 넣지 않고 화면 숫자만 워치와 맞춘다.
    // 폰이 기록 중이거나 측정 시각이 없거나 batch보다 오래된 값이면 null(바뀐 것 없음).
    show(values: WatchShown, receivedAt: number): LiveMetrics | null {
      const at = values.measuredAt === null ? NaN : Date.parse(values.measuredAt);
      if (source !== 'WATCH' || !Number.isFinite(at) || (shown !== null && at < shown.at)) {
        return null;
      }
      if (latestMetricAt !== null && at < latestMetricAt) {
        return null;
      }
      shown = { ...values, at, receivedAt };
      const base: LiveMetrics = fromBatches ?? {
        source,
        heartRate: null,
        cadence: null,
        distanceM: null,
        paceSecPerKm: null,
        route: [],
        routeParts: [],
        here: null,
        positionReceivedAt: null,
        newSample: false,
        measuredAt: null,
        receivedAt,
      };
      const next = { ...overlay(base, receivedAt), newSample: false, receivedAt };
      // 보이는 숫자가 그대로면 화면을 다시 그리지 않는다(표시값은 초당 여러 번 올 수 있다).
      const same =
        current !== null &&
        current.heartRate === next.heartRate &&
        current.cadence === next.cadence &&
        current.distanceM === next.distanceM &&
        current.paceSecPerKm === next.paceSecPerKm;
      current = next;
      return same ? null : current;
    },
    // 폰이 기록을 맡은 시각(폰 시계 ms). 그 전의 폰 위치는 워치 기록 중 보완용이라 거리에 더하지 않는다.
    setPhoneSince(at: number) {
      phoneSince = phoneSince === null ? at : Math.min(phoneSince, at);
    },
    current: () => current,
  };
}
