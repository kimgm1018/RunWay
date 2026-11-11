import React from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { Backdrop } from '../src/components';
import {
  createMockRepositories,
  DataError,
  type CommentLike,
  type Repositories,
} from '../src/data';
import { postsChanged } from '../src/data/postsChanged';
import { CommentRow } from '../src/screens/community/comments';
import { CommunityScreen } from '../src/screens/community/CommunityScreen';
import { NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';
import { darkMapLook } from '../src/components/mapRoute';
import { RunMap } from '../src/components/RunMap';
import {
  replayPlayMs,
  replaySpeedup,
} from '../src/screens/community/RouteReplay';
import { FeedPage, MapBackdrop } from '../src/screens/community/FeedPage';
import { PostDetailScreen } from '../src/screens/community/PostDetailScreen';
import { Avatar } from '../src/screens/community/parts';
import { MyProfileTabScreen } from '../src/screens/community/ProfileScreen';
import {
  CourseGlyph,
  CourseMapThumb,
} from '../src/screens/course/SavedCoursesScreen';
import { CrewDetailScreen } from '../src/screens/group/CrewDetailScreen';
import { GroupTabScreen } from '../src/screens/group/GroupTabScreen';
import { Raised } from '../src/screens/group/look';
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
  repositories.community.listFeed = async (scope, cursor) => {
    const page = await listFeed(scope, cursor);
    return {
      ...page,
      items: page.items.map(post => ({
        ...post,
        courseShared: true,
        record: { ...post.record, shape: [] },
      })),
    };
  };
  // The runs have no points to ask for either (S15P31E105-612: points that do come are drawn as the real outline,
  // where S15P31E105-562 showed a Naver map instead).
  repositories.community.getRoute = async () => null;
  const getDetail = repositories.records.getDetail;
  repositories.records.getDetail = async recordId => ({
    ...(await getDetail(recordId)),
    route: null,
  });
  // Every run tile gets its card (S15P31E105-562); with no shape and no points it draws no made-up outline.
  const outlines = () => {
    expect(screen.root.findAllByType(CourseMapThumb).length).toBeGreaterThan(0);
    return screen.root
      .findAllByType(CourseGlyph)
      .filter(glyph => glyph.children.length > 0).length;
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
  for (const label of ['거리', '시간', '평균 페이스']) {
    expect(words).toContain(label);
  }
  // The page on screen shows its shared course on the real map (S15P31E105-521), and the pages just above and
  // below draw theirs ahead (사용자 요청: 지도를 더 빨리). Pages further off wait on the map's light ground with no
  // dark drawn map or 예시 경로, so the feed holds at most three native maps.
  const mapsOf = (page: TestRenderer.ReactTestInstance) =>
    page.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === 'naver-map',
    ).length;
  expect(first.props.post.courseShared).toBe(true);
  expect(mapsOf(first)).toBe(1);
  expect(words).not.toContain('예시 경로');
  // The page below waits for the first map to be up, then draws its own.
  expect(mapsOf(pages[1])).toBe(0);
  const [firstMap] = first.findAllByType(RunMap);
  await act(async () => firstMap.props.onShown());
  await settle(50);
  if (pages[1].props.post.courseShared) {
    expect(mapsOf(pages[1])).toBe(1);
  }
  const next = pages.find(
    (page, index) => index > 1 && page.props.post.courseShared,
  );
  if (next) {
    expect(mapsOf(next)).toBe(0);
    expect(
      next.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'feed-map-loading',
      ),
    ).toHaveLength(1);
    expect(next.findAllByType(MapBackdrop)).toHaveLength(0);
    expect(
      next
        .findAllByType(Text)
        .flatMap(node => [node.props.children].flat())
        .join(' '),
    ).not.toContain('예시 경로');
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

// 사용자 요청: the map's light ground covers a new map until it says its first view is set, then fades, so the
// course does not jump into place on screen.
test('7.1 uncovers the real map once its first view is in place', async () => {
  const screen = await openCommunity();
  await settle(50);
  const [first] = screen.root.findAllByType(FeedPage);
  const covers = () =>
    first.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === 'feed-map-cover',
    );
  expect(covers()).toHaveLength(1);
  const [map] = first.findAllByType(RunMap);
  await act(async () => map.props.onShown());
  await settle(400);
  expect(covers()).toHaveLength(0);
});

// 사용자 요청 (7.2 지도를 바로): 7.2 draws the course 7.1 already read while the post itself is still on its way,
// under the light cover until the map's first view is in place.
test('7.2 draws the shared course before the post has been read', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.community.get = () => new Promise(() => undefined);
  const screen = await openCommunity(repositories);
  await settle(50);
  const [feedMap] = screen.root
    .findAllByType(FeedPage)[0]
    .findAllByType(RunMap);
  const feedRoute = feedMap.props.route;
  expect(feedRoute.length).toBeGreaterThan(1);
  await openFirstPost(screen);
  const detail = screen.root.findByType(PostDetailScreen);
  const [drawn] = detail.findAllByType(RunMap);
  expect(drawn.props.route).toEqual(feedRoute);
  expect(
    detail.findAll(
      node =>
        typeof node.type === 'string' && node.props.testID === 'post-map-cover',
    ),
  ).toHaveLength(1);
});

