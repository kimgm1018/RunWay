import type {
  FollowListPage,
  FollowRequestPage,
  Repositories,
  RunnerProfile,
  SelfReportedLevel,
} from '../types';
import { recordOf, type PostResponse } from './community';
import { apiRequest } from './http';
import { imageAddress } from './images';

// 7.4 러너 프로필 · 7.4b 내 프로필 (U21), 팔로우 · 취소 (U22 · U23) and 팔로우 요청 (U24 · U25),
// docs/design/api/users.md. U21 has no month summary or 팔로우 요청 count: someone else's month is worked
// out from the runs they shared, mine from my records, and the count from U24's first page.

type FollowStatus = RunnerProfile['followStatus'];

// A private account I may not see yet answers 200 with only the id, name, photo and follow state.
type ProfileResponse = {
  userId: number;
  nickname?: string;
  profileImageUrl: string | null;
  profileAccessible: boolean;
  followStatus: FollowStatus;
  // null when I read my own profile.
  isFollowing: boolean | null;
  runningLevel?: SelfReportedLevel;
  followerCount?: number;
  followingCount?: number;
  posts?: PostResponse[];
};

const unknownNickname = '러너';
// 7.4 · 7.4b show three runs.
const shownRuns = 3;
const kstOffsetMs = 9 * 60 * 60 * 1000;
const kstMonth = (time: number) =>
  new Date(time + kstOffsetMs).toISOString().slice(0, 7);

const noMonth = { runCount: 0, totalDistanceM: 0, averagePaceSecPerKm: null };

// U24 item: a pending request to my account.
type FollowRequestResponse = {
  requesterId: number;
  requestId: number;
  nickname: string | null;
  requestedAt: string;
};

type FollowRequestsResponse = {
  items: FollowRequestResponse[];
  nextCursor: string | null;
  hasNext: boolean;
};

const followRequestsPath = '/users/me/follow-requests';

// U26 · U27 item: a runner on the other side of an approved follow.
type FollowListResponse = {
  items: {
    userId: number;
    nickname: string | null;
    profileImageUrl: string | null;
  }[];
  nextCursor: string | null;
  hasNext: boolean;
};

async function readFollowRequests(cursor: string | null) {
  const page = await apiRequest<FollowRequestsResponse>(followRequestsPath, {
    query: { cursor },
  });
  const result: FollowRequestPage = {
    items: page.items.map(item => ({
      requesterId: String(item.requesterId),
      requestId: String(item.requestId),
      nickname: item.nickname ?? unknownNickname,
      requestedAt: item.requestedAt,
    })),
    nextCursor: page.hasNext ? page.nextCursor : null,
  };
  return result;
}

// 7.4b 팔로우 요청 N건 from U24's first page; the card still opens without a count when it fails.
const requestCount = () =>
  readFollowRequests(null).then(
    page => ({ count: page.items.length, more: page.nextCursor !== null }),
    () => null,
  );

export function createRunnersApi({
  myId,
  records,
  now = () => new Date(),
}: {
  // U04 gives my user id, for 7.4b.
  myId: () => Promise<string>;
  records: Repositories['records'];
  now?: () => Date;
}): Repositories['runners'] {
  // Someone else's runs are the posts U21 lists; this month counts the ones shared this month.
  function shared(posts: PostResponse[]) {
    const runs = posts.map(post => ({
      record: recordOf(post),
      postId: String(post.id),
    }));
    const month = kstMonth(now().getTime());
    const thisMonth = runs
      .map(run => run.record)
      .filter(run => kstMonth(Date.parse(run.startedAt)) === month);
    const distance = thisMonth.reduce((sum, run) => sum + run.distanceM, 0);
    const duration = thisMonth.reduce((sum, run) => sum + run.durationSec, 0);
    return {
      records: runs.slice(0, shownRuns),
      monthly: {
        runCount: thisMonth.length,
        totalDistanceM: distance,
        averagePaceSecPerKm: distance
          ? Math.round(duration / (distance / 1000))
          : null,
      },
    };
  }

  // My recent runs (H01), this month's totals (H06), every run type as in 5.3, and my 팔로우 요청 (U24).
  async function mine() {
    const month = kstMonth(now().getTime());
    const [recent, summary, followRequests] = await Promise.all([
      records.getRecent('recent', shownRuns),
      records.getStatistics('MONTH', `${month}-01`),
      requestCount(),
    ]);
    return {
      followRequests,
      records: recent.map(record => ({ record, postId: null })),
      monthly: {
        runCount: summary.runCount,
        totalDistanceM: summary.totalDistanceM,
        averagePaceSecPerKm: summary.averagePaceSecPerKm,
      },
    };
  }

  async function getProfile(userId: string | null): Promise<RunnerProfile> {
    const id = userId ?? (await myId());
    const response = await apiRequest<ProfileResponse>(
      `/users/${encodeURIComponent(id)}/profile`,
    );
    // U21 answers isFollowing null on my own profile, also when I open it from one of my posts.
    const isMe = userId === null || response.isFollowing === null;
    const accessible = response.profileAccessible;
    const runs = !accessible
      ? { records: [], monthly: noMonth }
      : isMe
      ? await mine()
      : shared(response.posts ?? []);
    const nickname = response.nickname ?? unknownNickname;
    return {
      userId: String(response.userId),
      // The nickname doubles as the handle, as on posts: the server has no seoyun.run style id.
      handle: nickname,
      nickname,
      profileImageUrl: imageAddress(response.profileImageUrl),
      level: accessible ? response.runningLevel ?? null : null,
      isMe,
      followerCount: accessible ? response.followerCount ?? null : null,
      followingCount: accessible ? response.followingCount ?? null : null,
      followStatus: isMe ? 'NONE' : response.followStatus,
      accessible,
      // Mine come with my runs below.
      followRequests: null,
      ...runs,
    };
  }

  return {
    getProfile,
    // U22 follows a public account at once and sends a private one a request (PENDING); U23 takes either back.
    // Both are idempotent. The profile is read again, as following or leaving a private account opens or
    // closes what it shows.
    setFollowing: async (userId, following) => {
      await apiRequest(`/users/${encodeURIComponent(userId)}/follow`, {
        method: following ? 'PUT' : 'DELETE',
      });
      return getProfile(userId);
    },
    listFollowRequests: readFollowRequests,
    // U26 followers · U27 following, 20 a page.
    listFollows: async (userId, kind, cursor) => {
      const page = await apiRequest<FollowListResponse>(
        `/users/${encodeURIComponent(userId)}/${kind}`,
        { query: { cursor } },
      );
      const result: FollowListPage = {
        items: page.items.map(item => ({
          userId: String(item.userId),
          nickname: item.nickname ?? unknownNickname,
          profileImageUrl: imageAddress(item.profileImageUrl),
        })),
        nextCursor: page.hasNext ? page.nextCursor : null,
      };
      return result;
    },
    // U25 names the request as U24 listed it, so a late answer never settles a request sent again later.
    decideFollowRequest: async (request, decision) => {
      await apiRequest(
        `${followRequestsPath}/${encodeURIComponent(request.requesterId)}`,
        {
          method: 'PATCH',
          body: { requestId: Number(request.requestId), decision },
        },
      );
    },
  };
}
