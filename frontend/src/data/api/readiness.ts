import { errorCode } from '../errors';
import type { ReadinessState, TodayCondition } from '../types';
import { apiRequest } from './http';

// R02 response (docs/design/api/readiness.md). The confidence counts the inputs used
// (HIGH 3 · MEDIUM 2 · LOW 1) and is not a grade, so 2.1 does not show it.
type ReadinessResponse = {
  id: number;
  readinessScore: number;
  readinessDate: string;
  readinessConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

type Latest =
  | { kind: 'score'; score: number; date: string }
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
    return {
      kind: 'score',
      score: response.readinessScore,
      date: response.readinessDate,
    };
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

// 2.1 오늘 컨디션 with the readiness score from R02. R02 has no sleep, resting heart rate,
// 7-day load or AI advice, so those keep coming from base (mock data until their own API tasks).
export function createReadinessApi({
  base,
  now,
}: {
  base: () => Promise<TodayCondition>;
  now: () => Date;
}) {
  return async (): Promise<TodayCondition> => {
    const [condition, latest] = await Promise.all([base(), latestReadiness()]);
    const today = kstDate(now());
    // R02 has no grade yet (readinessLevel is a later field), so no mock grade sits beside a real score.
    const scoreless = {
      ...condition,
      date: today,
      readinessScore: null,
      readinessSummary: null,
    };
    if (latest.kind === 'none') {
      return {
        ...scoreless,
        readinessState: latest.state,
        lastAssessedDate: null,
      };
    }
    // The date is the watch's own day, so one ahead of KST still counts as today.
    if (latest.date >= today) {
      return {
        ...scoreless,
        readinessState: 'ready',
        readinessScore: Math.round(latest.score),
        lastAssessedDate: latest.date,
      };
    }
    // 2.P′ 오래된 데이터: only an earlier day's result, which is not used as today's score.
    return {
      ...scoreless,
      readinessState: 'stale',
      lastAssessedDate: latest.date,
    };
  };
}