// 사용자 요청 (지도를 더 빨리): the page below the one on screen asks for its shared course ahead.
test('7.1 asks for the next shared course before it is swiped to', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listFeed = repositories.community.listFeed;
  repositories.community.listFeed = async (scope, cursor) => {
    const page = await listFeed(scope, cursor);
    return {
      ...page,
      items: page.items.map(post => ({
        ...post,
        courseShared: true,
        record: { ...post.record, route: null },
      })),
    };
  };
  const asked: string[] = [];
  const getRoute = repositories.community.getRoute;
  repositories.community.getRoute = async postId => {
    asked.push(postId);
    return getRoute(postId);
  };
  const screen = await openCommunity(repositories);
  await settle(50);
  const pages = screen.root.findAllByType(FeedPage);
  expect(pages.length).toBeGreaterThan(1);
  expect(asked).toContain(pages[0].props.post.id);
  expect(asked).toContain(pages[1].props.post.id);
});

// 사용자 요청: a shared course whose points cannot be read leaves the light ground for the drawn map with 예시 경로.
test('7.1 falls back to the drawn map when the shared course cannot be read', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listFeed = repositories.community.listFeed;
  repositories.community.listFeed = async (scope, cursor) => {
    const page = await listFeed(scope, cursor);
    return {
      ...page,
      items: page.items.map(post => ({
        ...post,
        record: { ...post.record, route: null },
      })),
    };
  };
  repositories.community.getRoute = async () => null;
  const screen = await openCommunity(repositories);
  await settle(50);
  const [first] = screen.root.findAllByType(FeedPage);
  expect(first.props.post.courseShared).toBe(true);
  expect(
    first.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.testID === 'feed-map-loading',
    ),
  ).toHaveLength(0);
  expect(first.findAllByType(MapBackdrop)).toHaveLength(1);
  expect(
    first
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .join(' '),
  ).toContain('예시 경로');
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

// S15P31E105-619: the sheet's foot keeps room for the whole comment bar, which grows by the phone's bottom bar
// (115 over a 48 three-button bar), so the 댓글 card scrolls clear of it.
test('7.2 keeps the end of the sheet clear of a comment bar that grew', async () => {
  const screen = await openCommunity();
  await press(screen, '검색');
  await settle(50);
  await press(screen, 'seoyun.run의 5.02km 러닝');
  await settle(50);
  const detail = screen.root.findByType(PostDetailScreen);
  const bar = detail.findAll(
    node => typeof node.props.onLayout === 'function' && node.type === View,
  );
  const commentBar = bar[bar.length - 1];
  await act(async () => {
    commentBar.props.onLayout({ nativeEvent: { layout: { height: 115 } } });
  });
  const sheet = detail.findAll(
    node =>
      node.type === View &&
      StyleSheet.flatten(node.props.style)?.borderTopLeftRadius === 28,
  )[0];
  expect(
    StyleSheet.flatten(sheet.props.style).paddingBottom,
  ).toBeGreaterThanOrEqual(115 + 16);
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
  // The replay says how sped up it is (S15P31E105-672).
  expect(texts(screen)).toMatch(/×\d+ 배속/);
  // Only the part already run is drawn (S15P31E105-672 review): every replay line is see-through past the
  // runner, shares the same progress and has its own layer; the grey outline shows over the opening overview.
  const replayLines = () =>
    screen.root.findAll(
      node =>
        node.type === NaverMapPathOverlay &&
        node.props.passedColor !== undefined,
    );
  const outlines = () =>
    screen.root.findAll(
      node =>
        node.type === NaverMapPathOverlay &&
        node.props.color === darkMapLook.outline,
    );
  expect(replayLines()).toHaveLength(3);
  for (const line of replayLines()) {
    expect(line.props.color).toBe('rgba(0,0,0,0)');
    expect(line.props.progress).toBe(0);
    expect(typeof line.props.zIndex).toBe('number');
  }
  expect(outlines()).toHaveLength(1);
  expect(outlines()[0].props.zIndex).toBeLessThan(
    Math.min(...replayLines().map(line => line.props.zIndex)),
  );
  // The camera swoops in first (once the map is up, here after its limit), then the run plays; time passes in
  // steps so each stage's timers start.
  for (let step = 0; step < 18; step++) {
    await settle(500);
  }
  const halfway = km();
  expect(halfway).toBeGreaterThan(0);
  expect(halfway).toBeLessThan(5.02);
  // The lines grow with the runner, all together, and the outline is gone once the camera swoops in.
  const grown = replayLines().map(line => line.props.progress);
  expect(grown[0]).toBeGreaterThan(0);
  expect(grown[0]).toBeLessThan(1);
  expect(new Set(grown).size).toBe(1);
  expect(outlines()).toHaveLength(0);

  await press(screen, '재생 일시정지');
  expect(texts(screen)).toContain('일시정지됨 · 탭하면 계속');
  const paused = km();
  for (let step = 0; step < 6; step++) {
    await settle(500);
  }
  expect(km()).toBe(paused);

  await press(screen, '재생 계속');
  // A 5.02 km run plays in about 11 s (replayPlayMs), so this runs past its end and into the outro.
  for (let step = 0; step < 26; step++) {
    await settle(500);
  }
  expect(km()).toBe(5.02);
  expect(texts(screen)).toContain('탭하면 다시 재생');
  expect(replayLines().every(line => line.props.progress === 1)).toBe(true);
  await press(screen, '코스 재생 닫기');
});

