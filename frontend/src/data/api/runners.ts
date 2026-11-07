import type { Repositories, RunnerProfile, SelfReportedLevel } from '../types';
import { recordOf, type PostResponse } from './community';
import { apiRequest } from './http';

// 7.4 러너 프로필 · 7.4b 내 프로필 (U21) and 팔로우 · 취소 (U22 · U23), docs/design/api/users.md.
// U21 has no month summary or 팔로우 요청 count: someone else's month is worked out from the runs they
// shared, mine from my records, and the request count waits for U24 (S15P31E105-525).

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

  // My recent runs (H01) and this month's totals (H06), every run type as in 5.3.
  async function mine() {
    const month = kstMonth(now().getTime());
    const [recent, summary] = await Promise.all([
      records.getRecent('recent', shownRuns),
      records.getStatistics('MONTH', `${month}-01`),
    ]);
    return {
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
      profileImageUrl: response.profileImageUrl ?? null,
      level: accessible ? response.runningLevel ?? null : null,
      isMe,
      followerCount: accessible ? response.followerCount ?? null : null,
      followingCount: accessible ? response.followingCount ?? null : null,
      followStatus: isMe ? 'NONE' : response.followStatus,
      accessible,
      followRequestCount: null,
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
  };
}
