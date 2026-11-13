import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import { createMockRepositories, DataProvider, type CoursePlan } from '../src/data';
import { CourseSearchProvider } from '../src/screens/course/CourseSearch';
import { CourseRunScreen } from '../src/screens/run/CourseRunScreen';
import { RunGoalDraftProvider } from '../src/screens/run/goal/RunGoalDraft';
import { RunSessionProvider } from '../src/screens/run/RunSession';
import { SessionProvider } from '../src/session/SessionProvider';
import { ThemeProvider } from '../src/theme';

// S15P31E105-733: 2.0 shows the plan's km paces and where the plan comes from.

jest.mock('@react-navigation/native', () => ({
  StackActions: { replace: jest.fn() },
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() }),
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

function textOf(screen: Screen) {
  return screen.root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string)
    .join(' ');
}

async function render(plan: Partial<CoursePlan>) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const original = repositories.courses.getTodayPlan.bind(repositories.courses);
  jest.spyOn(repositories.courses, 'getTodayPlan').mockImplementation(async () => {
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

test('a plan with km paces shows a pill a km and its source', async () => {
  const screen = await render({
    segmentPacesSecPerKm: [410, 400, 390],
    planSource: 'PERSONAL',
    strategy: '초반 안정 → 후반 가속',
    targetPaceSecPerKm: 400,
  });
  const text = textOf(screen);
  expect(text).toContain('1km');
  expect(text).toContain('3km');
  expect(text).toContain('6′50″');
  expect(text).toContain('내 기록으로 만든 AI 계획');
  await act(async () => screen.unmount());
});

test('an average plan says so, and a course without a plan shows no pills', async () => {
  const average = await render({ segmentPacesSecPerKm: [400], planSource: 'AVERAGE' });
  expect(textOf(average)).toContain('평균 러너 기준 AI 계획');
  await act(async () => average.unmount());
  const none = await render({
    segmentPacesSecPerKm: [],
    planSource: null,
    strategy: null,
    targetPaceSecPerKm: null,
  });
  const text = textOf(none);
  expect(text).not.toContain('1km');
  expect(text).toContain('코스 정보');
  await act(async () => none.unmount());
});
