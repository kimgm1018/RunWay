import {
  goalConfig,
  goalFromSearch,
  goalLabel,
  maxGoalDistanceM,
  goalLimits,
  type RunGoal,
} from '../src/screens/run/goal/runGoal';
import { goalPaceOf, type RunConfig } from '../src/screens/run/RunSession';

// 운동 목표 (S15P31E105-517): S01 takes at most two of distance · time · pace, and a distance of 45km at most
// (sessions.md 목표 조합). There is no calorie goal: the app measures no calories and the server has no field.

const count = (config: ReturnType<typeof goalConfig>) =>
  [
    config.goalDistanceM,
    config.goalDurationSec,
    config.goalPaceSecPerKm,
  ].filter(value => value !== null).length;

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

test.each([5000, 5023.2, 5023.5, 5023.78])(
  'course distance %s becomes an integer metre goal without changing the course',
  distanceM => {
    const source = { distanceM, plannedPace: 360 };
    const expected =
      distanceM === 5000 ? 5000 : distanceM === 5023.2 ? 5023 : 5024;
    for (const goal of [{ kind: 'NONE' } as const, ...courseGoals]) {
      expect(goalConfig(goal, source).goalDistanceM).toBe(expected);
    }
    expect(source.distanceM).toBe(distanceM);
  },
);

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
  expect(
    goalConfig({ kind: 'PACER', distanceM: 6000, durationSec: 1800 }),
  ).toEqual({
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
  expect(goalLabel({ kind: 'TIME', durationSec: 5400 })).toBe(
    '1시간 30분 달리기',
  );
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

// 3.1's goal reaches 2.0 with the course picked from its results (S15P31E105-635).
test('the 3.1 goal becomes the 2.0 goal', () => {
  const search = {
    origin: { name: '현재 위치', position: [129.1, 35.1] as [number, number] },
    targetDistanceM: 5000,
    environmentTypes: [],
  };
  expect(
    goalFromSearch({
      ...search,
      goalInputType: 'TIME',
      targetDurationSec: 1500,
      targetPaceSecPerKm: null,
    }),
  ).toEqual({ kind: 'TIME', durationSec: 1500 });
  expect(
    goalFromSearch({
      ...search,
      goalInputType: 'PACE',
      targetDurationSec: null,
      targetPaceSecPerKm: 330,
    }),
  ).toEqual({ kind: 'PACE', paceSecPerKm: 330 });
  expect(goalFromSearch(null)).toBeNull();
});

// 거리 + 페이스 and 시간 + 페이스 (S15P31E105-683): the two chosen go out, the third stays out.
test('a pace with a distance or a time sends those two', () => {
  expect(
    goalConfig({ kind: 'DISTANCE_PACE', distanceM: 5000, paceSecPerKm: 360 }),
  ).toEqual({
    goalDistanceM: 5000,
    goalDurationSec: null,
    goalPaceSecPerKm: 360,
  });
  expect(
    goalConfig({ kind: 'TIME_PACE', durationSec: 1800, paceSecPerKm: 360 }),
  ).toEqual({
    goalDistanceM: null,
    goalDurationSec: 1800,
    goalPaceSecPerKm: 360,
  });
  expect(
    goalLabel({ kind: 'DISTANCE_PACE', distanceM: 5000, paceSecPerKm: 360 }),
  ).toBe('5km · 6′00″/km');
  expect(
    goalLabel({ kind: 'TIME_PACE', durationSec: 1800, paceSecPerKm: 360 }),
  ).toBe('30분 · 6′00″/km');
});
