import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { InlineRunReplay } from '../src/screens/community/RouteReplay';
import { feedLook } from '../src/screens/community/FeedPage';
import { communityLook } from '../src/screens/community/look';
import { ToastProvider } from '../src/components/Toast';
import {
  createMockRepositories,
  DataError,
  DataProvider,
  tokenStore,
  type DataErrorCode,
  type Repositories,
  type RunRecordDetail,
} from '../src/data';
import { createCommunityApi } from '../src/data/api/community';
import { RouteLine } from '../src/screens/community/FeedPage';
import { Avatar } from '../src/screens/community/parts';
import {
  PostEditScreen,
  postFailure,
  PostWriteScreen,
} from '../src/screens/community/PostWriteScreen';

// 7.3 · 7.3e against the server (S15P31E105-632): the preview shows what 코스도 함께 공유 shares, the run's
// course (C03), never my GPS track; 7.3e sends courseShared in CMT04.

let mockParams: Record<string, string | boolean> = {};
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
    replace: mockReplace,
    navigate: jest.fn(),
    dispatch: jest.fn(),
  }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const texts = (screen: Screen) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

// My user id 7 in the token's sub claim: base64url of {"sub":"7"}.
const payload = 'eyJzdWIiOiI3In0';
const createdAt = '2026-10-19T03:15:00Z';

// My GPS track for the run, and the course (C03) the run followed: two different lines.
const gps: [number, number][] = [
  [129.101, 35.101],
  [129.102, 35.102],
  [129.103, 35.103],
];
const course: [number, number][] = [
  [129.201, 35.201],
  [129.202, 35.202],
  [129.203, 35.203],
];

const detail = {
  id: '55',
  title: '광안리 출발',
  startedAt: createdAt,
  distanceM: 5020,
  durationSec: 1795,
  averagePaceSecPerKm: 358,
  shape: [
    [0.1, 0.1],
    [0.5, 0.6],
    [0.9, 0.2],
  ],
  runType: 'SOLO',
  group: null,
  goalAchieved: null,
  route: gps,
  routeParts: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
  averageHeartRate: null,
  aiAdvice: null,
  splits: [],
  courseId: '31',
  myCourseId: null,
} as RunRecordDetail;

// My post on run 55 that left its course unshared: as the author I still get its courseId.
const myPost = {
  id: 201,
  authorId: 7,
  sessionId: 55,
  body: '광안리 한 바퀴',
  regionCode: null,
  createdAt,
  updatedAt: createdAt,
  courseId: 31,
  courseShared: false,
  commentCount: 0,
  reactionCount: 0,
  myReaction: null,
  author: { userId: 7, nickname: '민준', profileImageUrl: null },
  recordSummary: {
    distanceM: 5020,
    movingDurationSec: 1795,
    averagePaceSecPerKm: 357.5,
  },
};

function serve({ courseReadable = true } = {}) {
  fetchMock.mockImplementation(
    async (url: string, init: { method: string }) => {
      const path = new URL(url).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/courses/31') {
        return courseReadable
          ? respond(200, {
              id: 31,
              route: { type: 'LineString', coordinates: course },
            })
          : respond(404, { code: 'COURSE_NOT_FOUND', message: '' });
      }
      if (path === '/posts/201' && init.method === 'PATCH') {
        return respond(200, { id: 201, updatedAt: createdAt });
      }
      if (path === '/posts/201') {
        return respond(200, myPost);
      }
      if (path === '/posts/201/comments') {
        return respond(200, { items: [] });
      }
      return respond(404, { code: 'NOT_FOUND', message: '' });
    },
  );
}

let mounted: Screen | null = null;

async function render(
  Screen: React.ComponentType,
  change: Partial<RunRecordDetail> = {},
) {
  const mock = createMockRepositories({ latencyMs: 0 });
  const records = {
    ...mock.records,
    getDetail: async () => ({ ...detail, ...change }),
    getRoute: async () => change.routeParts ?? null,
  } as Repositories['records'];
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider
        repositories={{
          ...mock,
          records,
          community: createCommunityApi({ records }),
        }}
      >
        <ToastProvider>
          <Screen />
        </ToastProvider>
      </DataProvider>,
    );
  });
  mounted = screen!;
  for (
    let tries = 0;
    tries < 40 &&
    screen!.root.findAll(node => node.props.accessibilityLabel === '글 내용')
      .length === 0;
    tries++
  ) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });
  }
  return screen!;
}

