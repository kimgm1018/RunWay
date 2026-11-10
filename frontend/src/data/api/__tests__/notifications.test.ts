import { appConfig } from '../../../config';
import { notificationsApi } from '../notifications';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  };
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('N01 reads the newest 50 with string ids, the target and the unread count', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      items: [
        {
          id: 9001,
          kind: 'FOLLOW_REQUEST',
          message: '러너님의 팔로우 요청이 도착했습니다.',
          createdAt: '2026-11-06T01:00:00Z',
          read: false,
          targetId: 101,
        },
        {
          id: 9000,
          kind: 'GROUP_RUN_START_REMINDER',
          message: '‘토요일 아침’ 그룹런이 곧 시작해요',
          createdAt: '2026-11-05T23:00:00Z',
          read: true,
          targetId: 31,
        },
      ],
      nextCursor: 'abc',
      hasNext: true,
      unreadCount: 7,
    }),
  );

  await expect(notificationsApi.list()).resolves.toEqual({
    items: [
      {
        id: '9001',
        kind: 'FOLLOW_REQUEST',
        message: '러너님의 팔로우 요청이 도착했습니다.',
        createdAt: '2026-11-06T01:00:00Z',
        read: false,
        // N01 FOLLOW_REQUEST targetId is the requester users.id, not the request id.
        targetId: '101',
      },
      {
        id: '9000',
        kind: 'GROUP_RUN_START_REMINDER',
        message: '‘토요일 아침’ 그룹런이 곧 시작해요',
        createdAt: '2026-11-05T23:00:00Z',
        read: true,
        targetId: '31',
      },
    ],
    unreadCount: 7,
    nextCursor: 'abc',
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/notifications?limit=50`);
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

test('N01 sends the cursor for the next page', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      items: [
        {
          id: 8999,
          kind: 'POST_COMMENT',
          message: '서연님이 댓글을 남겼어요',
          createdAt: '2026-11-05T22:00:00Z',
          read: true,
          targetId: 77,
        },
      ],
      nextCursor: null,
      hasNext: false,
      unreadCount: 0,
    }),
  );

  await expect(notificationsApi.list('abc')).resolves.toEqual({
    items: [
      {
        id: '8999',
        kind: 'POST_COMMENT',
        message: '서연님이 댓글을 남겼어요',
        createdAt: '2026-11-05T22:00:00Z',
        read: true,
        targetId: '77',
      },
    ],
    unreadCount: 0,
    nextCursor: null,
  });
  expect(fetchMock.mock.calls[0][0]).toBe(
    `${appConfig.apiBaseUrl}/notifications?limit=50&cursor=abc`,
  );
});

test('N01 leaves out a kind the app does not know yet', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      items: [
        {
          id: 2,
          kind: 'SOMETHING_NEW',
          message: '새 종류',
          createdAt: '2026-11-06T01:00:00Z',
          read: false,
          targetId: 5,
        },
        {
          id: 1,
          kind: 'POST_COMMENT',
          message: '서연님이 댓글을 남겼어요',
          createdAt: '2026-11-06T00:00:00Z',
          read: false,
          targetId: 77,
        },
      ],
      nextCursor: null,
      hasNext: false,
      unreadCount: 2,
    }),
  );

  const list = await notificationsApi.list();
  expect(list.items.map(item => item.id)).toEqual(['1']);
  expect(list.unreadCount).toBe(2);
  expect(list.nextCursor).toBeNull();
});

test('N02 posts read-all without a body and settles on 204', async () => {
  fetchMock.mockResolvedValue(respond(204));

  await expect(notificationsApi.markAllRead()).resolves.toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/notifications/read-all`);
  expect(init.method).toBe('POST');
  expect(init.body).toBeUndefined();
});
