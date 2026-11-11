import React from 'react';
import { AppState, RefreshControl, Text, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  DataError,
  type TodayCondition,
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
  const getToday = repositories.home.getTodayCondition;
  const today = jest.spyOn(repositories.home, 'getTodayCondition');
  const me = jest.spyOn(repositories.profile, 'getMe');
  const notifications = jest.spyOn(repositories.notifications, 'list');
  const watch = jest.spyOn(repositories.watch, 'getConnection');
  const screen = await launch(repositories);
  const before = [today, me, notifications, watch].map(spy => spy.mock.calls.length);

  // The readiness reload is held so the screen can be checked mid-refresh.
  let release = () => {};
  today.mockImplementationOnce(
    () =>
      new Promise<TodayCondition>(resolve => {
        release = () => getToday.apply(repositories.home).then(resolve);
      }),
  );
  await act(async () => refreshControl(screen).props.onRefresh());
  await settle();

  expect(refreshControl(screen).props.refreshing).toBe(true);
  expect(texts(screen)).toContain('최근 운동량이 평소보다 많아요.');
  expect(texts(screen)).toContain('월별 기록');

  await act(async () => release());
  await settle();
  await settle();

  expect(refreshControl(screen).props.refreshing).toBe(false);
  [today, me, notifications, watch].forEach((spy, index) =>
    expect(spy.mock.calls.length).toBeGreaterThan(before[index]),
  );
  expect(texts(screen)).toContain('최근 운동량이 평소보다 많아요.');
});

test('2.1 keeps the home on screen when only the notifications fail', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest.spyOn(repositories.notifications, 'list').mockRejectedValue(offline());
  const screen = await launch(repositories);

  const page = texts(screen);
  expect(page).toContain('최근 운동량이 평소보다 많아요.');
  expect(page).toContain('러닝 분석');
  expect(page).toContain('월별 기록');
  expect(page).not.toContain('불러오지 못했어요');
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
  expect(page).toContain('월별 기록');
});

test('2.1 refresh hides watch sync after actual readiness, and restores it when the next check fails', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const condition = await repositories.home.getTodayCondition();
  jest.spyOn(repositories.home, 'getTodayCondition').mockResolvedValue({
    ...condition,
    readinessState: 'collecting',
    readinessScore: null,
  });
  const previous = await repositories.watch.getConnection();
  const readWatch = jest.spyOn(repositories.watch, 'getConnection').mockResolvedValue({
    ...previous,
    status: 'connected',
    readinessReasons: ['NO_RESPONSE'],
    permissions: { ...previous.permissions, heartRate: 'unknown', activity: 'unknown' },
  });
  const screen = await launch(repositories);
  expect(texts(screen)).toContain('워치 동기화');

  readWatch.mockResolvedValue({
    ...previous,
    status: 'connected',
    readinessReasons: [],
    permissions: { ...previous.permissions, heartRate: 'connected', activity: 'connected' },
  });
  await act(async () => refreshControl(screen).props.onRefresh());
  await settle();
  await settle();
  expect(texts(screen)).not.toContain('워치 동기화');
  expect(texts(screen)).toContain('데이터를 모으는 중이에요');

  readWatch.mockRejectedValue(offline());
  await act(async () => refreshControl(screen).props.onRefresh());
  await settle();
  await settle();
  expect(texts(screen)).toContain('워치 동기화');
  expect(texts(screen)).not.toContain('불러오지 못했어요');
});

// S15P31E105-675: 2.1 loaded today's readiness before the phone's health records reached W06 and kept yesterday's
// result. It now reads it again after an upload stored something and on coming back to the app, without the card
// turning into a spinner or an error meanwhile.

// Today's score once the server scored the uploaded records (the mock's first one is 82).
const scored = (condition: TodayCondition): TodayCondition => ({
  ...condition,
  readinessScore: 64,
});

test('2.1 reads today’s readiness again on coming back to the app and keeps the card meanwhile and on failure', async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: AppStateStatus) => void,
  ) => {
    listeners.push(listener);
    return { remove: () => {} };
  }) as never);
  const comeBack = async () => {
    await act(async () =>
      listeners.forEach(listener => listener('background')),
    );
    await act(async () => listeners.forEach(listener => listener('active')));
  };
  try {
    const repositories = createMockRepositories({ latencyMs: 0 });
    const first = await repositories.home.getTodayCondition();
    const today = jest
      .spyOn(repositories.home, 'getTodayCondition')
      .mockResolvedValue(first);
    const screen = await launch(repositories);
    expect(texts(screen)).toContain('82 점');

    // Held so the card can be checked mid-read: yesterday's card stays, no spinner.
    let release = () => {};
    today.mockImplementationOnce(
      () =>
        new Promise<TodayCondition>(resolve => {
          release = () => resolve(scored(first));
        }),
    );
    await comeBack();
    await settle();
    expect(texts(screen)).toContain('82 점');
    await act(async () => release());
    await settle();
    expect(texts(screen)).toContain('64 점');

    // A read that fails on the way back keeps the last card instead of an error.
    today.mockRejectedValueOnce(offline());
    await comeBack();
    await settle();
    await settle();
    expect(texts(screen)).toContain('64 점');
    expect(texts(screen)).not.toContain('오늘 컨디션을 불러오지 못했어요');
  } finally {
    jest.restoreAllMocks();
  }
});
