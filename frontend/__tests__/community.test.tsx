import React from 'react';
import { Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { Backdrop } from '../src/components';
import { createMockRepositories, DataError } from '../src/data';
import { CommunityScreen } from '../src/screens/community/CommunityScreen';
import { FeedPage } from '../src/screens/community/FeedPage';
import { PostDetailScreen } from '../src/screens/community/PostDetailScreen';
import { MyProfileTabScreen } from '../src/screens/community/ProfileScreen';
import { CourseGlyph } from '../src/screens/course/SavedCoursesScreen';
import { CrewDetailScreen } from '../src/screens/group/CrewDetailScreen';
import { GroupTabScreen } from '../src/screens/group/GroupTabScreen';
import { ThemeProvider } from '../src/theme';

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

// S15P31E105-567: H01 · CMT02 summaries carry no route (shape []); 7.1 · 7.4 · 7.4b open and the run tiles draw no made-up line.
test('runs without a route keep 7.4, 7.4b and the feed open and draw no outline', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getProfile = repositories.runners.getProfile;
  repositories.runners.getProfile = async userId => {
    const profile = await getProfile(userId);
    return {
      ...profile,
      records: profile.records.map(item => ({
        ...item,
        record: { ...item.record, shape: [] },
      })),
    };
  };
  const listFeed = repositories.community.listFeed;
  repositories.community.listFeed = async scope =>
    (await listFeed(scope)).map(post => ({
      ...post,
      courseShared: true,
      record: { ...post.record, shape: [] },
    }));
  // Every run tile gets a CourseGlyph, and with no route each draws nothing.
  const outlines = () => {
    const glyphs = screen.root.findAllByType(CourseGlyph);
    expect(glyphs.length).toBeGreaterThan(0);
    return glyphs.filter(glyph => glyph.children.length > 0).length;
  };
  const screen = await openCommunity(repositories);
  expect(texts(screen)).toContain('minjun.run');
  // 홈 → 프로필 and the 프로필 tab, entered more than once as on the Galaxy.
  for (let round = 0; round < 3; round += 1) {
    await press(screen, 'minjun.run 프로필');
    await settle(50);
    expect(outlines()).toBe(0);
    await press(screen, '뒤로');
    await press(screen, '프로필');
    await settle(50);
    expect(outlines()).toBe(0);
    await press(screen, '커뮤니티');
  }
});

// 7.1 (S15P31E105-561, 담당자 시안): one full-screen page per post, the run's numbers at the foot, the actions down
// the right, and the route drawn only for a post that shares its course.
test('7.1 shows each post as a full-screen page with its numbers, and the route only when the course is shared', async () => {
  const screen = await openCommunity();
  const pages = screen.root.findAllByType(FeedPage);
  expect(pages.length).toBeGreaterThan(1);
  const first = pages[0];
  const words = first
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');
  for (const label of ['거리', '시간', '평균 페이스', '예시 경로']) {
    expect(words).toContain(label);
  }
  for (const action of ['댓글', '공유']) {
    expect(
      first.findAll(
        node =>
          node.props.accessibilityLabel === action &&
          typeof node.props.onPress === 'function',
      ).length,
    ).toBeGreaterThan(0);
  }
  // Without the course shared, the page keeps the map but draws no route or 예시 경로.
  const hidden = pages.find(page => !page.props.post.courseShared);
  if (hidden) {
    const hiddenWords = hidden
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .join(' ');
    expect(hiddenWords).not.toContain('예시 경로');
  }
});

// 7.2 (S15P31E105-561, 담당자 레퍼런스): the map behind a white sheet with the numbers, the run, 좋아요, the 댓글
// card and 달성, and a comment bar that opens the same comments sheet as 7.1.
test('7.2 shows the run over its map, likes it and opens the comments from the card and the bar', async () => {
  const screen = await openCommunity();
  await press(screen, '검색');
  await settle(50);
  await press(screen, 'seoyun.run의 5.02km 러닝');
  await settle(50);
  const detail = screen.root.findByType(PostDetailScreen);
  const words = detail
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');
  for (const label of [
    '거리',
    '평균 페이스',
    '평균 심박',
    '케이던스',
    '민락수변공원 출발 5.0km · 완주',
    '댓글 3',
    '달성',
    '목표 완주',
  ]) {
    expect(words).toContain(label);
  }
  await press(screen, '댓글 3개 열기');
  expect(texts(screen)).toContain(
    '축하해요! 3km 구간 페이스 조절 진짜 잘했네요',
  );
  await press(screen, '댓글 닫기');
  await press(screen, '댓글 쓰기');
  expect(labelled(screen, '댓글 입력', 'onChangeText')).toBeTruthy();
});

