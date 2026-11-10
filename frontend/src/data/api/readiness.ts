import { errorCode } from '../errors';
import type {
  ReadinessState,
  ScoreFactors,
  TodayCondition,
  TrainingLoad,
} from '../types';
import { apiRequest } from './http';

// R02·R03 response (docs/design/api/readiness.md). The confidence counts the inputs used
// (HIGH 3 · MEDIUM 2 · LOW 1) and is not a grade, so 2.1 does not show it. The health
// metrics come from the same day's health row as the score, null when not measured.
type ReadinessResponse = {
  id: number;
  readinessScore: number;
  readinessDate: string;
  readinessConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  restingHrBpm: number | null;
  // S15P31E105-600: where the resting heart rate came from; null without a value or a known source.
  restingHrSource?: 'RUNWAY_WATCH' | 'SAMSUNG_HEALTH' | null;
  sleepDurationMin: number | null;
  healthUpdatedAt: string | null;
  // S15P31E105-599: training load (TRIMP) of the last 7 days up to readinessDate and the usual weekly load. Both null
  // when the 28 days up to readinessDate have no load. Optional for a server before this contract.
  weeklyTrainingLoad?: number | null;
  usualWeeklyTrainingLoad?: number | null;
  // S15P31E105-639: D-6~D daily load (null = no exercise) and the formula's item scores. Optional for an older server.
  dailyTrainingLoads?: { date: string; load: number | null }[] | null;
  sleepScore?: number | null;
  recoveryScore?: number | null;
  loadScore?: number | null;
  restingHrChangePct?: number | null;
};

type Latest =
  | { kind: 'score'; response: ReadinessResponse }
  | { kind: 'none'; state: Exclude<ReadinessState, 'ready' | 'stale'> };

const kstOffsetMs = 9 * 60 * 60 * 1000;
const kstDate = (time: Date) =>
  new Date(time.getTime() + kstOffsetMs).toISOString().slice(0, 10);

// No result yet (404) and no health consent (403) are 2.1 states, not load failures.
async function latestReadiness(): Promise<Latest> {
  try {
    const response = await apiRequest<ReadinessResponse>(
      '/readiness-assessments/latest',
    );
    return { kind: 'score', response };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ASSESSMENT_NOT_FOUND') {
      return { kind: 'none', state: 'collecting' };
    }
    if (code === 'CONSENT_REQUIRED') {
      return { kind: 'none', state: 'permissionDenied' };
    }
    throw error;
  }
}

// 2.1 names the source under the resting heart rate (2026-11-09 사용자 결정 D-9).
const restingHrSourceLabels: Record<string, string> = {
  RUNWAY_WATCH: 'RunWay 워치',
  SAMSUNG_HEALTH: '삼성 헬스',
};

// 2.1 주간 부하 against the usual week (S15P31E105-599). The bounds follow the formula's ratio bands 1.2·1.6.
export function weeklyLoadLabel(
  weekly: number,
  usual: number | null | undefined,
): string {
  if (usual === null || usual === undefined || !(usual > 0)) {
    return '평소 기록 없음';
  }
  const ratio = weekly / usual;
  if (ratio < 0.8) {
    return '평소보다 적음';
  }
  if (ratio <= 1.2) {
    return '평소와 비슷';
  }
  if (ratio <= 1.6) {
    return '평소보다 많음';
  }
  return '많이 많음';
}

const round = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value);

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// The D-6~D list only when it is a list of dated days; anything else is left out rather than drawn wrong.
function dailyLoads(
  value: ReadinessResponse['dailyTrainingLoads'],
): TrainingLoad['days'] {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const days = value.map(day => ({
    date: typeof day?.date === 'string' ? day.date : '',
    load: finite(day?.load),
  }));
  return days.every(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    ? [...days].sort((a, b) => a.date.localeCompare(b.date))
    : null;
}

function scoreFactors(response: ReadinessResponse): ScoreFactors | null {
  const factors = {
    sleep: finite(response.sleepScore),
    recovery: finite(response.recoveryScore),
    load: finite(response.loadScore),
    restingHrChangePct: finite(response.restingHrChangePct),
  };
  return factors.sleep === null &&
    factors.recovery === null &&
    factors.load === null
    ? null
    : factors;
}

// 2.1 오늘 컨디션 from R02 alone. Nothing in R02 backs a grade, condition, labels or AI advice, so API mode leaves
// them empty rather than showing mock values as real ones. The 7-day load comes from R02 (S15P31E105-599).
const emptyCondition = (date: string): TodayCondition => ({
  date,
  syncedAt: null,
  readinessState: 'collecting',
  readinessScore: null,
  condition: null,
  sleepMinutes: null,
  restingHeartRate: null,
  readinessSummary: null,
  sleepLabel: null,
  restingHeartRateLabel: null,
  weeklyLoad: null,
  weeklyLoadLabel: null,
  aiAdvice: null,
  lastAssessedDate: null,
});

// One R02 result as the card's condition for the given day.
function readyCondition(
  response: ReadinessResponse,
  date: string,
): TodayCondition {
  const weekly = response.weeklyTrainingLoad;
  const hasWeekly = typeof weekly === 'number' && Number.isFinite(weekly);
  return {
    ...emptyCondition(date),
    readinessState: 'ready',
    readinessScore: Math.round(response.readinessScore),
    sleepMinutes: round(response.sleepDurationMin),
    restingHeartRate: round(response.restingHrBpm),
    restingHeartRateLabel:
      response.restingHrBpm !== null && response.restingHrSource
        ? restingHrSourceLabels[response.restingHrSource] ?? null
        : null,
    weeklyLoad: hasWeekly ? String(Math.round(weekly)) : null,
    weeklyLoadLabel: hasWeekly
      ? weeklyLoadLabel(weekly, response.usualWeeklyTrainingLoad)
      : null,
    trainingLoad: hasWeekly
      ? {
          weekly,
          usual: finite(response.usualWeeklyTrainingLoad),
          days: dailyLoads(response.dailyTrainingLoads),
        }
      : null,
    scoreFactors: scoreFactors(response),
    syncedAt: response.healthUpdatedAt ?? null,
    lastAssessedDate: response.readinessDate,
  };
}

export function createReadinessApi({ now }: { now: () => Date }) {
  return async (): Promise<TodayCondition> => {
    const latest = await latestReadiness();
    const today = kstDate(now());
    const empty = emptyCondition(today);
    if (latest.kind === 'none') {
      return { ...empty, readinessState: latest.state };
    }
    const { response } = latest;
    // The date is the watch's own day, so one ahead of KST still counts as today.
    if (response.readinessDate >= today) {
      return readyCondition(response, today);
    }
    // 2.P′ 오래된 데이터: only an earlier day's result. Neither its score nor that day's
    // metrics are shown as today's.
    return {
      ...empty,
      readinessState: 'stale',
      lastAssessedDate: response.readinessDate,
    };
  };
}

// 2.1 준비도 on a past day (S15P31E105-594·660): R03 gives the result of the chosen day with that day's own metrics
// and load. No result that day (404) and no health consent (403) are both "no score that day" (660 사용자 결정); any
// other failure is a load error. An answer for another day is never shown as the chosen one.
export function createReadinessOnApi() {
  return async (day: string): Promise<TodayCondition | null> => {
    try {
      const response = await apiRequest<ReadinessResponse>(
        `/readiness-assessments/dates/${encodeURIComponent(day)}`,
      );
      return response.readinessDate === day
        ? readyCondition(response, day)
        : null;
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ASSESSMENT_NOT_FOUND' || code === 'CONSENT_REQUIRED') {
        return null;
      }
      throw error;
    }
  };
}
