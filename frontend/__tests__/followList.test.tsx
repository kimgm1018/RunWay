import React from 'react';
import { FlatList, Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, DataError } from '../src/data';
import { communityUsers } from '../src/data/mock/fixtures';
import type { FollowListPage, Repositories } from '../src/data';

// 7.4c 팔로워 · 팔로잉 (U26 · U27, S15P31E105-534) on the mock repositories.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

const matching = (screen: Screen, label: string) =>
  screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string) {
  const matches = matching(screen, label);
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

async function openApp(repositories: Repositories) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  mounted = screen!;
  await settle();
  return screen!;
}

// The newest screen's text: what 7.4c shows over the profile below it.
async function openMyList(repositories: Repositories) {
  const screen = await openApp(repositories);
  await press(screen, '프로필');
  await settle(50);
  await press(screen, '팔로워 86명 목록');
  await settle(50);
  return screen;
}

// FlatList draws only its first rows in the test renderer, so the list is read from its data.
const listed = (screen: Screen) => {
  const lists = screen.root.findAllByType(FlatList);
  const data = lists[lists.length - 1].props.data as FollowListPage['items'];
  return data.map(item => item.nickname);
};

const page = (count: number, from = 0): FollowListPage['items'] =>
  Array.from({ length: count }, (_, index) => ({
    userId: `fan-${from + index}`,
    nickname: `fan${from + index}`,
    profileImageUrl: null,
  }));

test('7.4b counts open 7.4c, its tabs switch lists, a row opens 7.4 and an unfollow shows on return', async () => {
  const screen = await openMyList(createMockRepositories({ latencyMs: 0 }));
  let shown = texts(screen);
  expect(shown).toContain('seoyun.run');
  expect(shown).toContain('sungyoon.k');

  await press(screen, '팔로잉');
  await settle(50);
  shown = texts(screen);
  expect(shown).toContain('eunseo_jog');
  expect(matching(screen, 'eunseo_jog 러너 프로필').length).toBeGreaterThan(0);

  await press(screen, 'eunseo_jog 러너 프로필');
  await settle(50);
  // eunseo_jog's 7.4: 64 followers, and I follow them.
  expect(texts(screen)).toContain('64');
  await press(screen, '팔로잉');
  await settle(50);
  expect(texts(screen)).toContain('63');

  await press(screen, '뒤로');
  await settle(50);
  // 7.4c reads again on return: eunseo_jog is no longer in my 팔로잉.
  expect(matching(screen, 'eunseo_jog 러너 프로필')).toHaveLength(0);
  expect(matching(screen, 'sungyoon.k 러너 프로필').length).toBeGreaterThan(0);
  // 7.4b reads again too: 팔로잉 drops from 102 to 101.
  await press(screen, '뒤로');
  await settle(50);
  expect(matching(screen, '팔로잉 101명 목록').length).toBeGreaterThan(0);
});

test('a closed private profile has no list to open, and 7.4c shows the lock when U26 refuses', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const screen = await openApp(repositories);
  await press(screen, '프로필');
  await settle(50);
  await press(screen, '팔로워 86명 목록');
  await settle(50);
  await press(screen, 'seoyun.run 러너 프로필');
  await settle(50);
  await press(screen, '팔로워 248명 목록');
  await settle(50);
  expect(texts(screen)).toContain('jiwoo.runs');
  await press(screen, 'jiwoo.runs 러너 프로필');
  await settle(50);
  // jiwoo.runs is private and has not approved me: counts are dashes, not buttons.
  expect(texts(screen)).toContain('비공개 계정이에요. 팔로우 요청이 승인되면');
  expect(matching(screen, '팔로워 –명 목록')).toHaveLength(0);

  repositories.runners.listFollows = () =>
    Promise.reject(new DataError('ACCOUNT_ACCESS_DENIED', '비공개 계정'));
  await press(screen, '뒤로');
  await settle(50);
  // The list it came from reads again and is refused (the account went private meanwhile).
  expect(texts(screen)).toContain('비공개 계정이에요');
  expect(texts(screen)).toContain('팔로우 요청이 승인되면 목록이 보여요.');
});

// S15P31E105-620: a row's photo, and the initial when it does not load.
test('7.4c shows a runner photo and falls back to the initial when it fails', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.runners.listFollows = async () => ({
    items: [
      {
        userId: 'fan-photo',
        nickname: 'photofan',
        profileImageUrl: 'https://k15e105.p.ssafy.io/api/v1/images/a',
      },
    ],
    nextCursor: null,
  });
  const screen = await openMyList(repositories);
  const photos = () =>
    screen.root
      .findAllByType(Image)
      .filter(
        node =>
          node.props.source?.uri ===
          'https://k15e105.p.ssafy.io/api/v1/images/a',
      );
  expect(photos()).toHaveLength(1);
  await act(async () => {
    photos()[0].props.onError?.({ nativeEvent: { error: 'not found' } });
  });
  expect(photos()).toHaveLength(0);
  expect(texts(screen)).toContain('P');
});

