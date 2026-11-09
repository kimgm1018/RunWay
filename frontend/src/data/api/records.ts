import type {
  MonthlyRunSummary,
  PaceTrend,
  PeriodSummary,
  RecordSort,
  Repositories,
  RunRecordSummary,
  RunSplit,
} from '../types';
import { DataError } from '../errors';
import { apiRequest } from './http';
import { listItems } from './listItems';

// H01·H02·H03·H06·H07 러닝 기록 (docs/design/api/running-records.md). Numbers the server keeps as decimals
// (distance, pace) arrive as JSON numbers; paces are rounded to whole seconds for display.

type RunType = RunRecordSummary['runType'];

type ListItem = {
  id: number;
  courseId: number | null;
  startedAt: string | null;
  totalDistance: number | null;
  movingDuration: number | null;
  averagePace: number | null;
  goalAchieved: boolean | null;
};

// `page` is the next page's cursor, left out on the last page.
type ListResponse = { items: ListItem[]; page?: string };

type DetailResponse = {
  sessionId: number;
  targetDistanceM: number | null;
  targetDurationSec: number | null;
  actualDistanceM: number | null;
  movingDurationSec: number | null;
  elapsedDurationSec: number | null;
  averagePaceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
  goalAchieved: boolean | null;
  courseId: number | null;
  targetPaceSecPerKm: number | null;
  comparisonSessionId: number | null;
};

// previousPeriod deltas are current − previous.
type StatisticsResponse = {
  runCount: number;
  totalDistanceM: number;
  totalDurationSec: number;
  averagePaceSecPerKm: number | null;
  breakdown: { distanceM: number }[];
  heartRateZones: { zone: number; ratio: number }[];
  previousPeriod: {
    runCount: number;
    totalDistanceM: number;
    averagePaceSecPerKm: number | null;
    averagePaceSecPerKmDelta: number | null;
  } | null;
};

const path = '/running-records';
// The server's largest H01 page.
const pageLimit = 50;
const kstOffsetMs = 9 * 60 * 60 * 1000;

const sortParam: Record<RecordSort, string> = {
  recent: 'LATEST',
  distance: 'DISTANCE',
  pace: 'PACE',
};

const roundPace = (pace: number | null) =>
  pace === null ? null : Math.round(pace);

const kstTime = (iso: string) => new Date(Date.parse(iso) + kstOffsetMs);

// H01 has no title, so a run is named after the time of day it started (KST); 5.1's badge marks group runs.
function titleOf(startedAt: string) {
  const hour = kstTime(startedAt).getUTCHours();
  const part =
    hour < 5
      ? '새벽'
      : hour < 11
      ? '아침'
      : hour < 14
      ? '점심'
      : hour < 18
      ? '오후'
      : hour < 22
      ? '저녁'
      : '밤';
  return `${part} 러닝`;
}

// H01 leaves out the route thumbnail and the group's crew, so the row shows a blank thumbnail and the run time.
function toSummary(
  item: ListItem & { startedAt: string },
  runType: RunType,
): RunRecordSummary {
  const distanceM = item.totalDistance ?? 0;
  const durationSec = item.movingDuration ?? 0;
  return {
    id: String(item.id),
    title: titleOf(item.startedAt),
    startedAt: item.startedAt,
    distanceM,
    durationSec,
    averagePaceSecPerKm:
      roundPace(item.averagePace) ??
      (distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : 0),
    shape: [],
    runType,
    group: null,
    goalAchieved: item.goalAchieved,
  };
}

// A completed run always has a start time; one without it cannot be placed on the calendar.
const started = (items: ListItem[]) =>
  items.filter((item): item is ListItem & { startedAt: string } =>
    Boolean(item.startedAt),
  );

const newestFirst = (a: RunRecordSummary, b: RunRecordSummary) =>
  Date.parse(b.startedAt) - Date.parse(a.startedAt);

// YYYY-MM-01 00:00 in Korea as an ISO instant, the H01 from/to format.
const monthStart = (month: string) =>
  new Date(`${month}-01T00:00:00+09:00`).toISOString();

function nextMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return number === 12
    ? `${year + 1}-01`
    : `${year}-${String(number + 1).padStart(2, '0')}`;
}

function toPeriodSummary(response: StatisticsResponse): PeriodSummary {
  return {
    runCount: response.runCount,
    totalDistanceM: response.totalDistanceM,
    totalDurationSec: response.totalDurationSec,
    averagePaceSecPerKm: roundPace(response.averagePaceSecPerKm),
  };
}

// H06 always counts every run type, like the mock: 5.1's month summary covers the month whatever the tab.
const statistics = (period: string, baseDate: string) =>
  apiRequest<StatisticsResponse>(`${path}/statistics`, {
    query: { period, baseDate },
  });

// Every H01 page for the query, following the cursor.
async function listAll(query: Record<string, string>) {
  const items: ListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await apiRequest<ListResponse>(path, {
      query: { ...query, limit: pageLimit, cursor },
    });
    items.push(...listItems(page));
    cursor = page?.page;
  } while (cursor);
  return started(items);
}

// Runs of one month for the H01 runType; ALL is two queries so each run keeps its type (5.1 그룹런 badge).
async function monthRuns(month: string, runTypes: RunType[]) {
  const window = { from: monthStart(month), to: monthStart(nextMonth(month)) };
  const lists = await Promise.all(
    runTypes.map(runType =>
      listAll({ ...window, runType, sort: 'LATEST' }).then(items =>
        items.map(item => toSummary(item, runType)),
      ),
    ),
  );
  return lists.flat().sort(newestFirst);
}

