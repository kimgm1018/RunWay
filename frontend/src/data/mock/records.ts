import type {
  AnalysisPeriod,
  PaceTrend,
  PeriodSummary,
  RecordFilter,
  RecordMonth,
  RunRecordDetail,
  RunRecordDraft,
  RunRecordSummary,
  RunSplit,
  RunStatistics,
  SavedCourse,
} from '../types';
import * as fixtures from './fixtures';
import type { RecordFixture } from './fixtures';

// 5.1·5.2·5.3 answers built from the mock run list, the way the server would aggregate them.

const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
const splitM = 500;

// YYYY-MM-DD of an ISO time in Korea.
export const kstDay = (iso: string) =>
  new Date(Date.parse(iso) + kstOffsetMs).toISOString().slice(0, 10);

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) =>
  toDay(new Date(toDate(day).getTime() + days * dayMs));
export const addMonths = (month: string, months: number) => {
  const date = toDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDay(date).slice(0, 7);
};
// Monday of the week that holds the day.
const mondayOf = (day: string) =>
  addDays(day, -((toDate(day).getUTCDay() + 6) % 7));

export function toSummary(record: RecordFixture): RunRecordSummary {
  return {
    id: record.id,
    title: record.title,
    startedAt: record.startedAt,
    distanceM: record.distanceM,
    durationSec: record.durationSec,
    averagePaceSecPerKm: Math.round(
      record.durationSec / (record.distanceM / 1000),
    ),
    shape: record.shape,
    runType: record.runType,
    group: record.group,
    goalAchieved:
      record.targetDurationSec === null
        ? null
        : record.durationSec <= record.targetDurationSec,
  };
}

export function summaryOf(records: RecordFixture[]): PeriodSummary {
  const totalDistanceM = records.reduce((sum, run) => sum + run.distanceM, 0);
  const totalDurationSec = records.reduce(
    (sum, run) => sum + run.durationSec,
    0,
  );
  return {
    runCount: records.length,
    totalDistanceM,
    totalDurationSec,
    averagePaceSecPerKm:
      totalDistanceM > 0
        ? Math.round(totalDurationSec / (totalDistanceM / 1000))
        : null,
  };
}

const inMonth = (records: RecordFixture[], month: string) =>
  records.filter(run => kstDay(run.startedAt).startsWith(month));
const between = (records: RecordFixture[], from: string, until: string) =>
  records.filter(run => {
    const day = kstDay(run.startedAt);
    return day >= from && day < until;
  });
const distanceOf = (records: RecordFixture[]) =>
  records.reduce((sum, run) => sum + run.distanceM, 0);

export function monthOf(
  records: RecordFixture[],
  month: string,
  filter: RecordFilter,
): RecordMonth {
  const runs = inMonth(records, month);
  return {
    month,
    summary: summaryOf(runs),
    records: runs
      .filter(run => filter === 'ALL' || run.runType === filter)
      .map(toSummary),
  };
}

// A steady wave around the run's averages for runs without recorded splits.
function splitsOf(record: RecordFixture): RunSplit[] {
  const recorded = fixtures.recordSplits[record.id];
  // A short remainder joins the last split, so 5.02km has ten splits.
  const count =
    recorded?.pace.length ?? Math.max(1, Math.floor(record.distanceM / splitM));
  const pace = record.durationSec / (record.distanceM / 1000);
  const seed = record.distanceM % 7;
  const wave = (index: number, average: number, swing: number) =>
    Math.round(average + swing * Math.sin(index / 1.6 + seed));
  return Array.from({ length: count }, (_, index) => ({
    startDistanceM: index * splitM,
    endDistanceM: index === count - 1 ? record.distanceM : (index + 1) * splitM,
    paceSecPerKm: recorded?.pace[index] ?? wave(index, pace, 9),
    averageHeartRate: record.watch
      ? recorded?.heartRate[index] ?? wave(index, 154, 9)
      : null,
    averageCadence: record.watch
      ? recorded?.cadence[index] ?? wave(index, 171, 4)
      : null,
  }));
}

export function toDetail(
  record: RecordFixture,
  saved: SavedCourse[],
): RunRecordDetail {
  const mine = saved.find(
    course =>
      course.id === record.courseId || course.id === `course-${record.id}`,
  );
  const splits = splitsOf(record);
  const heart = splits
    .map(split => split.averageHeartRate)
    .filter((value): value is number => value !== null);
  return {
    ...toSummary(record),
    route: record.route,
    routeParts: record.route && record.route.length > 1 ? [record.route] : null,
    // Mock fixtures keep no separate distance goal; course runs still expose duration goals.
    targetDistanceM: null,
    targetDurationSec: record.targetDurationSec,
    targetPaceSecPerKm: record.targetPaceSecPerKm,
    // The mock keeps no run average, so it is the splits' (H02 has its own).
    averageHeartRate: heart.length
      ? Math.round(heart.reduce((sum, value) => sum + value, 0) / heart.length)
      : null,
    aiAdvice: record.aiAdvice,
    splits,
    courseId: record.courseId,
    myCourseId: mine?.id ?? null,
  };
}

