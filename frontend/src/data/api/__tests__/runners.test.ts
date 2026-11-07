import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import type { RunRecordSummary, RunStatistics } from '../../types';
import { createRunnersApi } from '../runners';
import { tokenStore } from '../tokenStore';

// 7.4 러너 프로필 · 7.4b 내 프로필 (U21) and 팔로우 · 취소 (U22 · U23), users.md, S15P31E105-524.
// 합성 응답이며 실데이터가 아니다.

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const myRun = { id: '31', title: '아침 러닝' } as RunRecordSummary;
const getRecent = jest.fn(async () => [myRun]);
const getStatistics = jest.fn(
  async () =>
    ({
      runCount: 7,
      totalDistanceM: 35200,
      totalDurationSec: 12390,
      averagePaceSecPerKm: 352,
    } as RunStatistics),
);

const runners = createRunnersApi({
  myId: async () => '101',
  records: { getRecent, getStatistics } as never,
  now: () => new Date('2026-11-07T03:00:00Z'),
});

const post = (id: number, createdAt: string, distanceM: number, sec: number) => ({
  id,
  authorId: 202,
  sessionId: id * 10,
  body: null,
  regionCode: null,
  createdAt,
  author: { userId: 202, nickname: '서윤' },
  recordSummary: { distanceM, movingDurationSec: sec, averagePaceSecPerKm: null },
});

const calls = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${init.method} ${String(url).replace(appConfig.apiBaseUrl, '')}`,
  );

beforeEach(async () => {
  fetchMock.mockReset();
  getRecent.mockClear();
  getStatistics.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('U21 shows a runner with the runs they shared and this month worked out from them', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      userId: 202,
      nickname: '서윤',
      profileImageUrl: 'https://img.example/202.jpg',
      profileAccessible: true,
      followStatus: 'FOLLOWING',
      isFollowing: true,
      runningLevel: 'ADVANCED',
      followerCount: 248,
      followingCount: 131,
      posts: [
        // 11.6 KST: this month.
        post(3, '2026-11-05T22:00:00Z', 5000, 1500),
        // 10.31 23:30 UTC is already 11.1 KST.
        post(2, '2026-10-31T23:30:00Z', 10000, 3300),
        // 10.31 KST: last month.
        post(1, '2026-10-31T10:00:00Z', 8000, 2800),
        post(0, '2026-10-20T10:00:00Z', 3000, 1000),
      ],
    }),
  );

  const profile = await runners.getProfile('202');
  expect(calls()).toEqual(['GET /users/202/profile']);
  expect(profile).toMatchObject({
    userId: '202',
    handle: '서윤',
    nickname: '서윤',
    profileImageUrl: 'https://img.example/202.jpg',
    level: 'ADVANCED',
    isMe: false,
    accessible: true,
    followStatus: 'FOLLOWING',
    followerCount: 248,
    followingCount: 131,
    followRequestCount: null,
    // 15km in 80 minutes: 5′20″/km.
    monthly: { runCount: 2, totalDistanceM: 15000, averagePaceSecPerKm: 320 },
  });
  expect(profile.records.map(run => run.postId)).toEqual(['3', '2', '1']);
  expect(profile.records[0].record).toMatchObject({ id: '30', distanceM: 5000 });
  expect(getRecent).not.toHaveBeenCalled();
});

test('U21 of a private runner who has not approved me keeps only the name, photo and follow state', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      userId: 303,
      nickname: '지우',
      profileImageUrl: null,
      profileAccessible: false,
      followStatus: 'PENDING',
      isFollowing: false,
    }),
  );

  await expect(runners.getProfile('303')).resolves.toEqual({
    userId: '303',
    handle: '지우',
    nickname: '지우',
    profileImageUrl: null,
    level: null,
    isMe: false,
    followerCount: null,
    followingCount: null,
    followStatus: 'PENDING',
    accessible: false,
    followRequestCount: null,
    monthly: { runCount: 0, totalDistanceM: 0, averagePaceSecPerKm: null },
    records: [],
  });
});

test('7.4b reads U21 with my id and fills the month and recent runs from my records', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      userId: 101,
      nickname: '민준',
      profileImageUrl: null,
      profileAccessible: true,
      followStatus: 'NONE',
      isFollowing: null,
      followerCount: 86,
      followingCount: 102,
      posts: [post(9, '2026-11-06T00:00:00Z', 5000, 1500)],
    }),
  );

  const profile = await runners.getProfile(null);
  expect(calls()).toEqual(['GET /users/101/profile']);
  expect(profile).toMatchObject({
    userId: '101',
    isMe: true,
    // No running profile yet: the level is left out.
    level: null,
    followerCount: 86,
    monthly: { runCount: 7, totalDistanceM: 35200, averagePaceSecPerKm: 352 },
    records: [{ record: myRun, postId: null }],
  });
  expect(getRecent).toHaveBeenCalledWith('recent', 3);
  expect(getStatistics).toHaveBeenCalledWith('MONTH', '2026-11-01');
});

test.each([
  [true, 'PUT'],
  [false, 'DELETE'],
])('following %s sends %s /users/{id}/follow and reads the profile again', async (following, method) => {
  fetchMock
    .mockResolvedValueOnce(
      respond(200, {
        followerCount: 0,
        followStatus: following ? 'PENDING' : 'NONE',
        following: false,
      }),
    )
    .mockResolvedValueOnce(
      respond(200, {
        userId: 303,
        nickname: '지우',
        profileImageUrl: null,
        profileAccessible: false,
        followStatus: following ? 'PENDING' : 'NONE',
        isFollowing: false,
      }),
    );

  const profile = await runners.setFollowing('303', following);
  expect(calls()).toEqual([`${method} /users/303/follow`, 'GET /users/303/profile']);
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  expect(profile.followStatus).toBe(following ? 'PENDING' : 'NONE');
  expect(profile.accessible).toBe(false);
});

test.each([
  [404, 'USER_NOT_FOUND'],
  [422, 'CANNOT_FOLLOW_SELF'],
])('U22 %s %s reaches the screen as that failure', async (status, code) => {
  fetchMock.mockResolvedValue(respond(status, { code, message: '', details: {} }));

  const failure = await runners.setFollowing('303', true).catch(error => error);
  expect(failure).toBeInstanceOf(DataError);
  expect((failure as DataError).code).toBe(code);
});
