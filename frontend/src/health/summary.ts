import type { HealthMetric, HealthRecord, MetricResult, ReadWindow } from './types';
import { sleepSummaryByDay } from './sleep';

export function summaryFor(
  metric: HealthMetric,
  records: HealthRecord[],
  window: ReadWindow,
): MetricResult['summary'] {
  if (metric === 'sleep') {
    return sleepSummaryByDay(records, window);
  }
  if (metric === 'exercise') {
    return { value: records.length, unit: '건' };
  }
  const latest = [...records].sort(
    (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
  )[0];
  return {
    value: latest?.value ?? null,
    unit: latest?.unit ?? '',
    note:
      metric === 'distance'
        ? '최근 거리 구간 · 기간 전체 이동거리 아님'
        : metric === 'hrv'
        ? latest?.method?.toUpperCase()
        : undefined,
  };
}