// The replay's length follows the run's distance, kept between 8 s and 15 s, and its speed-up is shown honestly.
test('a replay plays longer for a longer run, within 8 to 15 seconds', () => {
  expect(replayPlayMs(0)).toBe(8000);
  expect(replayPlayMs(1500)).toBe(8000);
  expect(replayPlayMs(5020)).toBe(11020);
  expect(replayPlayMs(42195)).toBe(15000);
  expect(replayPlayMs(Number.NaN)).toBe(8000);
  expect(replayPlayMs(3000)).toBeLessThan(replayPlayMs(7000));
  // 30 minutes in 11.02 s is about 163 times as fast.
  expect(replaySpeedup(1800, 11020)).toBe(163);
  expect(replaySpeedup(0, 11020)).toBeNull();
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

// S15P31E105-633: the rows the 댓글 sheet shows, as [text, indented].
const rows = (screen: Screen) =>
  screen.root
    .findAllByType(CommentRow)
    .map(row => [
      row.props.comment.deleted ? '삭제된 댓글' : row.props.comment.body,
      Boolean(row.props.reply),
    ]);

const rowOf = (screen: Screen, body: string) => {
  const row = screen.root
    .findAllByType(CommentRow)
    .find(item => item.props.comment.body === body);
  if (!row) {
    throw new Error(`No comment ${body}`);
  }
  return row;
};

// A button inside the comment row with this text.
const rowButton = (screen: Screen, body: string, label: string) =>
  rowOf(screen, body).find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

async function pressIn(screen: Screen, body: string, label: string) {
  await act(async () => {
    rowButton(screen, body, label).props.onPress();
  });
  await settle();
  await settle();
}

const commentInput = (screen: Screen) =>
  labelled(screen, '댓글 입력', 'onChangeText').props.value;

test('a reply goes under its root, a reply to a reply answers the root, and 취소 makes a plain comment', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const addComment = jest.spyOn(repositories.community, 'addComment');
  const screen = await openCommunity(repositories);
  await press(screen, '댓글 3개 모두 보기');
  const first = '축하해요! 3km 구간 페이스 조절 진짜 잘했네요';
  const firstHandle = rowOf(screen, first).props.comment.author.handle;

  // 답글 달기 on the first root: the bar names whom I answer and the field starts with the handle.
  await pressIn(screen, first, `${firstHandle}에게 답글 달기`);
  expect(texts(screen)).toContain(`${firstHandle}님에게 답글 남기는 중`);
  expect(commentInput(screen)).toBe(`@${firstHandle} `);
  await type(screen, '댓글 입력', `@${firstHandle} 고마워요`);
  await press(screen, '게시');
  expect(addComment).toHaveBeenLastCalledWith(
    'post-seoyun-1019',
    `@${firstHandle} 고마워요`,
    'comment-1',
  );
  // The reply comes at the end of its root's group, indented, and the bar is gone.
  expect(rows(screen)).toEqual([
    [first, false],
    [`@${firstHandle} 고마워요`, true],
    ['저도 다음 주에 이 코스 도전해볼게요', false],
    ['코칭 알림 진동으로 오나요?', false],
  ]);
  expect(texts(screen)).not.toContain('님에게 답글 남기는 중');

  // Answering that reply goes under the same root, naming the reply's author.
  const myHandle = rowOf(screen, `@${firstHandle} 고마워요`).props.comment
    .author.handle;
  await pressIn(
    screen,
    `@${firstHandle} 고마워요`,
    `${myHandle}에게 답글 달기`,
  );
  expect(texts(screen)).toContain(`${myHandle}님에게 답글 남기는 중`);
  expect(commentInput(screen)).toBe(`@${myHandle} `);
  await type(screen, '댓글 입력', `@${myHandle} 네!`);
  await press(screen, '게시');
  expect(addComment).toHaveBeenLastCalledWith(
    'post-seoyun-1019',
    `@${myHandle} 네!`,
    'comment-1',
  );
  expect(rows(screen).slice(0, 3)).toEqual([
    [first, false],
    [`@${firstHandle} 고마워요`, true],
    [`@${myHandle} 네!`, true],
  ]);

  // 취소 drops the handle and the next 게시 is a plain comment.
  await pressIn(
    screen,
    '코칭 알림 진동으로 오나요?',
    'jiwoo.runs에게 답글 달기',
  );
  await press(screen, '답글 취소');
  expect(texts(screen)).not.toContain('님에게 답글 남기는 중');
  expect(commentInput(screen)).toBe('');
  await type(screen, '댓글 입력', '모두 화이팅');
  await press(screen, '게시');
  expect(addComment).toHaveBeenLastCalledWith(
    'post-seoyun-1019',
    '모두 화이팅',
    null,
  );
  expect(rows(screen)[rows(screen).length - 1]).toEqual(['모두 화이팅', false]);

  await press(screen, '댓글 닫기');
  expect(texts(screen)).toContain('댓글 6개 모두 보기');
});

test('deleting my comment with replies leaves 삭제된 댓글입니다, which is not counted and has no buttons', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const screen = await openCommunity(repositories);
  await press(screen, '댓글 3개 모두 보기');
  await type(screen, '댓글 입력', '원댓글');
  await press(screen, '게시');
  const myHandle = rowOf(screen, '원댓글').props.comment.author.handle;
  await pressIn(screen, '원댓글', `${myHandle}에게 답글 달기`);
  await type(screen, '댓글 입력', '대댓글');
  await press(screen, '게시');

  await pressIn(screen, '원댓글', '댓글 메뉴');
  await press(screen, '삭제');
  await press(screen, '삭제');
  await settle(50);
  expect(rows(screen).slice(-2)).toEqual([
    ['삭제된 댓글', false],
    ['대댓글', true],
  ]);
  expect(texts(screen)).toContain('삭제된 댓글입니다');
  const place = screen.root
    .findAllByType(CommentRow)
    .find(row => row.props.comment.deleted)!;
  // No menu, 좋아요 or 답글 달기 on it.
  expect(
    place.findAll(node => typeof node.props.onPress === 'function'),
  ).toHaveLength(0);
  // Its thread takes no new replies: the reply under it has no 답글 달기 (CMT07 INVALID_PARENT_COMMENT).
  expect(() =>
    rowButton(screen, '대댓글', `${myHandle}에게 답글 달기`),
  ).toThrow();
  expect(
    rowOf(screen, '대댓글').findAll(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.endsWith('답글 달기'),
    ),
  ).toHaveLength(0);
  expect(() => rowButton(screen, '대댓글', '댓글 메뉴')).not.toThrow();
  await press(screen, '댓글 닫기');
  // 3 + the reply: the deleted root is not counted, and the mock keeps it as CMT06 would.
  expect(texts(screen)).toContain('댓글 4개 모두 보기');
  // The mock answers on app time, which only settle() moves.
  const read = repositories.community.get('post-seoyun-1019');
  await settle();
  expect((await read).comments.map(item => item.deleted)).toEqual([
    false,
    false,
    false,
    true,
    false,
  ]);

  // The reply going takes the deleted root with it.
  await press(screen, '댓글 4개 모두 보기');
  await settle(50);
  await pressIn(screen, '대댓글', '댓글 메뉴');
  await press(screen, '삭제');
  await press(screen, '삭제');
  await settle(50);
  expect(texts(screen)).not.toContain('삭제된 댓글입니다');
  expect(rows(screen)).toHaveLength(3);
  await press(screen, '댓글 닫기');
  expect(texts(screen)).toContain('댓글 3개 모두 보기');
});

