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
  await press(screen, '탐색');
  await settle(50);
  // It opens on 탐색: the shared runs as cards that open the post (S15P31E105-561, 담당자 시안).
  expect(texts(screen)).toContain('탐색');
  expect(has(screen, 'seoyun.run의 5.02km 러닝')).toBe(true);

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

test('7.5 shows 추천 runners while the empty field has focus and closes back to 탐색', async () => {
  const screen = await openCommunity();
  await press(screen, '탐색');
  await settle(50);
  const field = screen.root.find(
    node =>
      node.props.accessibilityLabel === '러너·크루 검색 검색' &&
      typeof node.props.onFocus === 'function',
  );
  await act(async () => field.props.onFocus());
  expect(texts(screen)).toContain('추천');
  expect(has(screen, 'seoyun.run 러너 프로필')).toBe(true);
  await press(screen, '검색어 지우기');
  expect(texts(screen)).not.toContain('추천');
  expect(has(screen, 'seoyun.run의 5.02km 러닝')).toBe(true);
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
  await press(screen, '탐색');
  await settle(50);

  // The 전체 · 러너 · 크루 chips pick what to search.
  await press(screen, '크루');
  expect(
    screen.root.find(
      node =>
        node.props.accessibilityLabel === '크루' &&
        node.props.accessibilityRole === 'tab' &&
        typeof node.props.onPress === 'function',
    ).props.accessibilityState,
  ).toMatchObject({ selected: true });

  await search(screen, '크루 이름 검색', '크루');
  expect(texts(screen)).toContain('검색 결과를 불러오지 못했어요');

  failing = false;
  await press(screen, '다시 시도');
  await settle(50);
  expect(has(screen, '광안리 새벽 크루 크루 상세')).toBe(true);
  // 크루 shows crews only.
  expect(has(screen, 'seoyun.run 러너 프로필')).toBe(false);
});

// S15P31E105-795: 탐색 is not the feed again.
type Repos = ReturnType<typeof createMockRepositories>;
type FeedPost = Awaited<
  ReturnType<Repos['community']['listFeed']>
>['items'][number];

// The mock answers on a timer, which only settle() advances.
async function sharedPost(repositories: Repos): Promise<FeedPost> {
  const read = repositories.community.listFeed('ALL');
  await settle();
  const found = (await read).items.find(
    post => post.courseShared && !post.isMine,
  );
  if (!found) throw new Error('no shared run of someone else');
  return found;
}

const variant = (
  post: FeedPost,
  id: string,
  extra: Partial<FeedPost> = {},
) => ({
  ...post,
  id,
  author: { ...post.author, userId: `u-${id}`, handle: `${id}.run` },
  ...extra,
});

async function openExplore(repositories: Repos) {
  const screen = await openCommunity(repositories);
  await press(screen, '탐색');
  await settle(50);
  return screen;
}

test('7.5 탐색 chips work before typing: 러너 shows 추천 and 크루 asks for a name', async () => {
  const screen = await openExplore(createMockRepositories({ latencyMs: 0 }));
  expect(texts(screen)).not.toContain('추천');
  await press(screen, '러너');
  expect(texts(screen)).toContain('추천');
  expect(has(screen, 'seoyun.run 러너 프로필')).toBe(true);
  await press(screen, '크루');
  expect(texts(screen)).toContain('크루 이름을 입력해 보세요');
  expect(texts(screen)).not.toContain('추천');
});

test('7.5 탐색 grid shows only shared runs of others', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const base = await sharedPost(repositories);
  repositories.community.listFeed = async () => ({
    items: [
      variant(base, 'mine', { isMine: true }),
      variant(base, 'free', { courseShared: false }),
      variant(base, 'other'),
    ],
    nextCursor: null,
  });
  const screen = await openExplore(repositories);
  expect(has(screen, 'other.run의 5.02km 러닝')).toBe(true);
  expect(has(screen, 'mine.run의 5.02km 러닝')).toBe(false);
  expect(has(screen, 'free.run의 5.02km 러닝')).toBe(false);
});

test('7.5 탐색 grid reads the feed on from the cursor at the end', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const base = await sharedPost(repositories);
  const calls: (string | undefined)[] = [];
  repositories.community.listFeed = async (_scope, cursor) => {
    calls.push(cursor ?? undefined);
    return cursor
      ? { items: [variant(base, 'later')], nextCursor: null }
      : {
          items: [1, 2, 3, 4, 5, 6].map(n => variant(base, `first${n}`)),
          nextCursor: 'p2',
        };
  };
  const screen = await openExplore(repositories);
  expect(has(screen, 'first6.run의 5.02km 러닝')).toBe(true);
  expect(has(screen, 'later.run의 5.02km 러닝')).toBe(false);
  const grid = screen.root.findAll(
    node =>
      typeof node.props.onScroll === 'function' &&
      node.props.scrollEventThrottle === 100,
  );
  await act(async () => {
    grid[grid.length - 1].props.onScroll({
      nativeEvent: {
        contentOffset: { y: 900 },
        contentSize: { height: 1000 },
        layoutMeasurement: { height: 600 },
      },
    });
  });
  await settle(50);
  expect(calls).toContain('p2');
  expect(has(screen, 'later.run의 5.02km 러닝')).toBe(true);
});

test('7.5 탐색 says so when no run shares its course', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const base = await sharedPost(repositories);
  repositories.community.listFeed = async () => ({
    items: [variant(base, 'free', { courseShared: false })],
    nextCursor: null,
  });
  const screen = await openExplore(repositories);
  expect(texts(screen)).toContain('공유된 코스가 아직 없어요');
});