const maps = (screen: Screen) => screen.root.findAllByType(InlineRunReplay);
const drawn = (screen: Screen) => screen.root.findAllByType(RouteLine);
const courseSwitch = (screen: Screen) =>
  screen.root.findAll(
    node =>
      node.props.accessibilityRole === 'switch' &&
      node.props.accessibilityLabel === '코스도 함께 공유' &&
      typeof node.props.onPress === 'function',
  )[0];

beforeEach(async () => {
  mockGoBack.mockReset();
  mockReplace.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: `header.${payload}.signature`,
    refreshToken: 'refresh-1',
  });
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

test('7.3 previews the course the post will share, not my GPS track', async () => {
  serve();
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);

  expect(courseSwitch(screen)).toBeUndefined();
  expect(maps(screen)).toHaveLength(1);
  expect(maps(screen)[0].props.run.parts[0]).toEqual(course);
  expect(maps(screen)[0].props.run.parts[0]).not.toEqual(gps);
  expect(texts(screen)).not.toContain('예시 경로');
});

test('7.3 uses a bright community map with my profile pin instead of S and F markers', async () => {
  serve();
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);
  const map = screen.root.findAll(
    node => typeof node.type === 'string' && node.props.testID === 'naver-map',
  )[0];
  expect(map.props.lightness ?? 0).toBe(0);
  expect(
    screen.root
      .findAllByType(Text)
      .filter(
        node => node.props.children === 'S' || node.props.children === 'F',
      ),
  ).toHaveLength(0);
  const pin = map.findAllByType(Avatar);
  expect(pin).toHaveLength(1);
  expect(pin[0].props.mine).toBe(true);
  expect(pin[0].props.userId).toBeTruthy();
});

test('the focused draft stays in view when the keyboard shrinks the viewport or multiline content grows', async () => {
  serve();
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);
  const input = screen.root.findByType(TextInput);
  const scroll = screen.root.findByType(ScrollView);
  const scrollToEnd = scroll.instance.scrollToEnd as jest.Mock;
  const focused = input.instance.isFocused as jest.Mock;
  scrollToEnd.mockClear();
  focused.mockReturnValue(true);

  await act(async () => {
    input.props.onChangeText('여러 줄의 러닝 기록\n마지막 줄도 보여야 해요');
    scroll.props.onLayout?.({ nativeEvent: { layout: { height: 320 } } });
    scroll.props.onContentSizeChange?.(390, 580);
  });
  expect(scrollToEnd).toHaveBeenCalled();
  expect(input.props.value).toContain('마지막 줄도 보여야 해요');

  scrollToEnd.mockClear();
  focused.mockReturnValue(false);
  await act(async () => {
    scroll.props.onLayout?.({ nativeEvent: { layout: { height: 700 } } });
  });
  expect(scrollToEnd).not.toHaveBeenCalled();
});

test('the post body caret follows the text line height on Android', async () => {
  serve();
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);
  const input = screen.root.findByType(TextInput);
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({
    fontSize: 16,
    lineHeight: 22,
    includeFontPadding: false,
    textAlignVertical: 'top',
  });
  expect(input.props.selectionColor).toBe(communityLook.selection);
  expect(input.props.cursorColor).toBe(feedLook.route);
});

test('7.3 previews the measured route of a free run and always requests course sharing without a toggle', async () => {
  serve();
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen, {
    courseId: null,
    routeParts: [gps],
  });
  expect(courseSwitch(screen)).toBeUndefined();
  expect(maps(screen)).toHaveLength(1);
  expect(maps(screen)[0].props.run.parts).toHaveLength(1);
  const line = maps(screen)[0].props.run.parts[0] as [number, number][];
  expect(line).toHaveLength(gps.length);
  line.forEach(([longitude, latitude], index) => {
    expect(longitude).toBeCloseTo(gps[index][0], 8);
    expect(latitude).toBeCloseTo(gps[index][1], 8);
  });
  await submit(screen, '게시');
  const sent = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith('/posts') && init.method === 'POST',
  );
  expect(JSON.parse(sent![1].body)).toMatchObject({
    sessionId: 55,
    courseShared: true,
  });
});