test('a reply whose root was deleted meanwhile says so, turns back into a plain comment and reloads', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const addComment = jest
    .spyOn(repositories.community, 'addComment')
    .mockRejectedValueOnce(
      new DataError('INVALID_PARENT_COMMENT', '원댓글 삭제됨', null, 422),
    );
  const get = jest.spyOn(repositories.community, 'get');
  const screen = await openCommunity(repositories);
  await press(screen, '댓글 3개 모두 보기');
  const first = '축하해요! 3km 구간 페이스 조절 진짜 잘했네요';
  const firstHandle = rowOf(screen, first).props.comment.author.handle;
  await pressIn(screen, first, `${firstHandle}에게 답글 달기`);
  await type(screen, '댓글 입력', `@${firstHandle} 고마워요`);
  const reads = get.mock.calls.length;

  await press(screen, '게시');
  expect(addComment).toHaveBeenLastCalledWith(
    'post-seoyun-1019',
    `@${firstHandle} 고마워요`,
    'comment-1',
  );
  await settle(50);
  const page = texts(screen);
  expect(page).toContain('원댓글이 삭제돼 답글을 달 수 없어요');
  expect(page).not.toContain('잠시 후 다시 시도해 주세요');
  // Back to a plain comment with the text kept, and the comments read again.
  expect(page).not.toContain('님에게 답글 남기는 중');
  expect(commentInput(screen)).toBe(`@${firstHandle} 고마워요`);
  expect(get.mock.calls.length).toBe(reads + 1);
  expect(rows(screen)).toHaveLength(3);

  // The next 게시 is a plain comment and goes through.
  await press(screen, '게시');
  expect(addComment).toHaveBeenLastCalledWith(
    'post-seoyun-1019',
    `@${firstHandle} 고마워요`,
    null,
  );
  expect(rows(screen)[rows(screen).length - 1]).toEqual([
    `@${firstHandle} 고마워요`,
    false,
  ]);
});

