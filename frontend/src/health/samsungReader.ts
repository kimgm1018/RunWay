import type {
  Availability,
  DeviceInfo,
  HealthMetric,
  HealthProvider,
  HealthRecord,
  ReadWindow,
} from './types';
import { emptyResult } from './catalog';
import { summaryFor } from './summary';
import { overlaps } from './time';
export type SamsungSdk = {
  availability(): Promise<Availability>;
  request(): Promise<void>;
  read(metric: HealthMetric, window: ReadWindow): Promise<HealthRecord[]>;
  openSettings(): Promise<void>;
  device(): Promise<DeviceInfo>;
};
export function createSamsungReader(sdk: SamsungSdk): HealthProvider {
  return {
    platform: 'android',
    checkAvailability: sdk.availability,
    requestReadAccess: sdk.request,
    openAccessSettings: sdk.openSettings,
    getDeviceInfo: sdk.device,
    readMetric: async (metric, window) => {
      const result = emptyResult(metric, window);
      if (metric === 'restingHeartRate' || metric === 'hrv') {
        return { ...result, status: 'unavailable' };
      }
      try {
        if ((await sdk.availability()) !== 'available') {
          return { ...result, status: 'unavailable' };
        }
        const rows = await sdk.read(metric, window);
        const records = [
          ...new Map(
            rows
              .filter(
                r =>
                  r.metric === metric &&
                  overlaps(r.startTime, r.endTime, window) &&
                  (['sleep', 'exercise'].includes(metric) ||
                    (Number.isFinite(r.value) &&
                      r.value! >= 0 &&
                      (metric !== 'heartRate' || r.value! > 0))),
              )
              .map(r => [r.id, r]),
          ).values(),
        ];
        const summary = summaryFor(metric, records, window);
        if (metric === 'steps' && records.length) {
          summary.value = records.reduce((sum, r) => sum + r.value!, 0);
          summary.unit = '걸음';
          summary.note = '선택 기간 · 삼성 헬스 집계 (실측 시각 아님)';
        }
        if (metric === 'distance') {
          summary.note = '최근 운동 거리 · 기간 전체 이동거리 아님';
        }
        return {
          ...result,
          status: records.length ? 'ready' : 'empty',
          access: 'granted',
          records,
          summary,
          sourceMode: records.length ? 'samsungDirect' : 'none',
          readAt: new Date().toISOString(),
        };
      } catch (error) {
        const code = (error as { code?: string })?.code;
        return {
          ...result,
          status:
            code === 'SAMSUNG_PERMISSION' || code === 'SAMSUNG_POLICY'
              ? 'accessRequired'
              : code === 'SAMSUNG_UNAVAILABLE'
              ? 'unavailable'
              : 'error',
          access:
            code === 'SAMSUNG_PERMISSION' || code === 'SAMSUNG_POLICY'
              ? 'required'
              : 'unknown',
          summary: {
            ...result.summary,
            note:
              code === 'SAMSUNG_POLICY'
                ? '삼성 헬스 개발 모드와 앱 접근 설정을 확인해 주세요.'
                : code === 'SAMSUNG_PERMISSION'
                ? '삼성 헬스 읽기 권한을 허용해 주세요.'
                : undefined,
          },
        };
      }
    },
  };
}
