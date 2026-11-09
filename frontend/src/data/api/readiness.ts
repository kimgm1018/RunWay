import { errorCode } from '../errors';
import type { ReadinessState, TodayCondition } from '../types';
import { apiRequest } from './http';

// R02 response (docs/design/api/readiness.md). The confidence counts the inputs used
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

const round = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value);

// 2.1 오늘 컨디션 from R02 alone. Nothing in R02 backs a grade, condition, labels, 7-day load
// or AI advice, so API mode leaves them empty rather than showing mock values as real ones.
export function createReadinessApi({ now }: { now: () => Date }) {
  return async (): Promise<TodayCondition> => {
    const latest = await latestReadiness();
    const today = kstDate(now());
    const empty: TodayCondition = {
      date: today,
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
    };
    if (latest.kind === 'none') {
      return { ...empty, readinessState: latest.state };
    }
    const { response } = latest;
    // The date is the watch's own day, so one ahead of KST still counts as today.
    if (response.readinessDate >= today) {
      return {
        ...empty,
        readinessState: 'ready',
        readinessScore: Math.round(response.readinessScore),
        sleepMinutes: round(response.sleepDurationMin),
        restingHeartRate: round(response.restingHrBpm),
        restingHeartRateLabel:
          response.restingHrBpm !== null && response.restingHrSource
            ? restingHrSourceLabels[response.restingHrSource] ?? null
            : null,
        syncedAt: response.healthUpdatedAt ?? null,
        lastAssessedDate: response.readinessDate,
      };
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
