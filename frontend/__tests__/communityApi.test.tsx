import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, tokenStore } from '../src/data';
import { createCommunityApi } from '../src/data/api/community';

// 7.1·7.2 against CMT02·CMT03·CMT06·CMT07·CMT10. The rest of the app stays on mock data.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

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
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
}

// My user id 7 in the token's sub claim: base64url of {"sub":"7"}.
const payload = 'eyJzdWIiOiI3In0';

const createdAt = '2026-10-19T03:15:00Z';
const post = {
  id: 101,
  authorId: 9,
  sessionId: 55,
  body: '광안리 한 바퀴',
  regionCode: null,
  createdAt,
  author: { userId: 9, nickname: '서윤' },
  recordSummary: {
    distanceM: 5020,
    movingDurationSec: 1795,
    averagePaceSecPerKm: 357.5,
  },
};

function serve() {
  fetchMock.mockImplementation(
    async (url: string, init: { method: string }) => {
      const path = new URL(url).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/posts') {
        return respond(200, { items: [post] });
      }
      if (path === '/posts/101') {
        return respond(200, { ...post, courseId: null, updatedAt: createdAt });
      }
      if (path === '/posts/101/comments' && init.method === 'POST') {
        return respond(201, {
          id: 2,
          postId: 101,
          authorId: 7,
          parentCommentId: null,
          body: '같이 달려요',
          createdAt,
        });
      }
      if (path === '/posts/101/comments') {
        return respond(200, {
          items: [
            {
              id: 1,
              postId: 101,
              authorId: 30,
              parentCommentId: null,
              body: '부럽다',
              createdAt,
            },
          ],
        });
      }
      if (path === '/posts/101/reactions/me') {
        return respond(200, { postId: 101, userId: 7 });
      }
      return respond(404, { code: 'NOT_FOUND', message: '' });
    },
  );
}

// The screen the current test opened; afterEach unmounts it even when an expectation fails.
let mounted: Screen | null = null;

async function openCommunity() {
  const mock = createMockRepositories({ latencyMs: 0 });
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={{
          ...mock,
          community: createCommunityApi({ records: mock.records }),
        }}
        initialSignedIn
      />,
    );
  });
  mounted = screen!;
  await settle();
  await press(screen!, '커뮤니티');
  await settle();
  return screen!;
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: `header.${payload}.signature`,
    refreshToken: 'refresh-1',
  });
  serve();
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

test('7.1 shows a server post without the counts the server does not give, and likes it', async () => {
  const screen = await openCommunity();
  const page = texts(screen);
  expect(page).toContain('서윤');
  expect(page).toContain('광안리 한 바퀴');
  expect(page).toContain('5.0km 러닝');
  // No place yet, so the line under the name is only the run type.
  expect(page).toContain('자유 러닝');
  expect(page).not.toContain(' · 자유 러닝');
  expect(page).not.toContain('모두 보기');

  await press(screen, '좋아요');
  const like = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith('/reactions/me'),
  );
  expect(like?.[1].method).toBe('PUT');
  expect(() => labelled(screen, '좋아요 취소')).not.toThrow();
});

test('7.2 shows the comments with what is known of their authors and adds mine', async () => {
  const screen = await openCommunity();
  await press(screen, '서윤의 게시물');
  expect(texts(screen)).toContain('부럽다');
  expect(texts(screen)).toContain('러너');

  await act(async () => {
    labelled(screen, '댓글 입력', 'onChangeText').props.onChangeText(
      '같이 달려요',
    );
  });
  await press(screen, '게시');

  const page = texts(screen);
  expect(page).toContain('같이 달려요');
  expect(page).toContain('나');
});

test('7.2 edits and deletes my comment through CMT08 · CMT09 and keeps it when that fails', async () => {
  // Each PATCH or DELETE /comments/2 takes the next answer.
  const answers = [
    () => respond(403, { code: 'NOT_AUTHOR', message: '' }),
    () =>
      respond(200, {
        id: 2,
        body: '다음 주에 같이 달려요',
        updatedAt: createdAt,
      }),
    () => Promise.reject(new TypeError('Network request failed')),
    () => respond(404, { code: 'COMMENT_NOT_FOUND', message: '' }),
    () => respond(200, { deletedAt: createdAt }),
  ];
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init: { method: string }) =>
    url.endsWith('/comments/2') ? answers.shift()!() : base(url, init),
  );
  const screen = await openCommunity();
  await press(screen, '서윤의 게시물');
  const menus = () =>
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '댓글 메뉴' &&
        typeof node.props.onPress === 'function',
    ).length;
  // Someone else's comment has no menu.
  expect(menus()).toBe(0);
  await act(async () => {
    labelled(screen, '댓글 입력', 'onChangeText').props.onChangeText(
      '같이 달려요',
    );
  });
  await press(screen, '게시');
  expect(menus()).toBe(1);

  const edit = async (text: string) => {
    await press(screen, '댓글 메뉴');
    await press(screen, '댓글 수정');
    await act(async () => {
      labelled(screen, '댓글 입력', 'onChangeText').props.onChangeText(text);
    });
    await press(screen, '댓글 수정 저장');
    await settle(50);
  };
  await edit('다음 주에 같이 달려요');
  let page = texts(screen);
  expect(page).toContain('내가 쓴 댓글만 수정할 수 있어요');
  expect(page).toContain('같이 달려요');
  await press(screen, '수정 취소');

  await edit('다음 주에 같이 달려요');
  page = texts(screen);
  expect(page).toContain('댓글을 수정했어요');
  expect(page).toContain('다음 주에 같이 달려요');
  const patch = fetchMock.mock.calls.filter(
    ([url, init]) => url.endsWith('/comments/2') && init.method === 'PATCH',
  );
  expect(JSON.parse(patch[patch.length - 1][1].body)).toEqual({
    body: '다음 주에 같이 달려요',
  });

  const remove = async () => {
    await press(screen, '댓글 메뉴');
    await press(screen, '삭제');
    expect(texts(screen)).toContain('댓글을 삭제할까요?');
    await press(screen, '삭제');
    await settle(50);
  };
  await remove();
  page = texts(screen);
  expect(page).toContain(
    '댓글을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  expect(page).toContain('다음 주에 같이 달려요');
  await remove();
  page = texts(screen);
  expect(page).toContain('이미 삭제된 댓글이에요');
  expect(page).toContain('다음 주에 같이 달려요');
  await remove();
  page = texts(screen);
  expect(page).toContain('댓글을 삭제했어요');
  expect(page).not.toContain('다음 주에 같이 달려요');
  expect(menus()).toBe(0);
});
