import type { HealthRecord, ReadWindow, MetricResult } from './types';
import { overlaps } from './time';

export type SleepSummary = {
  sessionMs: number;
  asleepMs: number | null;
  confirmedAsleepMs: number;
  awakeMs: number;
};

function sleepIdentity(record: HealthRecord): string {
  const stages = [
    ...new Set(
      (record.stages ?? []).map(stage =>
        JSON.stringify([
          Date.parse(stage.startTime),
          Date.parse(stage.endTime),
          stage.stage,
        ]),
      ),
    ),
  ].sort();
  return JSON.stringify([
    record.source.id,
    Date.parse(record.startTime),
    Date.parse(record.endTime),
    record.reportedSleepMs ?? null,
    record.sleepScore ?? null,
    record.manuallyEntered ?? null,
    stages,
  ]);
}

const pad = (value: number) => String(value).padStart(2, '0');
// Local calendar date (YYYY-MM-DD) of a wake time.
export function localWakeDate(time: number): string {
  const end = new Date(time);
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(
    end.getDate(),
  )}`;
}

export type SleepDay = { date: string; ms: number | null };

function completedSleep(records: HealthRecord[], window: ReadWindow) {
  return [
    ...new Map(
      records
        .filter(
          r =>
            r.metric === 'sleep' &&
            overlaps(r.startTime, r.endTime, window) &&
            Date.parse(r.endTime) > Date.parse(r.startTime) &&
            Date.parse(r.endTime) <= Date.parse(window.end),
        )
        .map(record => [sleepIdentity(record), record]),
    ).values(),
  ];
}

// Completed sleep per local wake date. ms is null when any episode ending that day cannot be resolved:
// a missing duration is not zero sleep, and a partial total is not that day's sleep.
export function sleepByWakeDate(
  records: HealthRecord[],
  window: ReadWindow,
): SleepDay[] {
  const completed = completedSleep(records, window);
  const wakeDate = localWakeDate;
  // Resolve overlap over the entire interval set before assigning any wake date.
  const components: HealthRecord[][] = [];
  let componentEnd = -Infinity;
  for (const row of [...completed].sort(
    (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  )) {
    if (!components.length || Date.parse(row.startTime) >= componentEnd) {
      components.push([row]);
      componentEnd = Date.parse(row.endTime);
    } else {
      components[components.length - 1].push(row);
      componentEnd = Math.max(componentEnd, Date.parse(row.endTime));
    }
  }
  const days = new Map<string, { total: number; unknown: boolean }>();
  const dayFor = (key: string) => {
    let day = days.get(key);
    if (!day) {
      day = { total: 0, unknown: false };
      days.set(key, day);
    }
    return day;
  };
  const provided = (row: HealthRecord) =>
    Number.isFinite(row.reportedSleepMs) && row.reportedSleepMs! >= 0;
  for (const rows of components) {
    const value =
      rows.length === 1 && provided(rows[0])
        ? rows[0].reportedSleepMs!
        : summarizeSleep(rows, window).asleepMs;
    if (value === null) {
      // Do not average a partial total from another episode on an unresolved day.
      for (const row of rows) {
        dayFor(wakeDate(Date.parse(row.endTime))).unknown = true;
      }
    } else {
      dayFor(
        wakeDate(Math.max(...rows.map(row => Date.parse(row.endTime)))),
      ).total += value;
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({ date, ms: day.unknown ? null : day.total }));
}

// Bucket completed sleep by local wake date. Missing duration is not zero sleep.
export function sleepSummaryByDay(
  records: HealthRecord[],
  window: ReadWindow,
): MetricResult['summary'] {
  const completed = completedSleep(records, window);
  const durations = sleepByWakeDate(records, window).flatMap(day =>
    day.ms === null ? [] : [day.ms],
  );
  const latest = [...completed].sort(
    (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
  )[0];
  const score = latest?.sleepScore;
  const weekly =
    new Date(window.start).toDateString() !==
    new Date(window.end).toDateString();
  return {
    value: durations.length
      ? durations.reduce((sum, duration) => sum + duration, 0) /
        durations.length
      : null,
    unit: 'ms',
    sleepScore:
      Number.isInteger(score) && score! >= 0 && score! <= 100
        ? score
        : undefined,
    note: durations.length
      ? `${weekly ? '하루 평균' : '오늘 수면'} · 확인 ${
          durations.length
        }일 · 누락일 제외`
      : '수면 시간 미확인 · 원본 시간/단계 부족',
  };
}
// HealthKit emits individual stages, not Android-style sessions. Join only
// touching/overlapping stages from the same source; never infer a gap as sleep.
export function groupSleepStages(records: HealthRecord[]): HealthRecord[] {
  const grouped = new Map<string, HealthRecord[]>();
  for (const record of records) {
    if (
      !Number.isFinite(Date.parse(record.startTime)) ||
      !Number.isFinite(Date.parse(record.endTime)) ||
      Date.parse(record.endTime) <= Date.parse(record.startTime)
    ) {
      continue;
    }
    const key = `${record.source.id}:${record.manuallyEntered === true}`;
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }
  const episodes: HealthRecord[] = [];
  for (const rows of grouped.values()) {
    rows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    let episode: HealthRecord | undefined;
    for (const row of rows) {
      if (!episode || Date.parse(row.startTime) > Date.parse(episode.endTime)) {
        episode = {
          ...row,
          id: `episode-${row.id}`,
          stages: [...(row.stages ?? [])],
        };
        episodes.push(episode);
      } else {
        if (Date.parse(row.endTime) > Date.parse(episode.endTime)) {
          episode.endTime = row.endTime;
        }
        episode.stages!.push(...(row.stages ?? []));
      }
    }
  }
  return episodes;
}
export function summarizeSleep(
  records: HealthRecord[],
  window: ReadWindow,
): SleepSummary {
  const sessions = records.filter(
    r =>
      r.metric === 'sleep' &&
      overlaps(r.startTime, r.endTime, window) &&
      Date.parse(r.endTime) > Date.parse(r.startTime),
  );
  const intervals = sessions.map(r => ({
    start: Date.parse(r.startTime),
    end: Date.parse(r.endTime),
  }));
  const stages = sessions
    .flatMap(r =>
      (r.stages ?? []).map(s => ({
        start: Math.max(Date.parse(r.startTime), Date.parse(s.startTime)),
        end: Math.min(Date.parse(r.endTime), Date.parse(s.endTime)),
        stage: s.stage,
      })),
    )
    .filter(
      s =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start,
    );
  const points = [
    ...new Set([...intervals, ...stages].flatMap(s => [s.start, s.end])),
  ].sort((a, b) => a - b);
  let sessionMs = 0;
  let asleep = 0;
  let awakeMs = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    if (!intervals.some(s => s.start <= start && s.end >= end)) {
      continue;
    }
    const duration = end - start;
    sessionMs += duration;
    const active = stages.filter(s => s.start <= start && s.end >= end);
    if (active.some(s => s.stage === 'awake')) {
      awakeMs += duration;
    } else if (
      active.some(s => ['asleep', 'light', 'deep', 'rem'].includes(s.stage))
    ) {
      asleep += duration;
    }
  }
  return {
    sessionMs,
    awakeMs,
    confirmedAsleepMs: asleep,
    asleepMs: sessionMs > 0 && asleep + awakeMs === sessionMs ? asleep : null,
  };
}
