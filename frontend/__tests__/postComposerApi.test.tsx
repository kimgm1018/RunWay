import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { RunMap } from '../src/components/RunMap';
import { ToastProvider } from '../src/components/Toast';
import {
  createMockRepositories,
  DataProvider,
  tokenStore,
  type Repositories,
  type RunRecordDetail,
} from '../src/data';
import { createCommunityApi } from '../src/data/api/community';
import { RouteLine } from '../src/screens/community/FeedPage';
import {
  PostEditScreen,
  PostWriteScreen,
} from '../src/screens/community/PostWriteScreen';

// 7.3 · 7.3e against the server (S15P31E105-632): the preview shows what 코스도 함께 공유 shares, the run's
// course (C03), never my GPS track; 7.3e sends courseShared in CMT04.

let mockParams: Record<string, string> = {};
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    canGoBack: () => true,
    goBack: mockGoBack,
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

async function render(Screen: React.ComponentType) {
  const mock = createMockRepositories({ latencyMs: 0 });
  const records = {
    ...mock.records,
    getDetail: async () => detail,
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
    tries < 40 && !texts(screen!).includes('코스도');
    tries++
  ) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });
  }
  return screen!;
}

const maps = (screen: Screen) => screen.root.findAllByType(RunMap);
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

  expect(courseSwitch(screen).props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });
  expect(maps(screen)).toHaveLength(1);
  expect(maps(screen)[0].props.route).toEqual(course);
  expect(maps(screen)[0].props.route).not.toEqual(gps);
  expect(texts(screen)).not.toContain('예시 경로');

  // Turning sharing off leaves the course off the page.
  await act(async () => courseSwitch(screen).props.onPress());
  expect(maps(screen)).toHaveLength(0);
  expect(drawn(screen)).toHaveLength(0);
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
  expect(maps(screen)[0].props.route).toEqual(course);
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
