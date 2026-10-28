import { emptyResult, METRICS } from './catalog';
import type {
  Availability,
  DeviceInfo,
  HealthMetric,
  HealthProvider,
  HealthRecord,
  MetricResult,
  ReadWindow,
  SleepStage,
} from './types';
import { readAllPages } from './pagination';
import { overlaps } from './time';
import { chooseRestingRecord } from './selection';
import { summaryFor } from './summary';

export type AndroidRecord = {
  metadata?: { id?: string; dataOrigin?: string; recordingMethod?: number };
  time?: string;
  startTime?: string;
  endTime?: string;
  beatsPerMinute?: number;
  heartRateVariabilityMillis?: number;
  count?: number;
  distance?: { inMeters: number };
  exerciseType?: number;
  title?: string;
  samples?: { time: string; beatsPerMinute: number }[];
  stages?: { startTime: string; endTime: string; stage: number }[];
};
export type AndroidSdk = {
  availability(): Promise<Availability>;
  request(types: string[]): Promise<void>;
  grantedTypes(): Promise<string[]>;
  readPage(
    type: string,
    window: { start: string; end: string },
    origin?: string,
    token?: string,
  ): Promise<{ records: AndroidRecord[]; pageToken?: string | null }>;
  aggregateSteps(
    window: { start: string; end: string },
    origin: string,
  ): Promise<number | null>;
  openSettings(): Promise<void>;
  device(): Promise<DeviceInfo>;
};
export const SAMSUNG = 'com.sec.android.app.shealth';
export const ANDROID_TYPES: Record<HealthMetric, string> = {
  sleep: 'SleepSession',
  heartRate: 'HeartRate',
  restingHeartRate: 'RestingHeartRate',
  hrv: 'HeartRateVariabilityRmssd',
  steps: 'Steps',
  exercise: 'ExerciseSession',
  distance: 'Distance',
};
const stageTypes: Record<number, SleepStage['stage']> = {
  0: 'unknown',
  1: 'awake',
  2: 'asleep',
  3: 'awake',
  4: 'light',
  5: 'deep',
  6: 'rem',
};
function normalize(
  metric: HealthMetric,
  raw: AndroidRecord,
  index: number,
): HealthRecord[] {
  const startTime = raw.time ?? raw.startTime ?? '';
  const endTime = raw.time ?? raw.endTime ?? startTime;
  const origin = raw.metadata?.dataOrigin ?? 'unknown';
  const source = {
    id: origin,
    name: origin === SAMSUNG ? '삼성 헬스' : origin,
  };
  const base: HealthRecord = {
    id: raw.metadata?.id ?? `${metric}-${startTime}-${index}`,
    metric,
    startTime,
    endTime,
    source,
    manuallyEntered: raw.metadata?.recordingMethod === 3,
  };
  if (metric === 'heartRate') {
    return (raw.samples ?? []).map((s, i) => ({
      ...base,
      id: `${base.id}-${i}`,
      startTime: s.time,
      endTime: s.time,
      value: s.beatsPerMinute,
      unit: 'bpm',
    }));
  }
  if (metric === 'restingHeartRate') {
    return [{ ...base, value: raw.beatsPerMinute, unit: 'bpm' }];
  }
  if (metric === 'hrv') {
    return [
      {
        ...base,
        value: raw.heartRateVariabilityMillis,
        unit: 'ms',
        method: 'rmssd',
      },
    ];
  }
  if (metric === 'steps') {
    return [{ ...base, value: raw.count, unit: '걸음' }];
  }
  if (metric === 'distance') {
    return [
      {
        ...base,
        value: raw.distance?.inMeters,
        unit: 'm',
        distanceKind: 'interval',
      },
    ];
  }
  if (metric === 'exercise') {
    return [
      {
        ...base,
        details:
          raw.title ||
          (raw.exerciseType === 56
            ? '러닝'
            : `운동 유형 ${raw.exerciseType ?? '미확인'}`),
      },
    ];
  }
  return [
    {
      ...base,
      stages: (raw.stages ?? []).map(s => ({
        ...s,
        stage: stageTypes[s.stage] ?? 'unknown',
      })),
    },
  ];
}

export function createAndroidReader(sdk: AndroidSdk): HealthProvider {
  async function read(
    metric: HealthMetric,
    window: ReadWindow,
    origin?: string,
  ) {
    const queryWindow =
      metric === 'sleep'
        ? {
            ...window,
            start: new Date(
              Date.parse(window.start) - 36 * 60 * 60 * 1000,
            ).toISOString(),
          }
        : window;
    const rows = await readAllPages(token =>
      sdk.readPage(ANDROID_TYPES[metric], queryWindow, origin, token),
    );
    const normalized = rows
      .flatMap((r, i) => normalize(metric, r, i))
      .filter(
        r =>
          overlaps(r.startTime, r.endTime, window) &&
          (!origin || r.source.id === origin) &&
          (['sleep', 'exercise'].includes(metric) ||
            (Number.isFinite(r.value) && r.value! >= 0)),
      );
    return [...new Map(normalized.map(r => [r.id, r])).values()];
  }
  return {
    platform: 'android',
    checkAvailability: sdk.availability,
    requestReadAccess: () =>
      sdk.request(METRICS.map(metric => ANDROID_TYPES[metric])),
    readMetric: async (metric, window) => {
      const result = emptyResult(metric, window);
      try {
        const permissions = await sdk.grantedTypes();
        if (!permissions.includes(ANDROID_TYPES[metric])) {
          return { ...result, status: 'accessRequired', access: 'required' };
        }
        result.access = 'granted';
        let records = await read(metric, window, SAMSUNG);
        let sourceMode: MetricResult['sourceMode'] = 'samsung';
        if (metric === 'restingHeartRate' && !chooseRestingRecord(records)) {
          records = (await read(metric, window)).filter(
            r => r.source.id !== SAMSUNG,
          );
          sourceMode = 'healthConnectOther';
        }
        if (metric === 'restingHeartRate') {
          const selected = chooseRestingRecord(records);
          records = selected ? [selected] : [];
        }
        const summary = summaryFor(metric, records, window);
        if (metric === 'steps' && records.length) {
          const count = await sdk.aggregateSteps(window, SAMSUNG);
          if (count === null || !Number.isFinite(count) || count < 0) {
            throw new Error('Missing step aggregate');
          }
          summary.value = count;
          summary.note = '선택 기간 · 삼성 헬스 집계';
        }
        return {
          ...result,
          status: records.length ? 'ready' : 'empty',
          records,
          summary,
          readAt: new Date().toISOString(),
          sourceMode: records.length ? sourceMode : 'none',
        };
      } catch {
        return { ...result, status: 'error' };
      }
    },
    openAccessSettings: sdk.openSettings,
    getDeviceInfo: sdk.device,
  };
}