test('7.3 keeps the post and explains when the server cannot turn GPS into a shared course', async () => {
  serve();
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init: { method: string }) =>
    String(url).endsWith('/posts') && init.method === 'POST'
      ? respond(201, {
          id: 204,
          courseShared: false,
          courseShareFailureReason: 'INSUFFICIENT_GPS',
        })
      : served(url, init),
  );
  mockParams = { recordId: '55', fromRecords: true };
  const screen = await render(PostWriteScreen, { courseId: null });
  await submit(screen, '게시');
  expect(texts(screen)).toContain(
    'GPS 경로가 부족해 기록만 공유했어요. 코스 공유는 꺼졌어요.',
  );
  expect(mockReplace).toHaveBeenCalledWith('PostDetail', { postId: '204' });
});

test('7.3 falls back to the drawn shape when the course cannot be read, never to the GPS track', async () => {
  serve({ courseReadable: false });
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);

  expect(maps(screen)).toHaveLength(0);
  expect(drawn(screen)).toHaveLength(1);
  expect(texts(screen)).toContain('예시 경로');
});

test('7.3e shows the course again when I turn sharing back on and sends courseShared in CMT04', async () => {
  serve();
  mockParams = { postId: '201' };
  const screen = await render(PostEditScreen);

  expect(courseSwitch(screen).props.accessibilityState).toEqual({
    checked: false,
    disabled: false,
  });
  expect(maps(screen)).toHaveLength(0);

  await act(async () => courseSwitch(screen).props.onPress());
  expect(maps(screen)).toHaveLength(1);
  expect(maps(screen)[0].props.run.parts[0]).toEqual(course);
  // Not an empty 예시 경로: the real course is on the map.
  expect(texts(screen)).not.toContain('예시 경로');

  const save = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === '저장' &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => {
    await save[save.length - 1].props.onPress();
  });
  const patch = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith('/posts/201') && init.method === 'PATCH',
  );
  expect(JSON.parse(patch![1].body)).toEqual({
    body: '광안리 한 바퀴',
    courseShared: true,
  });
  expect(mockGoBack).toHaveBeenCalled();
});

// S15P31E105-633: a failed 게시 (CMT01) or 저장 (CMT04) says why.
test('a failed 게시 or 저장 says why, by the server code', () => {
  const failure = (code: DataErrorCode, action: '게시' | '저장') =>
    postFailure(new DataError(code, ''), action);

  expect(failure('INVALID_POST', '게시')).toBe(
    '삭제됐거나 완료되지 않은 기록은 공유할 수 없어요',
  );
  expect(failure('RESOURCE_NOT_OWNED', '게시')).toBe(
    '내 러닝 기록만 공유할 수 있어요',
  );
  expect(failure('POST_NOT_FOUND', '저장')).toBe('이미 삭제된 게시물이에요');
  expect(failure('NOT_AUTHOR', '저장')).toBe(
    '내가 쓴 게시물만 수정할 수 있어요',
  );
  expect(failure('VALIDATION_ERROR', '저장')).toBe('글 내용을 확인해 주세요');
  expect(failure('NETWORK_ERROR', '게시')).toBe(
    '인터넷 연결을 확인한 뒤 다시 시도해 주세요',
  );
  expect(failure('SERVER_ERROR', '게시')).toBe(
    '게시하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(postFailure(new Error('?'), '저장')).toBe(
    '저장하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
});

// Every fetch goes as serve() answers, except the one this answers.
function failing(
  match: (path: string, method: string) => boolean,
  status: number,
  code: string,
) {
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(
    async (url: string, init: { method: string }) => {
      const path = new URL(url).pathname.replace(/^.*\/api\/v1/, '');
      return match(path, init.method)
        ? respond(status, { code, message: '' })
        : served(url, init);
    },
  );
}

async function submit(screen: Screen, label: string) {
  const buttons = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => {
    await buttons[buttons.length - 1].props.onPress();
  });
}

