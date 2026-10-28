import type { HealthProvider, MetricResult, ReadWindow } from './types';
import { emptyResult } from './catalog';
export async function readWeeklySteps(
  provider: HealthProvider,
  now: Date,
): Promise<MetricResult> {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Invalid date');
  }
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const responses: MetricResult[] = await Promise.all(
    Array.from({ length: 7 }, async (_, index) => {
      const offset = 7 - index;
      const from = new Date(midnight);
      from.setDate(from.getDate() - offset);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      const window: ReadWindow = {
        start: from.toISOString(),
        end: to.toISOString(),
      };
      try {
        const result = await provider.readMetric('steps', window);
        return result.status === 'ready' &&
          (!Number.isFinite(result.summary.value) || result.summary.value! < 0)
          ? emptyResult('steps', window, 'error')
          : result;
      } catch {
        return emptyResult('steps', window, 'error');
      }
    }),
  );
  const window = {
    start: responses[0].window.start,
    end: midnight.toISOString(),
  };
  const valid = responses.filter(r => r.status === 'ready');
  const failure = responses.find(r => !['ready', 'empty'].includes(r.status));
  const total = valid.length
    ? valid.reduce((sum, r) => sum + r.summary.value!, 0)
    : null;
  const first = valid[0] ?? responses[0];
  return {
    ...emptyResult('steps', window),
    status: failure?.status ?? (valid.length ? 'ready' : 'empty'),
    access: failure?.access ?? first.access,
    records: [
      ...new Map(
        responses
          .flatMap(r => r.records)
          .map(r => [r.aggregation ? `${r.startTime}:${r.id}` : r.id, r]),
      ).values(),
    ],
    sourceMode: valid.every(r => r.sourceMode === first.sourceMode)
      ? first.sourceMode
      : 'none',
    readRoute: valid.every(r => r.readRoute === first.readRoute)
      ? first.readRoute
      : undefined,
    readAt: new Date().toISOString(),
    summary: {
      value: !failure && total !== null ? total / valid.length : null,
      unit: '걸음/일',
      note: failure
        ? '일부 날짜 조회 실패 · 평균 미계산'
        : `하루 평균 · 오늘 제외 · 기록 ${valid.length}/7일 (누락일 제외)`,
    },
    stepStatistics: {
      total,
      availableDays: valid.length,
      days: responses.map(r => ({
        window: r.window,
        status: r.status,
        value: r.status === 'ready' ? r.summary.value : null,
      })),
    },
  };
}
