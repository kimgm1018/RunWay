import React from 'react';
import { FlatList } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';
import { FeedPage } from '../src/screens/community/FeedPage';

// S15P31E105-699: after paging down 7.1, a new region or a new 전체 · 팔로잉 tab shows its list from the first
// post. The list is mounted again for the new choice, and is also told to go back to the top (Android can give
// the new list the old scroll offset).

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

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

const feedList = (screen: Screen) => screen.root.findByType(FlatList);

// Settles the feed on its third page, as a swipe down would.
async function pageDown(screen: Screen) {
  const list = feedList(screen);
  const height = list.props.getItemLayout(null, 0).length;
  await act(async () => {
    list.props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: 0, y: height * 2 } },
    });
  });
  await settle();
}

const activePage = (screen: Screen) =>
  screen.root
    .findAllByType(FeedPage)
    .findIndex(page => page.props.active === true);

let mounted: Screen | null = null;
let toOffset: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  toOffset.mockRestore();
  try {
    if (screen) {
      await act(async () => screen.unmount());
    }
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

async function openCommunity() {
  const repositories = createMockRepositories({ latencyMs: 0 });
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

const top = { offset: 0, animated: false };

test('a new region after paging down shows the first post of its list', async () => {
  const screen = await openCommunity();
  await pageDown(screen);
  expect(activePage(screen)).toBe(2);
  toOffset.mockClear();

  await press(screen, '지역 전국');
  await press(screen, '부산');
  await press(screen, '부산 전체');
  await settle(50);

  // Put back at the top when picked and again once the new list is in, which starts at its first post.
  expect(toOffset).toHaveBeenCalledWith(top);
  expect(toOffset.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(feedList(screen).props.contentOffset).toEqual({ x: 0, y: 0 });
  expect(activePage(screen)).toBe(0);
});

test('a new 전체 · 팔로잉 tab after paging down shows the first post of its list', async () => {
  const screen = await openCommunity();
  await pageDown(screen);
  expect(activePage(screen)).toBe(2);
  toOffset.mockClear();

  await press(screen, '팔로잉');
  await settle(50);
  expect(toOffset).toHaveBeenCalledWith(top);
  expect(activePage(screen)).toBe(0);

  await pageDown(screen);
  toOffset.mockClear();
  await press(screen, '전체');
  await settle(50);
  expect(toOffset).toHaveBeenCalledWith(top);
  expect(activePage(screen)).toBe(0);
});

test('tapping the tab or region already shown keeps the page on screen', async () => {
  const screen = await openCommunity();
  await pageDown(screen);
  toOffset.mockClear();

  await press(screen, '전체');
  await press(screen, '지역 전국');
  await press(screen, '전국');
  await settle(50);

  expect(toOffset).not.toHaveBeenCalled();
  expect(activePage(screen)).toBe(2);
});
