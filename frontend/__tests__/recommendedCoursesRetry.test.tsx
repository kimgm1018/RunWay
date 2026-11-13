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

// S15P31E105-776: dragging past halfway and back no longer swaps the card's native map mid-drag.
test('3.1b keeps the live map on the settled card while a drag is in progress', async () => {
  const { RunMap } = require('../src/components/RunMap');
  const { ScrollView } = require('react-native');
  const repositories = createMockRepositories({ latencyMs: 0 });
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
  const row = screen!.root.find(
    node => node.type === ScrollView && node.props.horizontal === true,
  );
  const liveRoutes = () =>
    screen!.root.findAllByType(RunMap).map(node => node.props.route);
  const first = liveRoutes();
  expect(first).toHaveLength(1);
  const step = (row.props.snapToInterval as number) ?? 0;
  expect(step).toBeGreaterThan(0);

  const at = (x: number) => ({ nativeEvent: { contentOffset: { x } } });
  for (const x of [step * 0.7, step * 0.2, step * 0.8, step * 0.1]) {
    await act(async () => {
      row.props.onScroll?.(at(x));
    });
    // Still the same map at every frame: nothing remounts while dragging back and forth.
    expect(liveRoutes()).toEqual(first);
  }

  await act(async () => {
    row.props.onMomentumScrollEnd(at(step));
  });
  const second = liveRoutes();
  expect(second).toHaveLength(1);
  expect(second[0]).not.toBe(first[0]);
  await act(async () => screen!.unmount());
});
