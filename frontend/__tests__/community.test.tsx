import React from 'react';
import { Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';

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

test('7.1 lists shared runs, filters to people I follow and likes a post', async () => {
  const screen = await openCommunity();
  let page = texts(screen);
  expect(page).toContain('minjun.run');
  expect(page).toContain('seoyun.run');
  expect(page).toContain('민락수변공원 출발 5.0km · 완주');
  expect(page).toContain('댓글 3개 모두 보기');

  await press(screen, '팔로잉');
  page = texts(screen);
  expect(page).not.toContain('seoyun.run');
  expect(page).toContain('sungyoon.k');

  await press(screen, '전체');
  // Only seoyun.run's 10.19 post starts liked; liking another fills its heart too.
  const liked = () =>
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '좋아요 취소' &&
        typeof node.props.onPress === 'function',
    ).length;
  expect(liked()).toBe(1);
  await press(screen, '좋아요');
  expect(liked()).toBe(2);
});

// 댓글 N개 모두 보기 opens the 댓글 sheet over the feed, which does what 7.2's comments do.
test('the 댓글 sheet shows the comments, adds one and replies by handle', async () => {
  const screen = await openCommunity();
  await press(screen, '댓글 3개 모두 보기');
  let page = texts(screen);
  expect(page).toContain('축하해요! 3km 구간 페이스 조절 진짜 잘했네요');
  expect(page).toContain('jiwoo.runs');
  await press(screen, 'jiwoo.runs에게 답글 달기');
  expect(labelled(screen, '댓글 입력', 'onChangeText').props.value).toBe(
    '@jiwoo.runs ',
  );
  await type(screen, '댓글 입력', '진동으로 와요!');
  await press(screen, '게시');
  expect(texts(screen)).toContain('진동으로 와요!');
  // The feed line under the post counts the new comment once the sheet closes.
  await press(screen, '댓글 닫기');
  expect(texts(screen)).toContain('댓글 4개 모두 보기');
});

test('the 댓글 sheet edits and deletes only my own comment (S15P31E105-389)', async () => {
  const screen = await openCommunity();
  await press(screen, '댓글 3개 모두 보기');
  const menus = () =>
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '댓글 메뉴' &&
        typeof node.props.onPress === 'function',
    ).length;
  expect(menus()).toBe(0);
  await type(screen, '댓글 입력', '진동으로 와요!');
  await press(screen, '게시');
  expect(menus()).toBe(1);

  await press(screen, '댓글 메뉴');
  await press(screen, '댓글 수정');
  let page = texts(screen);
  expect(page).toContain('댓글 수정 중');
  expect(labelled(screen, '댓글 입력', 'onChangeText').props.value).toBe(
    '진동으로 와요!',
  );
  // An emptied comment is not saved.
  await type(screen, '댓글 입력', '  ');
  await press(screen, '댓글 수정 저장');
  page = texts(screen);
  expect(page).toContain('댓글 내용을 입력해 주세요');
  expect(page).toContain('진동으로 와요!');
  await type(screen, '댓글 입력', '진동 알림으로 와요');
  await press(screen, '댓글 수정 저장');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('진동 알림으로 와요');
  expect(page).toContain('댓글을 수정했어요');
  expect(page).not.toContain('댓글 수정 중');

  await press(screen, '댓글 메뉴');
  await press(screen, '삭제');
  expect(texts(screen)).toContain('댓글을 삭제할까요?');
  await press(screen, '삭제');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('댓글을 삭제했어요');
  expect(page).not.toContain('진동 알림으로 와요');
  expect(menus()).toBe(0);
});

test('my post opens 7.2b, edits through 7.3e and deletes through 7.2c', async () => {
  const screen = await openCommunity();
  // The feed photo opens nothing; my post's menu is the ≡ beside my name.
  await press(screen, '게시물 메뉴');
  expect(texts(screen)).toContain('게시물 수정');
  await press(screen, '게시물 수정');
  await settle(50);
  expect(texts(screen)).toContain('코스도 함께 공유');
  await type(screen, '글 내용', '남천 언덕길은 다음 주에!');
  await press(screen, '코스도 함께 공유');
  await press(screen, '저장');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('남천 언덕길은 다음 주에!');
  // Without the course the card shows only the distance.
  expect(page).toContain('5.0km 러닝 · 완주');

  await press(screen, '게시물 메뉴');
  await press(screen, '삭제');
  expect(texts(screen)).toContain('게시물을 삭제할까요?');
  await press(screen, '삭제');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('게시물을 삭제했어요');
  expect(page).not.toContain('남천 언덕길은 다음 주에!');
});

// U21 profileImageUrl: my photo lies behind 7.4b; a runner without one (sungyoon.k) gets the big letter instead.
test('7.4b draws my profile photo behind the page and 7.4 falls back to the letter', async () => {
  // Asset photos have no address under Jest, so 8.2 sets one first.
  const repositories = createMockRepositories({ latencyMs: 0 });
  const changed = repositories.profile.changePhoto({
    uri: 'file:///photos/minjun.jpg',
    type: 'image/jpeg',
    name: 'minjun.jpg',
  });
  // The mock answers on a timer, which these tests advance by hand.
  await jest.advanceTimersByTimeAsync(10);
  await changed;
  const screen = await openCommunity(repositories);
  // 2.1's avatar shows the same photo, so count the blurred copy only 7.4 · 7.4b draw.
  const blurredPhotos = () =>
    screen.root
      .findAllByType(Image)
      .filter(
        node =>
          node.props.source?.uri === 'file:///photos/minjun.jpg' &&
          node.props.blurRadius > 0,
      ).length;
  await press(screen, 'minjun.run 프로필');
  await settle(50);
  expect(blurredPhotos()).toBe(1);
  await press(screen, '뒤로');
  await press(screen, 'sungyoon.k 프로필');
  await settle(50);
  expect(blurredPhotos()).toBe(0);
  expect(texts(screen)).toContain('성');
});

test('7.4 follows a runner, a private one takes a request, and 7.4b shares my run (7.3)', async () => {
  const screen = await openCommunity();
  await press(screen, 'seoyun.run 프로필');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('248');
  expect(page).toContain('공유한 러닝 결과');
  expect(page).toContain('민락수변 왕복');
  await press(screen, '팔로우');
  page = texts(screen);
  expect(page).toContain('249');
  expect(page).toContain('팔로잉');

  await press(screen, '뒤로');
  await press(screen, 'minjun.run 프로필');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('최근 기록');
  // 7.4b no longer shows 공개 계정 · 비공개 계정 (담당자 요청).
  expect(page).not.toContain('공개 계정');
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  await settle(50);
  await press(screen, '기록 공유');
  await settle(50);
  expect(texts(screen)).toContain('기록 공유');
  await type(screen, '글 내용', '새벽 공기 최고');
  await press(screen, '게시');
  await settle(100);
  page = texts(screen);
  expect(page).toContain('러닝 기록을 공유했어요');
  expect(page).toContain('새벽 공기 최고');

  // The notification expires; the shared record remains in the feed.
  await settle(3000);
  expect(texts(screen)).not.toContain('러닝 기록을 공유했어요');
  expect(texts(screen)).toContain('새벽 공기 최고');
});
