import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataProvider,
  type CoursePlanPaces,
  type CoursePlanTarget,
} from '../src/data';
import { CourseSearchProvider } from '../src/screens/course/CourseSearch';
import {
  CourseRunScreen,
  planTarget,
} from '../src/screens/run/CourseRunScreen';
import type { RunGoal } from '../src/screens/run/goal/runGoal';
import {
  RunGoalDraftProvider,
  useRunGoalDraft,
} from '../src/screens/run/goal/RunGoalDraft';
import { RunSessionProvider } from '../src/screens/run/RunSession';
import { SessionProvider } from '../src/session/SessionProvider';
import { ThemeProvider } from '../src/theme';

// S15P31E105-766: 2.0 asks C12 for the km plan of the picked goal, again when the goal changes, shows 계산 중… while
// it waits, and drops a late answer for an earlier goal.

jest.mock('@react-navigation/native', () => ({
  StackActions: { replace: jest.fn() },
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../src/components/RunMap', () => ({ RunMap: () => null }));
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const textOf = (screen: Screen) =>
  screen.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string)
    .join(' ');

const paces = (segments: number[]): CoursePlanPaces => ({
  segmentPacesSecPerKm: segments,
  planSource: 'PERSONAL',
  strategy: '고른 페이스',
  expectedDurationSec: segments.reduce((sum, value) => sum + value, 0),
});

let setGoal: (goal: RunGoal) => void = () => undefined;
function GoalHandle() {
  setGoal = useRunGoalDraft().setGoal;
  return null;
}

async function render() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const original = repositories.courses.getTodayPlan.bind(repositories.courses);
  // A server course: no km plan with the course itself.
  jest
    .spyOn(repositories.courses, 'getTodayPlan')
    .mockImplementation(async () => {
      const base = await original();
      return base
        ? {
            ...base,
            segmentPacesSecPerKm: [],
            strategy: null,
            planSource: null,
            targetPaceSecPerKm: null,
          }
        : base;
    });
  const calls: {
    target: CoursePlanTarget;
    resolve: (value: CoursePlanPaces | null) => void;
  }[] = [];
  jest
    .spyOn(repositories.courses, 'getPacePlan')
    .mockImplementation(
      (_courseId, target) =>
        new Promise(resolve => calls.push({ target, resolve })),
    );
  let screen!: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>
          <DataProvider repositories={repositories}>
            <ToastProvider>
              <CourseSearchProvider>
                <SessionProvider initialSignedIn>
                  <RunSessionProvider>
                    <RunGoalDraftProvider>
                      <GoalHandle />
                      <CourseRunScreen />
                    </RunGoalDraftProvider>
                  </RunSessionProvider>
                </SessionProvider>
              </CourseSearchProvider>
            </ToastProvider>
          </DataProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  for (let i = 0; i < 40 && calls.length === 0; i++) {
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 25)));
  }
  return { screen, calls };
}

test('the course shows at once with 계산 중…, then the km plan', async () => {
  const { screen, calls } = await render();
  expect(calls[0].target).toEqual({});
  expect(textOf(screen)).toContain('코스 정보');
  expect(textOf(screen)).toContain('계산 중…');
  await act(async () => calls[0].resolve(paces([343, 350])));
  expect(textOf(screen)).toContain('오늘의 전략');
  expect(textOf(screen)).toContain('5′43″');
  expect(textOf(screen)).not.toContain('계산 중…');
});

test('a new goal asks again and a late answer for the old goal is dropped', async () => {
  const { screen, calls } = await render();
  await act(async () => setGoal({ kind: 'TIME', durationSec: 1500 }));
  expect(calls[1].target).toEqual({ targetDurationSec: 1500 });
  expect(textOf(screen)).toContain('계산 중…');
  await act(async () => calls[1].resolve(paces([300, 300])));
  expect(textOf(screen)).toContain('5′00″');
  // The first request (no goal) answers late: it does not replace the 25분 plan.
  await act(async () => calls[0].resolve(paces([343, 350])));
  expect(textOf(screen)).toContain('5′00″');
  expect(textOf(screen)).not.toContain('5′43″');
});

test('no plan for the goal falls back to the course alone', async () => {
  const { screen, calls } = await render();
  await act(async () => calls[0].resolve(null));
  expect(textOf(screen)).toContain('코스 정보');
  expect(textOf(screen)).not.toContain('계산 중…');
});

test('the goal goes to C12 as a time first, else a pace, else nothing', () => {
  const course = { distanceM: 5000, plannedPace: null };
  expect(planTarget({ kind: 'TIME', durationSec: 1500 }, course)).toEqual({
    targetDurationSec: 1500,
  });
  expect(planTarget({ kind: 'PACE', paceSecPerKm: 330 }, course)).toEqual({
    targetPaceSecPerKm: 330,
  });
  expect(planTarget({ kind: 'NONE' }, course)).toEqual({});
  expect(planTarget({ kind: 'PLAN' }, course)).toEqual({});
});
