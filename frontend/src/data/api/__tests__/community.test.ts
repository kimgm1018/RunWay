import { appConfig } from '../../../config';
import { createMockRepositories } from '../../mock/createMockRepositories';
import { createCommunityApi } from '../community';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// An access token whose sub claim is my user id 7 (base64url of {"sub":"7"}); only the payload matters here.
const payload = 'eyJzdWIiOiI3In0';
const accessToken = `header.${payload}.signature`;

const base = appConfig.apiBaseUrl;

const post = {
  id: 101,
  authorId: 9,
  sessionId: 55,
  body: '오늘 5km',
  regionCode: null,
  createdAt: '2026-11-02T00:30:00Z',
  author: { userId: 9, nickname: '서윤' },
  recordSummary: {
    distanceM: 5020.5,
    movingDurationSec: 1795,
    averagePaceSecPerKm: 357.53,
  },
};
const mine = {
  ...post,
  id: 102,
  authorId: 7,
  author: { userId: 7, nickname: '민준' },
};

function sent(index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: url as string,
    method: init.method as string,
    body: init.body ? JSON.parse(init.body) : undefined,
  };
}

const community = () =>
  createCommunityApi({
    records: createMockRepositories({ latencyMs: 0 }).records,
  });

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken, refreshToken: 'refresh-1' });
});

test('CMT02 empty feed stays empty instead of failing the screen', async () => {
  fetchMock.mockResolvedValue(respond(200, { items: [] }));

  await expect(community().listFeed('ALL')).resolves.toEqual([]);
});

test('CMT02 missing items is an empty feed, not a load error', async () => {
  fetchMock.mockResolvedValue(respond(200, {}));

  await expect(community().listFeed('FOLLOWING')).resolves.toEqual([]);
});

test('CMT02 lists the feed by scope with the counts the server does not give left out', async () => {
  fetchMock.mockResolvedValue(respond(200, { items: [post, mine] }));

  const feed = await community().listFeed('FOLLOWING');

  expect(sent().url).toBe(`${base}/posts?scope=FOLLOWING`);
  expect(feed[0]).toMatchObject({
    id: '101',
    author: { userId: '9', handle: '서윤', nickname: '서윤' },
    isMine: false,
    body: '오늘 5km',
    likeCount: null,
    liked: false,
    commentCount: null,
    courseShared: false,
    record: {
      id: '55',
      distanceM: 5020.5,
      durationSec: 1795,
      averagePaceSecPerKm: 358,
      averageHeartRate: null,
      courseRun: false,
    },
  });
  // The token's sub tells my own post.
  expect(feed[1].isMine).toBe(true);
});

test('CMT03 and CMT06 open a post with its comments and who wrote them', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/comments')
      ? respond(200, {
          items: [
            {
              id: 1,
              postId: 101,
              authorId: 9,
              parentCommentId: null,
              body: '고마워요',
              createdAt: post.createdAt,
            },
            {
              id: 2,
              postId: 101,
              authorId: 7,
              parentCommentId: null,
              body: '멋져요',
              createdAt: post.createdAt,
            },
            {
              id: 3,
              postId: 101,
              authorId: 30,
              parentCommentId: 1,
              body: '저도요',
              createdAt: post.createdAt,
            },
          ],
        })
      : respond(200, { ...post, courseId: 21, updatedAt: post.createdAt }),
  );

  const detail = await community().get('101');

  expect(detail.commentCount).toBe(3);
  expect(detail.courseShared).toBe(true);
  expect(detail.record.courseRun).toBe(true);
  expect(detail.comments.map(comment => comment.author.nickname)).toEqual([
    '서윤',
    '나',
    '러너',
  ]);
});

test('CMT01 shares a run by its session id; CMT04 and CMT05 edit and delete', async () => {
  fetchMock.mockResolvedValue(respond(201, { id: 103 }));
  const api = community();

  await expect(
    api.create('55', { body: '첫 공유', courseShared: true }),
  ).resolves.toEqual({ id: '103' });
  await api.update('103', { body: '고친 글', courseShared: true });
  await api.remove('103');

  expect(sent(0)).toEqual({
    url: `${base}/posts`,
    method: 'POST',
    body: { sessionId: 55, body: '첫 공유' },
  });
  expect(sent(1)).toEqual({
    url: `${base}/posts/103`,
    method: 'PATCH',
    body: { body: '고친 글' },
  });
  expect(sent(2)).toMatchObject({ url: `${base}/posts/103`, method: 'DELETE' });
});

test('CMT10 and CMT11 like and unlike, and the feed remembers my like for the session', async () => {
  const api = community();
  fetchMock.mockResolvedValue(respond(200, { postId: 101, userId: 7 }));
  await api.setLiked('101', true);
  expect(sent(0)).toEqual({
    url: `${base}/posts/101/reactions/me`,
    method: 'PUT',
    body: { reactionType: 'LIKE' },
  });

  fetchMock.mockResolvedValue(respond(200, { items: [post] }));
  expect((await api.listFeed('ALL'))[0].liked).toBe(true);

  fetchMock.mockResolvedValue(respond(200, {}));
  await api.setLiked('101', false);
  expect(sent(2)).toMatchObject({
    url: `${base}/posts/101/reactions/me`,
    method: 'DELETE',
  });
});

test('CMT07 adds my comment', async () => {
  fetchMock.mockResolvedValue(
    respond(201, {
      id: 4,
      postId: 101,
      authorId: 7,
      parentCommentId: null,
      body: '다음엔 같이 달려요',
      createdAt: post.createdAt,
    }),
  );

  const comment = await community().addComment('101', '다음엔 같이 달려요');

  expect(sent()).toEqual({
    url: `${base}/posts/101/comments`,
    method: 'POST',
    body: { body: '다음엔 같이 달려요' },
  });
  expect(comment).toMatchObject({ id: '4', author: { nickname: '나' } });
});

test('bookmarks have no API and stay on this phone', async () => {
  const api = community();
  await api.setBookmarked('101', true);
  fetchMock.mockResolvedValue(respond(200, { items: [post] }));

  expect((await api.listFeed('ALL'))[0].bookmarked).toBe(true);
  // Only the feed went to the server.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
