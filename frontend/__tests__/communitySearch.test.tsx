import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';
import { DataError } from '../src/data/errors';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

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

async function settle(ms = 20) {
  // Advance app time explicitly so worker/render delays cannot expire a toast.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

let mounted: Screen | null = null;

beforeEach(() => {
  // Keep React scheduling real; app timers advance only through settle().
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'],
  });
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  try {
    if (screen) {
      await act(async () => screen.unmount());
    }
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

async function openCommunity(
  repositories = createMockRepositories({ latencyMs: 0 }),
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  mounted = screen!;
  await settle();
  await press(screen!, '커뮤니티');
  await settle();
  return screen!;
}

// 7.5 searches 0.3 s after typing stops.
async function search(screen: Screen, label: string, text: string) {
  await type(screen, label, text);
  await settle(400);
}

const has = (screen: Screen, label: string) =>
  screen.root.findAll(node => node.props.accessibilityLabel === label).length >
  0;

test('7.5 opens from 7.1, finds runners and crews, and opens a runner', async () => {
  const screen = await openCommunity();
  await press(screen, '검색');
  await settle(50);
  expect(texts(screen)).toContain('러너나 크루를 찾아보세요');

  // One letter is too short and never reaches the server.
  await search(screen, '러너·크루 검색 검색', 's');
  expect(texts(screen)).toContain('검색어가 너무 짧아요');

  await search(screen, '러너·크루 검색 검색', 'seo');
  expect(texts(screen)).toContain('러너');
  expect(has(screen, 'seoyun.run 러너 프로필')).toBe(true);

  await search(screen, '러너·크루 검색 검색', '광안');
  expect(texts(screen)).toContain('크루');
  expect(has(screen, '광안리 새벽 크루 크루 상세')).toBe(true);

  await search(screen, '러너·크루 검색 검색', '없는이름');
  expect(texts(screen)).toContain('‘없는이름’ 결과가 없어요');

  await search(screen, '러너·크루 검색 검색', 'seo');
  await press(screen, 'seoyun.run 러너 프로필');
  await settle(50);
  expect(texts(screen)).toContain('248');
});

test('7.5 filters to crews from the menu and retries after a failure', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const find = repositories.search.find;
  let failing = true;
  repositories.search.find = request =>
    failing
      ? Promise.reject(new DataError('NETWORK_ERROR', '응답 없음'))
      : find(request);
  const screen = await openCommunity(repositories);
  await press(screen, '검색');
  await settle(50);

  await press(screen, '검색 대상 전체');
  await press(screen, '크루');
  expect(has(screen, '검색 대상 크루')).toBe(true);

  await search(screen, '크루 이름 검색', '크루');
  expect(texts(screen)).toContain('검색 결과를 불러오지 못했어요');

  failing = false;
  await press(screen, '다시 시도');
  await settle(50);
  expect(has(screen, '광안리 새벽 크루 크루 상세')).toBe(true);
  // 크루 shows crews only.
  expect(has(screen, 'seoyun.run 러너 프로필')).toBe(false);
});