// Server repositories for 5.1·5.2·5.3 and the 2.1 기록 sections. H02 has no start time or run type, so list
// rows are kept by id for the detail screen, which is always opened from a list.
export function createRecordsApi() {
  const known = new Map<string, RunRecordSummary>();
  const remember = (records: RunRecordSummary[]) => {
    records.forEach(record => known.set(record.id, record));
    return records;
  };

  // A record that was not listed yet: look through my runs, newest first.
  async function findSummary(recordId: string) {
    for (const runType of ['SOLO', 'GROUP'] as const) {
      let cursor: string | undefined;
      do {
        const page = await apiRequest<ListResponse>(path, {
          query: { runType, sort: 'LATEST', limit: pageLimit, cursor },
        });
        const match = started(listItems(page)).find(
          item => String(item.id) === recordId,
        );
        if (match) {
          return remember([toSummary(match, runType)])[0];
        }
        cursor = page?.page;
      } while (cursor);
    }
    return null;
  }

  const records: Repositories['records'] = {
    // 2.1 과거 러닝 기록 lists my solo runs.
    getRecent: async (sort, limit) => {
      const page = await apiRequest<ListResponse>(path, {
        query: { runType: 'SOLO', sort: sortParam[sort], limit },
      });
      return remember(
        started(listItems(page)).map(item => toSummary(item, 'SOLO')),
      );
    },
    getMonth: async (month, filter) => {
      const [summary, runs] = await Promise.all([
        statistics('MONTH', `${month}-01`),
        monthRuns(month, filter === 'ALL' ? ['SOLO', 'GROUP'] : [filter]),
      ]);
      return {
        month,
        summary: toPeriodSummary(summary),
        records: remember(runs),
      };
    },
    // The route map, AI advice and 내 코스 link have no server source yet, so 5.2 hides them.
    getDetail: async recordId => {
      const [detail, { splits }, summary] = await Promise.all([
        apiRequest<DetailResponse>(`${path}/${recordId}`),
        apiRequest<{ splits: RunSplit[] }>(`${path}/${recordId}/splits`),
        known.get(recordId) ?? findSummary(recordId),
      ]);
      // H02 answered, so H01 lists the run; this only guards a run removed in between.
      if (!summary) {
        throw new DataError('RECORD_NOT_FOUND', '기록 없음');
      }
      return {
        ...summary,
        distanceM: detail.actualDistanceM ?? summary.distanceM,
        durationSec: detail.movingDurationSec ?? summary.durationSec,
        averagePaceSecPerKm:
          roundPace(detail.averagePaceSecPerKm) ?? summary.averagePaceSecPerKm,
        goalAchieved: detail.goalAchieved,
        route: null,
        targetDurationSec: detail.targetDurationSec,
        targetPaceSecPerKm: roundPace(detail.targetPaceSecPerKm),
        aiAdvice: null,
        splits: splits.map(split => ({
          ...split,
          paceSecPerKm: roundPace(split.paceSecPerKm),
        })),
        courseId: detail.courseId === null ? null : String(detail.courseId),
        myCourseId: null,
      };
    },
    getStatistics: async (period, baseDate) => {
      const response = await statistics(period, baseDate);
      const previous = response.previousPeriod;
      return {
        ...toPeriodSummary(response),
        // Already in order: Monday first, week 1 first or January first.
        breakdown: response.breakdown.map(item => item.distanceM),
        heartRateZones: [...response.heartRateZones]
          .sort((a, b) => a.zone - b.zone)
          .map(zone => zone.ratio),
        // A period without runs compares against zeros, as in the mock.
        previousPeriod:
          previous && previous.runCount > 0
            ? {
                runCount: previous.runCount,
                totalDistanceM: previous.totalDistanceM,
                averagePaceSecPerKm: roundPace(previous.averagePaceSecPerKm),
              }
            : null,
      };
    },
    getPaceTrend: async months => {
      const response = await apiRequest<PaceTrend>(
        `${path}/statistics/pace-trend`,
        { query: { months } },
      );
      return {
        items: listItems(response).map(item => ({
          ...item,
          averagePaceSecPerKm: roundPace(item.averagePaceSecPerKm),
        })),
        changeSecPerKm: roundPace(response.changeSecPerKm),
      };
    },
    // H01 courseId: only my COMPLETED runs on the course come back (running-records.md 3.2 경쟁 모드).
    getCourseRuns: async courseId => {
      const lists = await Promise.all(
        (['SOLO', 'GROUP'] as const).map(runType =>
          listAll({ courseId, runType, sort: 'LATEST' }).then(items =>
            items.map(item => toSummary(item, runType)),
          ),
        ),
      );
      return remember(lists.flat().sort(newestFirst));
    },
    // S09 러닝 세션 삭제: the record ID is the session ID. The server also deletes my posts sharing it.
    remove: async recordId => {
      await apiRequest(`/running-sessions/${recordId}`, { method: 'DELETE' });
      known.delete(recordId);
    },
  };

  // 2.1 러닝 분석: this month's H06 totals, with the weekday bars summed from the month's H01 runs.
  const getMonthlySummary: Repositories['home']['getMonthlySummary'] =
    async () => {
      const month = new Date(Date.now() + kstOffsetMs)
        .toISOString()
        .slice(0, 7);
      const [response, runs] = await Promise.all([
        statistics('MONTH', `${month}-01`),
        monthRuns(month, ['SOLO', 'GROUP']),
      ]);
      const weekdays = Array.from({ length: 7 }, () => 0);
      runs.forEach(run => {
        weekdays[(kstTime(run.startedAt).getUTCDay() + 6) % 7] += run.distanceM;
      });
      const busiest = Math.max(...weekdays);
      const delta = response.previousPeriod?.averagePaceSecPerKmDelta ?? null;
      const summary: MonthlyRunSummary = {
        month,
        runCount: response.runCount,
        totalDistanceM: response.totalDistanceM,
        averagePaceSecPerKm: roundPace(response.averagePaceSecPerKm),
        weekdayRatios: weekdays.map(distance =>
          busiest > 0 ? distance / busiest : 0,
        ),
        // Faster this month means a smaller pace, so the delta is negative.
        paceImprovementSec: delta === null ? null : Math.round(-delta) || 0,
      };
      return summary;
    };

  return { records, getMonthlySummary };
}
