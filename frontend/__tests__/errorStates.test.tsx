import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  DataError,
  type Repositories,
} from '../src/data';

// S15P31E105-330: screens that used to spin on or fail quietly now say what failed and offer a retry.

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

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
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

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
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

test('2.1 과거 러닝 기록 says when the day’s runs did not load and loads again on retry', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getMonth = repositories.records.getMonth;
  const failing = jest
    .spyOn(repositories.records, 'getMonth')
    .mockRejectedValue(offline());
  const screen = await launch(repositories);
  await press(screen, '과거 러닝 기록');
  await settle();

  expect(texts(screen)).toContain('기록을 불러오지 못했어요');

  failing.mockImplementation(getMonth);
  await act(async () => retry(screen).props.onPress());
  await settle();
  await settle();
  const page = texts(screen);
  expect(page).not.toContain('기록을 불러오지 못했어요');
  // Today (10.19) has no run.
  expect(page).toContain('아직 이 날의 러닝 기록이 없어요');
});

test('2.0F says the location was not found and a tap looks again', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getCurrentPlace = repositories.run.getCurrentPlace;
  const lookup = jest
    .spyOn(repositories.run, 'getCurrentPlace')
    .mockRejectedValueOnce(offline());
  const screen = await launch(repositories);
  await press(screen, '러닝');
  await press(screen, '자유 러닝');

  expect(texts(screen)).toContain('못 찾았어요 · 다시 찾기');
  expect(texts(screen)).not.toContain('현재 위치를 찾는 중이에요');

  lookup.mockImplementation(getCurrentPlace);
  await press(screen, '현재 위치 다시 찾기');
  expect(texts(screen)).toContain('민락수변공원 입구');
});

test('6.4c says the run did not load instead of spinning on', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const get = repositories.groupRuns.get;
  const screen = await launch(repositories);
  await press(screen, '그룹');
  await press(screen, '수요일 회복 조깅, 10.28 수 06:30');
  // 6.4 loaded; 6.4c's own load fails.
  jest
    .spyOn(repositories.groupRuns, 'get')
    .mockRejectedValueOnce(offline())
    .mockImplementation(get);
  await press(screen, '그룹런 취소');

  expect(texts(screen)).toContain('그룹런 정보를 불러오지 못했어요');
  await act(async () => retry(screen).props.onPress());
  await settle();
  await settle();
  expect(texts(screen)).not.toContain('그룹런 정보를 불러오지 못했어요');
  expect(texts(screen)).toContain('수요일 회복 조깅');
});