test('a comment like shows at once, takes the server count, and goes back when it fails', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  let answer: (value: CommentLike) => void = () => undefined;
  const setCommentLiked = jest
    .spyOn(repositories.community, 'setCommentLiked')
    .mockImplementationOnce(
      () =>
        new Promise<CommentLike>(resolve => {
          answer = resolve;
        }),
    )
    .mockRejectedValueOnce(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
  const screen = await openCommunity(repositories);
  await press(screen, '댓글 3개 모두 보기');
  const body = '축하해요! 3km 구간 페이스 조절 진짜 잘했네요';
  const comment = () => rowOf(screen, body).props.comment;
  expect(comment()).toMatchObject({ liked: false, likeCount: 4 });

  // At once, before the server answers.
  await pressIn(screen, body, '댓글 좋아요');
  expect(setCommentLiked).toHaveBeenLastCalledWith('comment-1', true);
  expect(comment()).toMatchObject({ liked: true, likeCount: 5 });
  expect(texts(screen)).toContain('좋아요 5개');
  expect(() => rowButton(screen, body, '댓글 좋아요 취소')).not.toThrow();
  // The server's count wins once it answers.
  await act(async () => answer({ likeCount: 9, liked: true }));
  await settle();
  expect(comment()).toMatchObject({ liked: true, likeCount: 9 });

  // A failed unlike goes back.
  await pressIn(screen, body, '댓글 좋아요 취소');
  expect(setCommentLiked).toHaveBeenLastCalledWith('comment-1', false);
  expect(comment()).toMatchObject({ liked: true, likeCount: 9 });
  expect(texts(screen)).toContain('좋아요 9개');
});

test('a comment unlike never counts below 0', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const get = repositories.community.get;
  // A like made elsewhere between the count and my reaction can read as 0 and liked.
  jest.spyOn(repositories.community, 'get').mockImplementation(async id => {
    const detail = await get(id);
    return {
      ...detail,
      comments: detail.comments.map(item => ({
        ...item,
        liked: true,
        likeCount: 0,
      })),
    };
  });
  let answer: (value: CommentLike) => void = () => undefined;
  jest.spyOn(repositories.community, 'setCommentLiked').mockImplementation(
    () =>
      new Promise<CommentLike>(resolve => {
        answer = resolve;
      }),
  );
  const screen = await openCommunity(repositories);
  await press(screen, '댓글 3개 모두 보기');
  const body = '저도 다음 주에 이 코스 도전해볼게요';
  await pressIn(screen, body, '댓글 좋아요 취소');
  expect(rowOf(screen, body).props.comment).toMatchObject({
    liked: false,
    likeCount: 0,
  });
  // Without a count from the server, the one on screen stays.
  await act(async () => answer({ likeCount: null, liked: false }));
  await settle();
  expect(rowOf(screen, body).props.comment.likeCount).toBe(0);
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

// S15P31E105-620: a photo that does not load leaves the gradient and the letter, as without one.
test('7.4b falls back to the letter when my profile photo fails to load', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const changed = repositories.profile.changePhoto({
    uri: 'file:///photos/broken.jpg',
    type: 'image/jpeg',
    name: 'broken.jpg',
  });
  await jest.advanceTimersByTimeAsync(10);
  await changed;
  const screen = await openCommunity(repositories);
  await press(screen, 'minjun.run 프로필');
  await settle(50);
  // 7.4b's backdrop: the sharp photo and its blurred copy (2.1's avatar has no blur and sits elsewhere).
  const backdrop = () =>
    screen.root
      .findAllByType(Image)
      .filter(
        node =>
          node.props.source?.uri === 'file:///photos/broken.jpg' &&
          node.props.resizeMode === 'cover',
      );
  expect(backdrop()).toHaveLength(2);
  await act(async () => {
    backdrop()[0].props.onError?.({ nativeEvent: { error: 'not found' } });
  });
  expect(backdrop()).toHaveLength(0);
  expect(texts(screen)).toContain('m');
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

test('프로필 sits on the mist like 홈, 커뮤니티 is the dark map feed and 그룹 the home navy (S15P31E105-483·561·594)', async () => {
  const screen = await openCommunity();
  const onMist = (component: React.ElementType) =>
    screen.root.findByType(component).findAllByType(Backdrop).length > 0;
  // 7.1 is now full-screen pages on a dark map (S15P31E105-561, 담당자 시안), not the mist.
  expect(onMist(CommunityScreen)).toBe(false);

  await press(screen, '그룹');
  await settle(50);
  // 6.0 · 6.1 are on the home card's navy (S15P31E105-594 담당자 결정), in the dark theme, with faint white cards.
  expect(onMist(GroupTabScreen)).toBe(false);
  const group = screen.root.findByType(GroupTabScreen);
  expect(
    group.findAll(
      node => node.type === ThemeProvider && node.props.tone === 'dark',
    ).length,
  ).toBeGreaterThan(0);
  expect(
    group.findAll(node => node.type === Raised && node.props.tone === 'night')
      .length,
  ).toBeGreaterThan(1);

  await press(screen, '민락 야경 러너스 크루 상세');
  await settle(50);
  // 6.2 is the 시안's cards on the home's navy (S15P31E105-594), not the mist.
  expect(onMist(CrewDetailScreen)).toBe(false);
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
  expect(page).toContain('아직 대기 중인 요청이 없어요');
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

// S15P31E105-612: a shared run's tile asks its post for the course with its map image and shows it with
// © OpenStreetMap and no outline over it; no tile holds a Naver map.
test('7.4 run tiles show a shared course on its map image', async () => {
  // The mock's bundled image has no address under Jest, so the shared courses get a server one.
  const repositories = createMockRepositories({ latencyMs: 0 });
  const getRoute = repositories.community.getRoute;
  repositories.community.getRoute = async postId => {
    const map = await getRoute(postId);
    return map
      ? {
          ...map,
          basemap: {
            imageUrl: 'https://k15e105.p.ssafy.io/api/v1/courses/1/basemap.png',
            osmDataTimestamp: null,
          },
        }
      : null;
  };
  const screen = await openCommunity(repositories);
  await press(screen, 'seoyun.run 프로필');
  await settle(50);
  const tiles = screen.root
    .findAllByType(CourseMapThumb)
    .filter(tile => typeof tile.props.load === 'function');
  expect(tiles.length).toBeGreaterThan(0);
  // The mock answers on a timer, which only settle() moves on.
  const pending = tiles[0].props.load();
  await settle(50);
  const answer = await pending;
  expect(answer?.route.length).toBeGreaterThan(1);
  expect(answer?.basemap?.imageUrl).toBe(
    'https://k15e105.p.ssafy.io/api/v1/courses/1/basemap.png',
  );
  for (const tile of tiles) {
    const [thumb] = tile.findAll(
      node =>
        node.props.testID === 'course-thumb' &&
        typeof node.props.onLayout === 'function',
    );
    await act(async () =>
      thumb.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 170, height: 200 } },
      }),
    );
  }
  await settle(50);
  const drawn = tiles.filter(
    tile =>
      tile.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'course-basemap',
      ).length > 0,
  );
  expect(drawn.length).toBeGreaterThan(0);
  for (const tile of drawn) {
    // The outline keeps the course on the tile until its image has loaded, then gives way.
    expect(tile.findAllByType(CourseGlyph)).toHaveLength(1);
    const [image] = tile.findAll(
      node =>
        typeof node.type !== 'string' &&
        node.props.testID === 'course-basemap' &&
        typeof node.props.onLoad === 'function',
    );
    await act(async () => image.props.onLoad({ nativeEvent: {} }));
    expect(tile.findAllByType(CourseGlyph)).toHaveLength(0);
    expect(
      tile.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'course-basemap-attribution',
      ),
    ).toHaveLength(1);
  }
  for (const tile of tiles) {
    expect(
      tile.findAll(node => node.props.testID === 'naver-map'),
    ).toHaveLength(0);
  }
});

