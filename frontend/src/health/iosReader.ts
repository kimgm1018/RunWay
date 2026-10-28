import type {
  DeviceInfo,
  HealthMetric,
  HealthProvider,
  HealthRecord,
  ReadWindow,
} from './types';
import { emptyResult, UNITS } from './catalog';
import { summaryFor } from './summary';
import { overlaps } from './time';
import { chooseRestingRecord } from './selection';
import { groupSleepStages } from './sleep';
export type IosSample = Omit<HealthRecord, 'metric'>;
export type IosSdk = {
  available(): Promise<boolean>;
  typeAvailable(metric: HealthMetric): boolean;
  request(): Promise<void>;
  read(metric: HealthMetric, window: ReadWindow): Promise<IosSample[]>;
  aggregate(
    metric: 'steps' | 'distance',
    window: ReadWindow,
  ): Promise<number | null>;
  openSettings(): Promise<void>;
  device(): Promise<DeviceInfo>;
};
export function createIosReader(sdk: IosSdk): HealthProvider {
  let requested = false;
  return {
    platform: 'ios',
    checkAvailability: async () =>
      (await sdk.available()) ? 'available' : 'unavailable',
    requestReadAccess: async () => {
      await sdk.request();
      requested = true;
    },
    openAccessSettings: sdk.openSettings,
    getDeviceInfo: sdk.device,
    readMetric: async (metric, window) => {
      const result = emptyResult(metric, window);
      if (!sdk.typeAvailable(metric)) {
        return { ...result, status: 'unavailable' };
      }
      if (!requested) {
        return { ...result, status: 'accessRequired', access: 'unknown' };
      }
      result.access = 'unobservable';
      try {
        let records: HealthRecord[] = (await sdk.read(metric, window)).map(
          row => ({
            ...row,
            metric,
            unit: UNITS[metric],
            ...(metric === 'hrv' ? { method: 'sdnn' as const } : {}),
            ...(metric === 'distance'
              ? { distanceKind: 'walkingRunning' as const }
              : {}),
          }),
        );
        if (metric === 'sleep') {
          records = groupSleepStages(records);
        }
        records = records.filter(
          row =>
            overlaps(row.startTime, row.endTime, window) &&
            (['sleep', 'exercise'].includes(metric) ||
              (Number.isFinite(row.value) && row.value! >= 0)),
        );
        records = [...new Map(records.map(row => [row.id, row])).values()];
        if (metric === 'restingHeartRate') {
          const latest = chooseRestingRecord(records);
          records = latest ? [latest] : [];
        }
        const summary = summaryFor(metric, records, window);
        if ((metric === 'steps' || metric === 'distance') && records.length) {
          const value = await sdk.aggregate(metric, window);
          if (value === null || !Number.isFinite(value) || value < 0) {
            throw new Error('Missing aggregate');
          }
          summary.value = value;
          summary.note =
            metric === 'steps'
              ? '선택 기간 · Apple 건강 집계'
              : '선택 기간 · 걷기/달리기 거리 집계';
        }
        return {
          ...result,
          status: records.length ? 'ready' : 'empty',
          records,
          summary,
          sourceMode: records.length ? 'healthKit' : 'none',
          readAt: new Date().toISOString(),
        };
      } catch {
        return { ...result, status: 'error' };
      }
    },
  };
}