// A feed page opens 7.2, and 7.2's map plays the course back: the distance counts up, a tap pauses and resumes,
// and it ends on the run's full distance (S15P31E105-561, 담당자 레퍼런스).
test('a feed page opens 7.2, whose map plays the course from the start with pause and replay', async () => {
  const screen = await openCommunity();
  await press(screen, 'minjun.run의 게시물 열기');
  await settle(50);
  expect(screen.root.findAllByType(PostDetailScreen)).toHaveLength(1);
  // The distance counts up beside the time; the average pace stays big (담당자 요청: 페이스가 주).
  const km = () =>
    parseFloat(
      (
        screen.root.find(
          node =>
            typeof node.props.accessibilityLabel === 'string' &&
            node.props.accessibilityLabel.startsWith('거리 ') &&
            node.props.accessibilityLabel.endsWith('km'),
        ).props.accessibilityLabel as string
      ).slice(3),
    );

  await press(screen, '코스 재생');
  // It starts at the start.
  expect(km()).toBeLessThan(0.1);
  expect(texts(screen)).toContain('탭하면 일시정지');
  expect(texts(screen)).toContain('평균 페이스 (/KM)');
  // The camera swoops in first (once the map is up, here after its limit), then the run plays; time passes in
  // steps so each stage's timers start.
  for (let step = 0; step < 18; step++) {
    await settle(500);
  }
  const halfway = km();
  expect(halfway).toBeGreaterThan(0);
  expect(halfway).toBeLessThan(5.02);

  await press(screen, '재생 일시정지');
  expect(texts(screen)).toContain('일시정지됨 · 탭하면 계속');
  const paused = km();
  for (let step = 0; step < 6; step++) {
    await settle(500);
  }
  expect(km()).toBe(paused);

  await press(screen, '재생 계속');
  for (let step = 0; step < 20; step++) {
    await settle(500);
  }
  expect(km()).toBe(5.02);
  expect(texts(screen)).toContain('탭하면 다시 재생');
  await press(screen, '코스 재생 닫기');
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

test('7.4 of a private runner shows only the name until the request is approved, and takes it back', async () => {
  const screen = await openCommunity();
  // Their posts stay out of the feed, so the profile opens from 7.5 검색.
  await press(screen, '검색');
  await settle(50);
  await type(screen, '러너·크루 검색 검색', 'jiwoo');
  await settle(400);
  await press(screen, 'jiwoo.runs 러너 프로필');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('jiwoo.runs');
  expect(page).toContain('비공개 계정이에요');
  // No counts, level or shared runs before approval (U21 제한 프로필).
  expect(page).not.toContain('120');
  expect(page).not.toContain('중급');
  expect(page).not.toContain('공유한 러닝 결과');
  await press(screen, '팔로우');
  page = texts(screen);
  expect(page).toContain('요청됨');
  expect(page).toContain('비공개 계정이에요');
  await press(screen, '요청됨');
  expect(texts(screen)).toContain('팔로우');
});

test('그룹 · 프로필 sit on the mist like 홈 and 커뮤니티 is the dark map feed, only the crew cards staying navy (S15P31E105-483·561)', async () => {
  const screen = await openCommunity();
  const onMist = (component: React.ElementType) =>
    screen.root.findByType(component).findAllByType(Backdrop).length > 0;
  // 7.1 is now full-screen pages on a dark map (S15P31E105-561, 담당자 시안), not the mist.
  expect(onMist(CommunityScreen)).toBe(false);

  await press(screen, '그룹');
  await settle(50);
  expect(onMist(GroupTabScreen)).toBe(true);
  // 6.0's navy crew cards keep the dark theme inside them, so their run lines stay white.
  expect(
    screen.root
      .findByType(GroupTabScreen)
      .findAll(
        node => node.type === ThemeProvider && node.props.tone === 'dark',
      ).length,
  ).toBeGreaterThan(0);

  await press(screen, '민락 야경 러너스 크루 상세');
  await settle(50);
  expect(onMist(CrewDetailScreen)).toBe(true);
  await press(screen, '뒤로');

  await press(screen, '프로필');
  await settle(50);
  expect(onMist(MyProfileTabScreen)).toBe(true);
});

test('7.4b answers follow requests in the sheet and the counts follow', async () => {
  const screen = await openCommunity();
  await press(screen, '프로필');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('2건');
  expect(page).toContain('86');

  await press(screen, '팔로우 요청 2건');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('승인하면 맞팔로우 없이도 내 게시물을 볼 수 있어요.');
  expect(page).toContain('dohyun_r');
  expect(page).toContain('jiwoo.runs');

  await press(screen, 'dohyun_r 승인');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('dohyun_r님을 승인했어요');
  expect(page).not.toContain('dohyun_r 승인');
  // My profile reads again behind the sheet: one more follower, one request left.
  expect(page).toContain('87');
  expect(page).toContain('1건');

  await press(screen, 'jiwoo.runs 거절');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('jiwoo.runs님의 요청을 거절했어요');
  expect(page).toContain('대기 중인 요청이 없어요.');
  expect(page).toContain('0건');
  expect(page).toContain('87');
});

test('a request answered elsewhere leaves the sheet with a note, and a failed list can be retried', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const { listFollowRequests, decideFollowRequest } = repositories.runners;
  let listFails = true;
  repositories.runners.listFollowRequests = cursor =>
    listFails
      ? Promise.reject(new DataError('NETWORK_ERROR', '응답 없음'))
      : listFollowRequests(cursor);
  repositories.runners.decideFollowRequest = (request, decision) =>
    request.nickname === 'dohyun_r'
      ? Promise.reject(new DataError('REQUEST_STATE_CONFLICT', '이미 처리됨'))
      : decideFollowRequest(request, decision);
  const screen = await openCommunity(repositories);
  await press(screen, '프로필');
  await settle(50);
  await press(screen, '팔로우 요청 2건');
  await settle(50);
  expect(texts(screen)).toContain('요청을 불러오지 못했어요');

  listFails = false;
  await press(screen, '다시 시도');
  await settle(50);
  await press(screen, 'dohyun_r 승인');
  await settle(50);
  const page = texts(screen);
  expect(page).toContain('이미 처리됐거나 취소된 요청이에요');
  expect(page).not.toContain('dohyun_r 승인');
  expect(page).toContain('jiwoo.runs');
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