test('7.3 says the run can no longer be shared when CMT01 answers INVALID_POST', async () => {
  serve();
  failing(
    (path, method) => path === '/posts' && method === 'POST',
    422,
    'INVALID_POST',
  );
  mockParams = { recordId: '55' };
  const screen = await render(PostWriteScreen);

  await submit(screen, '게시');

  expect(texts(screen)).toContain(
    '삭제됐거나 완료되지 않은 기록은 공유할 수 없어요',
  );
  expect(texts(screen)).not.toContain('잠시 후 다시 시도해 주세요');
});

test('7.3e says the post is gone when CMT04 answers POST_NOT_FOUND', async () => {
  serve();
  failing(
    (path, method) => path === '/posts/201' && method === 'PATCH',
    404,
    'POST_NOT_FOUND',
  );
  mockParams = { postId: '201' };
  const screen = await render(PostEditScreen);

  await submit(screen, '저장');

  expect(texts(screen)).toContain('이미 삭제된 게시물이에요');
  expect(mockGoBack).not.toHaveBeenCalled();
});

test('a saved record submits once on rapid taps and opens the created post', async () => {
  serve();
  const served = fetchMock.getMockImplementation()!;
  let finish!: (value: ReturnType<typeof respond>) => void;
  fetchMock.mockImplementation((url: string, init: { method: string }) =>
    String(url).endsWith('/posts') && init.method === 'POST'
      ? new Promise(resolve => {
          finish = resolve;
        })
      : served(url, init),
  );
  mockParams = { recordId: '55', fromRecords: true };
  const screen = await render(PostWriteScreen);
  const button = screen.root
    .findAll(
      node =>
        node.props.accessibilityLabel === '게시' &&
        typeof node.props.onPress === 'function',
    )
    .pop()!;
  let requests!: Promise<unknown>[];
  await act(async () => {
    requests = [button.props.onPress(), button.props.onPress()];
  });
  const posts = () =>
    fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/posts') && init.method === 'POST',
    );
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0][1].body)).toEqual({
    sessionId: 55,
    body: null,
    courseShared: true,
  });
  await act(async () => {
    finish(respond(201, { id: 202, courseShared: true }));
    await Promise.all(requests);
  });
  expect(mockReplace).toHaveBeenCalledWith('PostDetail', { postId: '202' });
});

test('a failed saved-record post keeps the draft and can retry the same session', async () => {
  serve();
  failing(
    (path, method) => path === '/posts' && method === 'POST',
    503,
    'SERVER_ERROR',
  );
  mockParams = { recordId: '55', fromRecords: true };
  const screen = await render(PostWriteScreen);
  const input = screen.root
    .findAll(
      node =>
        node.props.accessibilityLabel === '글 내용' &&
        typeof node.props.onChangeText === 'function',
    )
    .pop()!;
  await act(async () => input.props.onChangeText('다시 공유할 러닝'));
  await submit(screen, '게시');
  expect(mockReplace).not.toHaveBeenCalled();
  expect(input.props.value).toBe('다시 공유할 러닝');
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init: { method: string }) =>
    String(url).endsWith('/posts') && init.method === 'POST'
      ? respond(201, { id: 203, courseShared: true })
      : served(url, init),
  );
  await submit(screen, '게시');
  const posts = fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/posts') && init.method === 'POST',
  );
  expect(posts).toHaveLength(2);
  for (const [, init] of posts) {
    expect(JSON.parse(init.body)).toMatchObject({
      sessionId: 55,
      body: '다시 공유할 러닝',
    });
  }
  expect(mockReplace).toHaveBeenCalledWith('PostDetail', { postId: '203' });
  expect(
    fetchMock.mock.calls.some(([, init]) => init.method === 'DELETE'),
  ).toBe(false);
});

test.each([
  [403, 'RESOURCE_NOT_OWNED', '내 러닝 기록만 공유할 수 있어요'],
  [422, 'INVALID_POST', '삭제됐거나 완료되지 않은 기록은 공유할 수 없어요'],
])(
  'saved-record posting respects CMT01 rejection %s %s',
  async (status, code, message) => {
    serve();
    failing(
      (path, method) => path === '/posts' && method === 'POST',
      status,
      code,
    );
    mockParams = { recordId: '55', fromRecords: true };
    const screen = await render(PostWriteScreen);
    await submit(screen, '게시');
    expect(texts(screen)).toContain(message);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([, init]) => init.method === 'DELETE'),
    ).toBe(false);
  },
);
