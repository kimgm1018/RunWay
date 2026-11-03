import React from 'react';
import { RefreshControl, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  DataError,
  type MonthlyRunSummary,
  type Repositories,
} from '../src/data';

// S15P31E105-361: 2.1 pulls to refresh, and one part that fails to load leaves the rest of the home on screen.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

const offline = () => new DataError('NETWORK_ERROR', '연결 없음');

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// The newest 다시 시도 button on screen.
function retry(screen: Screen) {
  const buttons = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === '다시 시도' &&
      typeof node.props.onPress === 'function',
  );
  return buttons[buttons.length - 1];
}

const refreshControl = (screen: Screen) =>
  screen.root.findByType(RefreshControl);

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

// The screen the current test opened; afterEach unmounts it even when an expectation fails.
let mounted: Screen | null = null;

async function launch(repositories: Repositories) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  mounted = screen!;
  await settle();
  await settle();
  return screen!;
}

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

test('2.1 pull to refresh loads every section again and keeps the cards on screen until it settles', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const today = jest.spyOn(repositories.home, 'getTodayCondition');
  const getMonthlySummary = repositories.home.getMonthlySummary;
  const summary = jest.spyOn(repositories.home, 'getMonthlySummary');
  const statistics = jest.spyOn(repositories.records, 'getStatistics');
  const recent = jest.spyOn(repositories.records, 'getRecent');
  const saved = jest.spyOn(repositories.courses, 'getSaved');
  const screen = await launch(repositories);
  const before = [today, summary, statistics, recent, saved].map(
    spy => spy.mock.calls.length,
  );

  // The analysis reload is held so the screen can be checked mid-refresh.
  let release = () => {};
  summary.mockImplementationOnce(
    () =>
      new Promise<MonthlyRunSummary>(resolve => {
        release = () => getMonthlySummary().then(resolve);
      }),
  );
  await act(async () => refreshControl(screen).props.onRefresh());
  await settle();

  expect(refreshControl(screen).props.refreshing).toBe(true);
  expect(texts(screen)).toContain('러닝 분석');
  expect(texts(screen)).toContain('과거 러닝 기록');

  await act(async () => release());
  await settle();
  await settle();

  expect(refreshControl(screen).props.refreshing).toBe(false);
  [today, summary, statistics, recent, saved].forEach((spy, index) =>
    expect(spy.mock.calls.length).toBeGreaterThan(before[index]),
  );
  expect(texts(screen)).toContain('러닝 분석');
});

test('2.1 keeps the home on screen when only the notifications fail', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest.spyOn(repositories.notifications, 'list').mockRejectedValue(offline());
  const screen = await launch(repositories);

  const page = texts(screen);
  expect(page).toContain('러닝 시작');
  expect(page).toContain('러닝 분석');
  expect(page).toContain('저장한 코스');
  expect(page).not.toContain('불러오지 못했어요');
});

test('2.1 says when this month did not load and loads it again on retry', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getMonthlySummary = repositories.home.getMonthlySummary;
  const failing = jest
    .spyOn(repositories.home, 'getMonthlySummary')
    .mockRejectedValue(offline());
  const screen = await launch(repositories);

  expect(texts(screen)).toContain('이번 달 기록을 불러오지 못했어요');
  expect(texts(screen)).toContain('러닝 시작');
  expect(texts(screen)).not.toContain('누적 34km');

  failing.mockImplementation(getMonthlySummary);
  await act(async () => retry(screen).props.onPress());
  await settle();
  await settle();

  expect(texts(screen)).not.toContain('이번 달 기록을 불러오지 못했어요');
  expect(texts(screen)).toContain('누적 34km · 7회');
});

test('2.1 says when today’s condition did not load, with the other sections still shown', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest
    .spyOn(repositories.home, 'getTodayCondition')
    .mockRejectedValue(offline());
  const screen = await launch(repositories);

  const page = texts(screen);
  expect(page).toContain('오늘 컨디션을 불러오지 못했어요');
  expect(page).toContain('러닝 분석');
  expect(page).toContain('과거 러닝 기록');
});
