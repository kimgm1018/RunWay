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
  // Optional 0–1 thumbnail outline when the server sends one (H01 leaves it out today).
  shape?: [number, number][] | null;
  // H01 runType and the group run link (RunningRecordGroupResponse); group is null for solo runs (S15P31E105-635).
  runType?: RunType | null;
  group?: {
    groupRunId: number;
    crewName: string;
    finisherCount: number;
  } | null;
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
  // True when courseId is the private course made from this free run (S15P31E105-616); an older server leaves it out.
  courseFromFreeRun?: boolean;
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

// S11 표시용 경로(sessions.md S11, S15P31E105-549): 서버가 구간별로 워치 위치를 우선해 고르고 출처 전환·공백에서 끊은 조각.
type RouteResponse = {
  sessionId: number;
  segments: { source: 'WATCH' | 'PHONE'; coordinates: [number, number][] }[];
};

// 경로가 없거나 읽지 못하면 null이다. 경로 하나 때문에 기록 상세 전체를 실패로 보이지 않는다.
async function routePartsOf(sessionId: string): Promise<[number, number][][] | null> {
  try {
    const response = await apiRequest<RouteResponse>(`/running-sessions/${sessionId}/route`);
    const parts = (response?.segments ?? [])
      .map(segment => segment.coordinates)
      .filter(part => Array.isArray(part) && part.length > 0);
    return parts.length > 0 ? parts : null;
  } catch {
    return null;
  }
}
// H08 제목은 1~40자이고 제어·서식 문자를 받지 않는다. 화면 제목(코스 이름·별칭)이 더 길어도 링크가 만들어지게
// 문자를 쪼개지 않고 40자 안으로 줄인다(S15P31E105-704).
const shareTitleLimit = 40;
export function shareTitleOf(title: string) {
  const clean = title.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  let kept = '';
  for (const character of clean) {
    if (kept.length + character.length > shareTitleLimit) {
      break;
    }
    kept += character;
  }
  return kept.trim() || '러닝';
}

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

// H01 usually leaves out the route thumbnail; when shape points arrive, keep them for the row glyph.
// The item's own runType wins over the queried one; group keeps the crew and the group run id that opens 6.7
// (S15P31E105-635).
function toSummary(
  item: ListItem & { startedAt: string },
  runType: RunType,
): RunRecordSummary {
  const distanceM = item.totalDistance ?? 0;
  const durationSec = item.movingDuration ?? 0;
  const shape = Array.isArray(item.shape)
    ? item.shape.filter(
        (point): point is [number, number] =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === 'number' &&
          typeof point[1] === 'number',
      )
    : [];
  return {
    id: String(item.id),
    title: titleOf(item.startedAt),
    startedAt: item.startedAt,
    distanceM,
    durationSec,
    averagePaceSecPerKm:
      roundPace(item.averagePace) ??
      (distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : 0),
    shape,
    runType: item.runType ?? runType,
    group: item.group
      ? {
          crewName: item.group.crewName,
          finisherCount: item.group.finisherCount,
          groupRunId: String(item.group.groupRunId),
        }
      : null,
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
    // Newest runs across solo and group (first-run tip and 5.1 start day; S15P31E105-638).
    getRecent: async (sort, limit) => {
      const lists = await Promise.all(
        (['SOLO', 'GROUP'] as const).map(runType =>
          apiRequest<ListResponse>(path, {
            query: { runType, sort: sortParam[sort], limit },
          }).then(page =>
            started(listItems(page)).map(item => toSummary(item, runType)),
          ),
        ),
      );
      const order = (a: RunRecordSummary, b: RunRecordSummary) =>
        sort === 'distance'
          ? b.distanceM - a.distanceM
          : sort === 'pace'
          ? a.averagePaceSecPerKm - b.averagePaceSecPerKm
          : newestFirst(a, b);
      return remember(lists.flat().sort(order).slice(0, limit));
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
    // AI advice and the 내 코스 link have no server source yet, so 5.2 hides them. The measured route comes from S11;
    // a record's id is its session id (H02).
    // H02만 읽는다(S15P31E105-663). 목록·구간·경로 조회 없이 종료 직후 워치에 옮길 요약만 만든다.
    getResultSummary: async recordId => {
      const detail = await apiRequest<DetailResponse>(`${path}/${recordId}`);
      return {
        distanceM: detail.actualDistanceM,
        movingDurationSec: detail.movingDurationSec,
        averagePaceSecPerKm: roundPace(detail.averagePaceSecPerKm),
        averageHeartRate: detail.averageHeartRate,
        goalAchieved: detail.goalAchieved,
      };
    },
    getRoute: recordId => routePartsOf(recordId),
    // 공유 링크 발급(S15P31E105-704). 같은 기록은 같은 링크를 돌려받는다.
    shareLink: async (recordId, title) => {
      const response = await apiRequest<{ token: string; url: string }>(
        `${path}/${recordId}/share-link`,
        { method: 'POST', body: { title: shareTitleOf(title) } },
      );
      return response.url;
    },
    getDetail: async recordId => {
      const [detail, { splits }, summary, routeParts] = await Promise.all([
        apiRequest<DetailResponse>(`${path}/${recordId}`),
        apiRequest<{ splits: RunSplit[] }>(`${path}/${recordId}/splits`),
        known.get(recordId) ?? findSummary(recordId),
        routePartsOf(recordId),
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
        // 내 코스 저장(saveFromRun)에 쓰는 route는 서버 저장 API가 없어 그대로 비운다.
        route: null,
        routeParts,
        targetDistanceM: detail.targetDistanceM,
        targetDurationSec: detail.targetDurationSec,
        targetPaceSecPerKm: roundPace(detail.targetPaceSecPerKm),
        averageHeartRate:
          detail.averageHeartRate === null
            ? null
            : Math.round(detail.averageHeartRate),
        aiAdvice: null,
        splits: splits.map(split => ({
          ...split,
          paceSecPerKm: roundPace(split.paceSecPerKm),
        })),
        courseId: detail.courseId === null ? null : String(detail.courseId),
        courseFromFreeRun: detail.courseFromFreeRun,
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
