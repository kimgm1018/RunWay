import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataProvider,
  type CoursePlan,
} from '../src/data';
import { CourseSearchProvider } from '../src/screens/course/CourseSearch';
import { CourseRunScreen } from '../src/screens/run/CourseRunScreen';
import { RunGoalDraftProvider } from '../src/screens/run/goal/RunGoalDraft';
import { RunSessionProvider } from '../src/screens/run/RunSession';
import { SessionProvider } from '../src/session/SessionProvider';
import { ThemeProvider } from '../src/theme';
import { formatPace } from '../src/format';

// S15P31E105-748: the run start map shows the whole course with the plan pace on each km.

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
const mockMapProps: any[] = [];
jest.mock('../src/components/RunMap', () => ({
  RunMap: (props: any) => {
    mockMapProps.push(props);
    return null;
  },
}));
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

function textOf(screen: Screen) {
  return screen.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string)
    .join(' ');
}

async function render(plan: Partial<CoursePlan>) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const original = repositories.courses.getTodayPlan.bind(repositories.courses);
  jest
    .spyOn(repositories.courses, 'getTodayPlan')
    .mockImplementation(async () => {
      const base = await original();
      return base ? { ...base, ...plan } : base;
    });
  // A plan with no km paces of its own means C12 has none either (S15P31E105-766 asks it separately).
  jest.spyOn(repositories.courses, 'getPacePlan').mockResolvedValue(null);
  let screen: Screen;
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
  for (let i = 0; i < 40 && !textOf(screen!).includes('오늘의 전략'); i++) {
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 25)));
  }
  return screen!;
}

const lastMap = () => mockMapProps[mockMapProps.length - 1];

beforeEach(() => {
  mockMapProps.length = 0;
});

test('the map frames the whole course and labels each km with the plan pace', async () => {
  await render({
    segmentPacesSecPerKm: [343, 348, 326],
    targetPaceSecPerKm: 340,
  });
  const map = lastMap();
  expect(map.paceLabels).toEqual([343, 348, 326].map(formatPace));
  // One mint line: no km colours.
  expect(map.segmentPaces).toBeUndefined();
  expect(map.fitTo).toBe(map.route);
  expect(map.route.length).toBeGreaterThan(1);
});

test('without km paces the map shows the line alone', async () => {
  await render({ segmentPacesSecPerKm: [] });
  expect(lastMap().paceLabels).toBeUndefined();
  await render({ segmentPacesSecPerKm: [343, Number.NaN, 326] });
  expect(lastMap().paceLabels).toBeUndefined();
});
