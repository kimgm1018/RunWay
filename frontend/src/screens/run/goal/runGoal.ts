import type { CourseSearch } from '../../../data/types';
import { formatPace } from '../../../format';

// 러닝 목표 설정(S15P31E105-517, 레퍼런스의 Workout goal을 RunWay에 맞춘 것). 서버 목표는 거리·시간·페이스 중
// 최대 2개이고 거리는 45km 이하다(sessions.md 목표 조합). 칼로리는 측정값·목표 필드가 없어 두지 않는다.
//
// 자유 러닝: 목표 없음 · 거리 · 시간 · 페이서(거리 + 시간 → 페이스는 화면에서 계산, 서버에는 거리·시간만).
// 코스 러닝: 거리는 코스가 정한다. 추천 전략(코스 계획의 페이스) · 시간 · 페이스.
export type RunGoal =
  | { kind: 'NONE' }
  | { kind: 'PLAN' }
  | { kind: 'DISTANCE'; distanceM: number }
  | { kind: 'TIME'; durationSec: number }
  | { kind: 'PACER'; distanceM: number; durationSec: number }
  | { kind: 'PACE'; paceSecPerKm: number };

export type GoalKind = RunGoal['kind'];

export const maxGoalDistanceM = 45_000;

export const goalLimits = {
  distanceKm: { min: 0.5, max: maxGoalDistanceM / 1000, step: 0.5 },
  durationMin: { min: 5, max: 300, step: 1 },
  paceSec: { min: 180, max: 900, step: 5 },
} as const;

// Where each picker opens before anything is chosen.
export const goalDefaults = {
  distanceM: 5000,
  durationSec: 30 * 60,
  paceSecPerKm: 360,
};

const km = (metres: number) =>
  Number.isInteger(metres / 1000)
    ? String(metres / 1000)
    : (metres / 1000).toFixed(1);

export const formatGoalDistance = (metres: number) => `${km(metres)}km`;

export function formatGoalDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const rest = minutes % 60;
  return rest
    ? `${Math.floor(minutes / 60)}시간 ${rest}분`
    : `${minutes / 60}시간`;
}

export const pacerPace = (distanceM: number, durationSec: number) =>
  durationSec / (distanceM / 1000);

// The chip under the map: what the run will aim at.
export function goalLabel(goal: RunGoal, plannedPace?: number | null) {
  switch (goal.kind) {
    case 'NONE':
      return '목표 설정';
    case 'PLAN':
      return plannedPace
        ? `추천 전략 · ${formatPace(plannedPace)}/km`
        : '추천 전략';
    case 'DISTANCE':
      return `${formatGoalDistance(goal.distanceM)} 달리기`;
    case 'TIME':
      return `${formatGoalDuration(goal.durationSec)} 달리기`;
    case 'PACER':
      return `${formatGoalDistance(goal.distanceM)} · ${formatGoalDuration(
        goal.durationSec,
      )} · ${formatPace(pacerPace(goal.distanceM, goal.durationSec))}/km`;
    case 'PACE':
      return `${formatPace(goal.paceSecPerKm)}/km로 달리기`;
  }
}

// What the run starts with. A course keeps its own distance; at most two of distance · time · pace go out.
export function goalConfig(
  goal: RunGoal,
  course?: { distanceM: number; plannedPace: number | null },
): {
  goalDistanceM: number | null;
  goalDurationSec: number | null;
  goalPaceSecPerKm: number | null;
} {
  const distance = course?.distanceM ?? null;
  switch (goal.kind) {
    case 'NONE':
      return {
        goalDistanceM: distance,
        goalDurationSec: null,
        goalPaceSecPerKm: null,
      };
    case 'PLAN':
      return {
        goalDistanceM: distance,
        goalDurationSec: null,
        goalPaceSecPerKm: course?.plannedPace ?? null,
      };
    case 'DISTANCE':
      return {
        goalDistanceM: goal.distanceM,
        goalDurationSec: null,
        goalPaceSecPerKm: null,
      };
    case 'TIME':
      return {
        goalDistanceM: distance,
        goalDurationSec: goal.durationSec,
        goalPaceSecPerKm: null,
      };
    case 'PACER':
      return {
        goalDistanceM: goal.distanceM,
        goalDurationSec: goal.durationSec,
        goalPaceSecPerKm: null,
      };
    case 'PACE':
      return {
        goalDistanceM: distance,
        goalDurationSec: null,
        goalPaceSecPerKm: goal.paceSecPerKm,
      };
  }
}

// The goal typed on 3.1 (목표 시간 or 목표 페이스) for the course picked from its results (S15P31E105-635); null
// without a 3.1 search, so 2.0 falls back to its own default.
export function goalFromSearch(search: CourseSearch | null): RunGoal | null {
  if (search?.goalInputType === 'TIME' && search.targetDurationSec) {
    return { kind: 'TIME', durationSec: search.targetDurationSec };
  }
  if (search?.goalInputType === 'PACE' && search.targetPaceSecPerKm) {
    return { kind: 'PACE', paceSecPerKm: search.targetPaceSecPerKm };
  }
  return null;
}