test('7.4c shows an empty list, retries a failed read and reads on page by page', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  let failFirst = true;
  repositories.runners.listFollows = async (_userId, kind, cursor) => {
    if (kind === 'following') {
      return { items: [], nextCursor: null };
    }
    if (failFirst) {
      failFirst = false;
      throw new DataError('NETWORK_ERROR', '응답 없음');
    }
    // The second page repeats fan19, as a relation removed and made again comes back newer.
    return cursor === null
      ? { items: page(20), nextCursor: 'next' }
      : { items: page(6, 19), nextCursor: null };
  };
  const screen = await openMyList(repositories);
  expect(texts(screen)).toContain('목록을 불러오지 못했어요');

  await press(screen, '다시 시도');
  await settle(50);
  expect(listed(screen)).toEqual(page(20).map(item => item.nickname));

  await press(screen, '더 보기');
  await settle(50);
  // 25 runners in order, fan19 once.
  expect(listed(screen)).toEqual(page(25).map(item => item.nickname));
  expect(matching(screen, '더 보기')).toHaveLength(0);

  await press(screen, '팔로잉');
  await settle(50);
  expect(texts(screen)).toContain('아직 팔로우하는 러너가 없어요');
});

// Review B-1: 더 보기 pressed while the read on return is still out must not stitch the old cursor onto the
// new first page.
test('더 보기 waits for the read on return, so no runners go missing', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const all = page(60);
  all[0] = {
    userId: communityUsers.seoyun.userId,
    nickname: communityUsers.seoyun.handle,
    profileImageUrl: null,
  };
  const held: (() => void)[] = [];
  let hold = false;
  repositories.runners.listFollows = (_userId, kind, cursor) => {
    if (kind === 'following') {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    const start = cursor ? Number(cursor) : 0;
    const result = {
      items: all.slice(start, start + 20),
      nextCursor: start + 20 < all.length ? String(start + 20) : null,
    };
    return hold
      ? new Promise(resolve => held.push(() => resolve(result)))
      : Promise.resolve(result);
  };
  const screen = await openMyList(repositories);
  await press(screen, '더 보기');
  await settle(50);
  expect(listed(screen)).toHaveLength(40);

  hold = true;
  await press(screen, 'seoyun.run 러너 프로필');
  await settle(50);
  await press(screen, '뒤로');
  await settle(50);
  await press(screen, '더 보기');
  for (const answer of [...held]) {
    await act(async () => answer());
    await settle(10);
  }
  const shown = listed(screen);
  expect(shown).toEqual(all.slice(0, shown.length).map(item => item.nickname));
});

// Re-review R-1: with two reads on return out, the older answering first must not let 더 보기 through.
test('더 보기 still waits while a newer read on return is out', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const all = page(60);
  all[0] = {
    userId: communityUsers.seoyun.userId,
    nickname: communityUsers.seoyun.handle,
    profileImageUrl: null,
  };
  const held: (() => void)[] = [];
  let hold = false;
  repositories.runners.listFollows = (_userId, kind, cursor) => {
    if (kind === 'following') {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    const start = cursor ? Number(cursor) : 0;
    const result = {
      items: all.slice(start, start + 20),
      nextCursor: start + 20 < all.length ? String(start + 20) : null,
    };
    return hold
      ? new Promise(resolve => held.push(() => resolve(result)))
      : Promise.resolve(result);
  };
  const screen = await openMyList(repositories);
  await press(screen, '더 보기');
  await settle(50);
  hold = true;
  for (let round = 0; round < 2; round += 1) {
    await press(screen, 'seoyun.run 러너 프로필');
    await settle(50);
    await press(screen, '뒤로');
    await settle(50);
  }
  // The older read answers; the newer one is still out.
  const older = held.shift()!;
  await act(async () => older());
  await settle(10);
  await press(screen, '더 보기');
  for (const answer of [...held]) {
    await act(async () => answer());
    await settle(10);
  }
  const shown = listed(screen);
  expect(shown).toEqual(all.slice(0, shown.length).map(item => item.nickname));
});

test('a refused 더 보기 closes the list, and a failed read on return keeps the list with a note', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  let next: 'ok' | 'fail' | 'deny' = 'ok';
  repositories.runners.listFollows = async (_userId, _kind, cursor) => {
    if (next === 'deny' && cursor) {
      throw new DataError('ACCOUNT_ACCESS_DENIED', '비공개 계정');
    }
    if (next === 'fail') {
      throw new DataError('NETWORK_ERROR', '응답 없음');
    }
    return cursor === null
      ? {
          items: [
            {
              userId: communityUsers.seoyun.userId,
              nickname: communityUsers.seoyun.handle,
              profileImageUrl: null,
            },
            ...page(19),
          ],
          nextCursor: 'next',
        }
      : { items: page(5, 19), nextCursor: null };
  };
  const screen = await openMyList(repositories);
  next = 'fail';
  await press(screen, 'seoyun.run 러너 프로필');
  await settle(50);
  await press(screen, '뒤로');
  await settle(50);
  expect(texts(screen)).toContain('목록을 새로 고치지 못했어요');
  expect(listed(screen)).toHaveLength(20);

  next = 'deny';
  await press(screen, '더 보기');
  await settle(50);
  expect(texts(screen)).toContain('팔로우 요청이 승인되면 목록이 보여요.');
});
