import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';

// 7.1 지역 고르기 (S15P31E105-687): the 지역 chip opens 전국 · 시·도 · 시·군·구 and the feed is read again for the
// picked region; there is no 준비 중 toast any more.

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

let mounted: Screen | null = null;

beforeEach(() => {
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

test('7.1 picks 전국, a 시·도 or a 시·군·구 and reads the feed for it', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listFeed = jest.fn(repositories.community.listFeed);
  // 해운대구 has nothing shared yet; every other choice keeps the mock posts.
  repositories.community.listFeed = (scope, cursor, regionCode) =>
    regionCode === '26350'
      ? Promise.resolve({ items: [], nextCursor: null })
      : listFeed(scope, cursor, regionCode);
  const read = jest.spyOn(repositories.community, 'listFeed');

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
  expect(texts(screen!)).toContain('minjun.run');

  // The chip starts at 전국 and opens the sheet, not a 준비 중 toast.
  await press(screen!, '지역 전국');
  expect(texts(screen!)).toContain('지역 고르기');
  expect(texts(screen!)).not.toContain('준비 중');

  await press(screen!, '부산');
  expect(texts(screen!)).toContain('부산 전체');
  await press(screen!, '해운대구');
  expect(read).toHaveBeenLastCalledWith('ALL', null, '26350');
  expect(labelled(screen!, '지역 부산 해운대구')).toBeTruthy();
  expect(texts(screen!)).toContain(
    '부산 해운대구에서 공유된 러닝이 아직 없어요',
  );

  // The whole 시·도, then 팔로잉 keeps the region.
  await press(screen!, '지역 부산 해운대구');
  await press(screen!, '부산');
  await press(screen!, '부산 전체');
  expect(read).toHaveBeenLastCalledWith('ALL', null, '26000');
  expect(texts(screen!)).toContain('minjun.run');
  await press(screen!, '팔로잉');
  expect(read).toHaveBeenLastCalledWith('FOLLOWING', null, '26000');

  // 전국 reads every post again.
  await press(screen!, '지역 부산');
  await press(screen!, '전국');
  expect(read).toHaveBeenLastCalledWith('FOLLOWING', null, null);
  expect(labelled(screen!, '지역 전국')).toBeTruthy();
});

test('a region list that cannot be read offers to try again', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listRegions = repositories.community.listRegions;
  let fail = true;
  repositories.community.listRegions = () =>
    fail ? Promise.reject(new Error('down')) : listRegions();

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

  await press(screen!, '지역 전국');
  expect(texts(screen!)).toContain('지역 목록을 불러오지 못했어요');
  fail = false;
  await press(screen!, '다시 시도');
  expect(texts(screen!)).toContain('부산');
  expect(texts(screen!)).toContain('서울');
});