test('7.4 follows a runner, a private one takes a request, and 7.4b opens my run on 러닝 분석', async () => {
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
  // My run opens on 2.1 러닝 분석 on its day (S15P31E105-594: 기록 상세 and its 기록 공유 are gone).
  await press(screen, '민락수변공원 출발, 10.15 목 · 29:41, 5.02km');
  for (let tries = 0; tries < 40; tries++) {
    if (texts(screen).includes('2026.10.15 · 06:30')) {
      break;
    }
    await settle(50);
  }
  expect(texts(screen)).toContain('2026.10.15 · 06:30');
  expect(texts(screen)).toContain('페이스와 심박 변화');
});

// S15P31E105-632: a runner's photo fills the avatar; a missing one or one that fails leaves the letter.
test('Avatar shows the photo and falls back to the letter', async () => {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <ThemeProvider>
        <Avatar nickname="서윤" userId="9" photo="https://img.test/9.jpg" />
        <Avatar nickname="하은" userId="10" photo={null} />
      </ThemeProvider>,
    );
  });
  const rendered = screen!;
  mounted = rendered;
  const photos = () => rendered.root.findAllByType(Image);
  expect(photos()).toHaveLength(1);
  expect(photos()[0].props.source).toEqual({ uri: 'https://img.test/9.jpg' });
  expect(texts(rendered)).toBe('하');

  await act(async () => {
    photos()[0].props.onError?.({ nativeEvent: { error: 'not found' } });
  });
  expect(photos()).toHaveLength(0);
  expect(texts(rendered)).toContain('서');
});

// 7.4b → 2.1 기록 상세 → 7.3 기록 공유 with my 10.15 run.
async function openShare(repositories: Repositories) {
  const screen = await openCommunity(repositories);
  // 기록 상세 and its 기록 공유 are gone (S15P31E105-594 담당자 결정), so 7.3 opens the way 4.5's 기록 공유 opens it:
  // with the run's record.
  // The mock answers on fake timers, so time is moved on while it reads.
  const recent = repositories.records.getRecent('recent', 1);
  await settle(50);
  const [record] = await recent;
  const navigation = screen.root.findByType(CommunityScreen).props.navigation;
  await act(async () =>
    navigation.navigate('PostWrite', { recordId: record.id }),
  );
  await settle(50);
  return screen;
}

function withRun(courseRun: boolean) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const { getShareable, create } = repositories.community;
  repositories.community.getShareable = async recordId => ({
    ...(await getShareable(recordId)),
    courseRun,
  });
  const created = jest.fn(create);
  repositories.community.create = created;
  return { repositories, created };
}

const courseSwitch = (screen: Screen) =>
  screen.root.findAll(
    node =>
      node.props.accessibilityRole === 'switch' &&
      node.props.accessibilityLabel === '코스도 함께 공유' &&
      typeof node.props.onPress === 'function',
  )[0];

