import {
  goalConfig,
  goalLabel,
  maxGoalDistanceM,
  goalLimits,
  type RunGoal,
} from '../src/screens/run/goal/runGoal';
import { goalPaceOf, type RunConfig } from '../src/screens/run/RunSession';

// 운동 목표 (S15P31E105-517): S01 takes at most two of distance · time · pace, and a distance of 45km at most
// (sessions.md 목표 조합). There is no calorie goal: the app measures no calories and the server has no field.

const count = (config: ReturnType<typeof goalConfig>) =>
  [config.goalDistanceM, config.goalDurationSec, config.goalPaceSecPerKm].filter(
    value => value !== null,
  ).length;

const freeGoals: RunGoal[] = [
  { kind: 'NONE' },
  { kind: 'DISTANCE', distanceM: 5000 },
  { kind: 'TIME', durationSec: 1800 },
  { kind: 'PACER', distanceM: 6000, durationSec: 1800 },
];
const courseGoals: RunGoal[] = [
  { kind: 'PLAN' },
  { kind: 'TIME', durationSec: 1800 },
  { kind: 'PACE', paceSecPerKm: 330 },
];
const course = { distanceM: 5000, plannedPace: 360 };

test('every goal sends at most two of distance · time · pace, and a course keeps its distance', () => {
  for (const goal of freeGoals) {
    expect(count(goalConfig(goal))).toBeLessThanOrEqual(2);
  }
  for (const goal of courseGoals) {
    const config = goalConfig(goal, course);
    expect(count(config)).toBeLessThanOrEqual(2);
    expect(config.goalDistanceM).toBe(5000);
  }
  expect(goalConfig({ kind: 'NONE' })).toEqual({
    goalDistanceM: null,
    goalDurationSec: null,
    goalPaceSecPerKm: null,
  });
  // 페이서 sends the distance and the time; the pace is worked out on screen.
  expect(goalConfig({ kind: 'PACER', distanceM: 6000, durationSec: 1800 })).toEqual({
    goalDistanceM: 6000,
    goalDurationSec: 1800,
    goalPaceSecPerKm: null,
  });
  expect(goalConfig({ kind: 'PLAN' }, course).goalPaceSecPerKm).toBe(360);
  expect(goalLimits.distanceKm.max * 1000).toBe(maxGoalDistanceM);
});

test('the chip names the goal, and the run screen gets the pace a distance and a time make', () => {
  expect(goalLabel({ kind: 'NONE' })).toBe('목표 설정');
  expect(goalLabel({ kind: 'DISTANCE', distanceM: 5000 })).toBe('5km 달리기');
  expect(goalLabel({ kind: 'TIME', durationSec: 5400 })).toBe('1시간 30분 달리기');
  expect(goalLabel({ kind: 'PACER', distanceM: 6000, durationSec: 1800 })).toBe(
    '6km · 30분 · 5′00″/km',
  );
  expect(goalLabel({ kind: 'PLAN' }, 360)).toBe('추천 전략 · 6′00″/km');
  const config: RunConfig = {
    mode: 'FREE',
    plan: null,
    goalDistanceM: 6000,
    goalDurationSec: 1800,
    goalPaceSecPerKm: null,
  };
  expect(goalPaceOf(config)).toBe(300);
  expect(goalPaceOf({ ...config, goalPaceSecPerKm: 330 })).toBe(330);
  expect(goalPaceOf({ ...config, goalDurationSec: null })).toBeNull();
});