export function fromDraft(
  draft: RunRecordDraft,
  id: string,
  title: string,
  shape: [number, number][],
  group: RecordFixture['group'] = null,
): RecordFixture {
  return {
    id,
    title,
    startedAt: draft.startedAt,
    distanceM: Math.round(draft.distanceM),
    durationSec: draft.durationSec,
    shape,
    runType: group ? 'GROUP' : 'SOLO',
    group,
    groupRunId: draft.groupRunId ?? undefined,
    route: draft.route,
    targetDurationSec:
      draft.goalDistanceM && draft.goalPaceSecPerKm
        ? Math.round((draft.goalDistanceM / 1000) * draft.goalPaceSecPerKm)
        : null,
    targetPaceSecPerKm: draft.goalPaceSecPerKm,
    courseId: draft.courseId,
    watch: draft.averageHeartRate !== null,
    aiAdvice: null,
  };
}

const zonesFor = (summary: PeriodSummary, zones: number[]) =>
  summary.runCount > 0 ? zones : [];

export function statisticsOf(
  records: RecordFixture[],
  period: AnalysisPeriod,
  baseDate: string,
): RunStatistics {
  if (period === 'WEEK') {
    const from = mondayOf(baseDate);
    const summary = summaryOf(between(records, from, addDays(from, 7)));
    const previous = summaryOf(between(records, addDays(from, -7), from));
    return {
      ...summary,
      breakdown: Array.from({ length: 7 }, (_, index) =>
        distanceOf(
          between(records, addDays(from, index), addDays(from, index + 1)),
        ),
      ),
      heartRateZones: zonesFor(summary, fixtures.defaultHeartZones),
      previousPeriod: previous.runCount > 0 ? previous : null,
    };
  }
  if (period === 'MONTH') {
    const month = baseDate.slice(0, 7);
    const runs = inMonth(records, month);
    const summary = summaryOf(runs);
    const previous = summaryOf(inMonth(records, addMonths(month, -1)));
    const days =
      (toDate(`${addMonths(month, 1)}-01`).getTime() -
        toDate(`${month}-01`).getTime()) /
      dayMs;
    return {
      ...summary,
      breakdown:
        month === '2026-10'
          ? fixtures.octoberWeeklyDistanceM
          : Array.from({ length: Math.ceil(days / 7) }, (_, index) =>
              distanceOf(
                runs.filter(
                  run =>
                    Math.ceil(Number(kstDay(run.startedAt).slice(8)) / 7) ===
                    index + 1,
                ),
              ),
            ),
      heartRateZones: zonesFor(
        summary,
        month === '2026-10'
          ? fixtures.octoberHeartZones
          : fixtures.defaultHeartZones,
      ),
      previousPeriod: previous.runCount > 0 ? previous : null,
    };
  }
  const year = Number(baseDate.slice(0, 4));
  const yearSummary = (shown: number) =>
    fixtures.yearSummaries[shown] ??
    summaryOf(
      records.filter(run => kstDay(run.startedAt).startsWith(`${shown}`)),
    );
  const summary = yearSummary(year);
  const previous = yearSummary(year - 1);
  return {
    ...summary,
    breakdown: Array.from({ length: 12 }, (_, index) =>
      year === 2026
        ? Math.round((fixtures.monthlyDistanceKm[index] ?? 0) * 1000)
        : 0,
    ),
    heartRateZones: zonesFor(summary, fixtures.defaultHeartZones),
    previousPeriod: previous.runCount > 0 ? previous : null,
  };
}

// H07: the last `months` months up to the current one.
export function paceTrendOf(
  records: RecordFixture[],
  months: number,
  currentMonth: string,
): PaceTrend {
  const items = Array.from({ length: months }, (_, index) => {
    const month = addMonths(currentMonth, index - months + 1);
    const runs = inMonth(records, month);
    return {
      month,
      averagePaceSecPerKm:
        fixtures.monthlyPace[month] ?? summaryOf(runs).averagePaceSecPerKm,
      runCount: runs.length,
    };
  });
  const paces = items
    .map(item => item.averagePaceSecPerKm)
    .filter((pace): pace is number => pace !== null);
  return {
    items,
    changeSecPerKm:
      paces.length > 1 ? paces[paces.length - 1] - paces[0] : null,
  };
}