test('7.3 sends 코스도 함께 공유 as I set it on a course run', async () => {
  const { repositories, created } = withRun(true);
  const screen = await openShare(repositories);
  expect(courseSwitch(screen).props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });

  await act(async () => courseSwitch(screen).props.onPress());
  await press(screen, '게시');
  await settle(100);

  expect(created).toHaveBeenCalledWith(expect.any(String), {
    body: null,
    courseShared: false,
    regionCode: null,
  });
});

test('7.3 keeps 코스도 함께 공유 off and disabled on a free run', async () => {
  const { repositories, created } = withRun(false);
  const screen = await openShare(repositories);

  expect(courseSwitch(screen).props.accessibilityState).toEqual({
    checked: false,
    disabled: true,
  });
  expect(courseSwitch(screen).props.disabled).toBe(true);
  expect(texts(screen)).toContain('자유 러닝 경로 공유는 준비 중이에요');

  await press(screen, '게시');
  await settle(100);
  expect(created).toHaveBeenCalledWith(expect.any(String), {
    body: null,
    courseShared: false,
    regionCode: null,
  });
});

// S15P31E105-687 사용자 결정 1번: only a shared course gets a region, from its start, shown on 7.3 before 게시.
function withCourseStart() {
  const { repositories, created } = withRun(true);
  const { getShareable } = repositories.community;
  repositories.community.getShareable = async recordId => ({
    ...(await getShareable(recordId)),
    courseRun: true,
    route: [
      [129.118, 35.153],
      [129.12, 35.155],
    ],
  });
  const regionAt = jest.fn(repositories.community.regionAt);
  repositories.community.regionAt = regionAt;
  return { repositories, created, regionAt };
}

test('7.3 shows 지역 for a shared course and sends it with the post', async () => {
  const { repositories, created, regionAt } = withCourseStart();
  const screen = await openShare(repositories);
  await settle(50);

  expect(regionAt).toHaveBeenCalledWith([129.118, 35.153]);
  expect(texts(screen)).toContain('지역: 부산 수영구');

  await press(screen, '게시');
  await settle(100);
  expect(created).toHaveBeenCalledWith(expect.any(String), {
    body: null,
    courseShared: true,
    regionCode: '26500',
  });
});

test('7.3 hides 지역 and sends none once the course is not shared', async () => {
  const { repositories, created } = withCourseStart();
  const screen = await openShare(repositories);
  await settle(50);
  expect(texts(screen)).toContain('지역: 부산 수영구');

  await act(async () => courseSwitch(screen).props.onPress());
  await settle(50);
  expect(texts(screen)).not.toContain('지역:');

  await press(screen, '게시');
  await settle(100);
  expect(created).toHaveBeenCalledWith(expect.any(String), {
    body: null,
    courseShared: false,
    regionCode: null,
  });
});

test('7.3 asks no region for a free run and shows none when none is found', async () => {
  const free = withRun(false);
  const freeRegionAt = jest.fn(free.repositories.community.regionAt);
  free.repositories.community.regionAt = freeRegionAt;
  let screen = await openShare(free.repositories);
  await settle(50);
  expect(freeRegionAt).not.toHaveBeenCalled();
  expect(texts(screen)).not.toContain('지역:');
  await act(async () => screen.unmount());
  mounted = null;

  const { repositories, created } = withCourseStart();
  repositories.community.regionAt = async () => null;
  screen = await openShare(repositories);
  await settle(50);
  expect(texts(screen)).not.toContain('지역:');
  await press(screen, '게시');
  await settle(100);
  expect(created).toHaveBeenCalledWith(expect.any(String), {
    body: null,
    courseShared: true,
    regionCode: null,
  });
});

// S15P31E105-647: 7.1 reads 20 posts a page and the next near the end, until the last page.
function pagedFeed(total: number) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listFeed = repositories.community.listFeed;
  const asked: { scope: string; cursor: string | null }[] = [];
  repositories.community.listFeed = async (scope, cursor) => {
    asked.push({ scope, cursor: cursor ?? null });
    const [template] = (await listFeed('ALL')).items;
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 20, total);
    return {
      items: Array.from({ length: end - start }, (_, offset) => ({
        ...template,
        id: `${scope}-${start + offset}`,
      })),
      nextCursor: end < total ? String(end) : null,
    };
  };
  return { repositories, asked };
}

const feedList = (screen: Screen) => {
  const [list] = screen.root
    .findAllByType(CommunityScreen)[0]
    .findAll(
      node =>
        node.type === FlatList && typeof node.props.onEndReached === 'function',
    );
  return list;
};

async function reachEnd(screen: Screen) {
  await act(async () => {
    feedList(screen).props.onEndReached({ distanceFromEnd: 0 });
  });
  await settle();
}

