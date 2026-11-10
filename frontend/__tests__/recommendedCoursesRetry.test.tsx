import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createMockRepositories,
  DataError,
  DataProvider,
  type CourseRecommendations,
} from '../src/data';
import { ToastProvider } from '../src/components';
import { CourseSearchProvider } from '../src/screens/course';
import { RecommendedCoursesScreen } from '../src/screens/course/RecommendedCoursesScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: jest.fn(),
    navigate: jest.fn(),
  }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(20000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

test('3.1b first recommend failure shows 다시 시도 and recovers', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const ok = await repositories.courses.recommend({
    origin: {
      name: '광안리해수욕장',
      position: [129.1186, 35.1532],
    },
    targetDistanceM: 5000,
    goalInputType: 'TIME',
    targetDurationSec: 1800,
    targetPaceSecPerKm: null,
    environmentTypes: [],
  });
  let fails = true;
  repositories.courses.recommend = async () => {
    if (fails) {
      throw new DataError('NETWORK_ERROR', '연결 없음');
    }
    const found: CourseRecommendations = ok;
    return found;
  };

  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <ToastProvider>
          <CourseSearchProvider>
            <RecommendedCoursesScreen />
          </CourseSearchProvider>
        </ToastProvider>
      </DataProvider>,
    );
  });
  await settle(50);
  expect(texts(screen!)).toContain('추천 코스를 불러오지 못했어요');
  expect(() => labelled(screen!, '다시 시도')).not.toThrow();

  fails = false;
  await act(async () => {
    labelled(screen!, '다시 시도').props.onPress();
  });
  await settle(50);
  expect(texts(screen!)).not.toContain('추천 코스를 불러오지 못했어요');
  expect(texts(screen!)).toContain('이 코스로 달리기');
  await act(async () => screen!.unmount());
});
