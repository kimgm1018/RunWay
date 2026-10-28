import type { HealthMetric, MetricResult, ReadWindow } from './types';

export const METRICS: HealthMetric[] = [
  'sleep',
  'heartRate',
  'restingHeartRate',
  'hrv',
  'steps',
  'exercise',
  'distance',
];
export const METRIC_LABELS: Record<HealthMetric, string> = {
  sleep: '수면',
  heartRate: '최근 심박수',
  restingHeartRate: '안정 시 심박',
  hrv: 'HRV',
  steps: '걸음 수',
  exercise: '최근 운동',
  distance: '거리',
};
export const UNITS: Record<HealthMetric, string> = {
  sleep: 'ms',
  heartRate: 'bpm',
  restingHeartRate: 'bpm',
  hrv: 'ms',
  steps: '걸음',
  exercise: '건',
  distance: 'm',
};
export function emptyResult(
  metric: HealthMetric,
  window: ReadWindow,
  status: MetricResult['status'] = 'idle',
): MetricResult {
  return {
    metric,
    window,
    status,
    access: 'unknown',
    records: [],
    summary: { value: null, unit: UNITS[metric] },
    readAt: null,
    sourceMode: 'none',
  };
}