test('7.1 reads the next 20 near the end, stops after the last page, and a new scope starts again', async () => {
  const { repositories, asked } = pagedFeed(45);
  const screen = await openCommunity(repositories);
  expect(feedList(screen).props.data).toHaveLength(20);

  await reachEnd(screen);
  expect(feedList(screen).props.data).toHaveLength(40);
  await reachEnd(screen);
  expect(feedList(screen).props.data).toHaveLength(45);
  // The last page is in: reaching the end asks nothing more.
  await reachEnd(screen);
  expect(asked).toEqual([
    { scope: 'ALL', cursor: null },
    { scope: 'ALL', cursor: '20' },
    { scope: 'ALL', cursor: '40' },
  ]);
  expect(
    feedList(screen).props.data.map((post: { id: string }) => post.id),
  ).toEqual(Array.from({ length: 45 }, (_, index) => `ALL-${index}`));

  await press(screen, '팔로잉');
  expect(asked[asked.length - 1]).toEqual({ scope: 'FOLLOWING', cursor: null });
  expect(feedList(screen).props.data).toHaveLength(20);
  expect(feedList(screen).props.data[0].id).toBe('FOLLOWING-0');
});

// The first feed page opens its 7.2.
async function openFirstPost(screen: Screen) {
  await act(async () => {
    screen.root
      .findAllByType(FeedPage)[0]
      .findAll(
        node =>
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel.endsWith('의 게시물 열기') &&
          typeof node.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  await settle(50);
  expect(screen.root.findAllByType(PostDetailScreen)).toHaveLength(1);
}

test('7.1 coming back from 7.2 or another tab keeps the posts read so far without reading again', async () => {
  const { repositories, asked } = pagedFeed(45);
  // The paged posts open as the mock's first post under their own id.
  const original = createMockRepositories({ latencyMs: 0 }).community;
  repositories.community.get = async postId => {
    const [template] = (await original.listFeed('ALL')).items;
    return { ...(await original.get(template.id)), id: postId };
  };
  const screen = await openCommunity(repositories);
  await reachEnd(screen);
  expect(feedList(screen).props.data).toHaveLength(40);

  await openFirstPost(screen);
  await press(screen, '뒤로');
  await press(screen, '홈');
  await press(screen, '커뮤니티');
  await settle();

  expect(asked.map(item => item.cursor)).toEqual([null, '20']);
  expect(feedList(screen).props.data).toHaveLength(40);
});

test('7.1 reads its first page again once after a post was written, edited or deleted elsewhere', async () => {
  const { repositories, asked } = pagedFeed(45);
  const screen = await openCommunity(repositories);
  await reachEnd(screen);
  expect(feedList(screen).props.data).toHaveLength(40);

  // What 7.3, 7.3e and 7.2's 삭제 send once the server took the change.
  postsChanged();
  await press(screen, '홈');
  await press(screen, '커뮤니티');
  await settle();
  expect(asked.map(item => item.cursor)).toEqual([null, '20', null]);
  expect(feedList(screen).props.data).toHaveLength(20);

  // The change was read once; the next return keeps the list.
  await reachEnd(screen);
  await press(screen, '홈');
  await press(screen, '커뮤니티');
  await settle();
  expect(asked.map(item => item.cursor)).toEqual([null, '20', null, '20']);
  expect(feedList(screen).props.data).toHaveLength(40);
});

test('a like and a bookmark made on 7.2 show on the feed page under it without reading the feed again', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const listFeed = jest.fn(repositories.community.listFeed);
  repositories.community.listFeed = listFeed;
  const screen = await openCommunity(repositories);
  const feedPost = (id: string) =>
    screen.root
      .findAllByType(FeedPage)
      .map(page => page.props.post)
      .find(post => post.id === id);
  const opened = screen.root.findAllByType(FeedPage)[0].props.post;
  await openFirstPost(screen);
  expect(screen.root.findAllByType(PostDetailScreen)).toHaveLength(1);
  const reads = listFeed.mock.calls.length;

  await press(screen, opened.liked ? '좋아요 취소' : '좋아요');
  await press(screen, opened.bookmarked ? '저장 취소' : '저장');
  await press(screen, '뒤로');

  expect(feedPost(opened.id).liked).toBe(!opened.liked);
  expect(feedPost(opened.id).bookmarked).toBe(!opened.bookmarked);
  expect(listFeed.mock.calls.length).toBe(reads);
});

test('7.1 저장 shows at once through CMT16 and goes back when the server refuses', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const calls: [string, boolean][] = [];
  let refuse = false;
  repositories.community.setBookmarked = async (postId, bookmarked) => {
    calls.push([postId, bookmarked]);
    if (refuse) {
      throw new DataError('SERVER_ERROR', 'offline');
    }
  };
  const screen = await openCommunity(repositories);
  const firstPost = () => screen.root.findAllByType(FeedPage)[0].props.post;
  const firstBookmark = () =>
    screen.root
      .findAllByType(FeedPage)[0]
      .findAll(
        node =>
          (node.props.accessibilityLabel === '저장' ||
            node.props.accessibilityLabel === '저장 취소') &&
          typeof node.props.onPress === 'function',
      )[0];
  const before = firstPost().bookmarked;

  await act(async () => firstBookmark().props.onPress());
  await settle();
  expect(firstPost().bookmarked).toBe(!before);
  expect(calls).toEqual([[firstPost().id, !before]]);

  refuse = true;
  await act(async () => firstBookmark().props.onPress());
  await settle();
  // Refused: the bookmark stays as it was before this press.
  expect(calls[1]).toEqual([firstPost().id, before]);
  expect(firstPost().bookmarked).toBe(!before);
});
