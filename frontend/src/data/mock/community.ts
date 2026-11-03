import { DataError } from '../errors';
import type {
  PostComment,
  PostDetail,
  PostRecord,
  Repositories,
  RunnerProfile,
} from '../types';
import * as fixtures from './fixtures';
import type { PostFixture, RecordFixture } from './fixtures';
import { kstDay, summaryOf, toSummary } from './records';

type Respond = <T>(value: T) => Promise<T>;
type Fail = (error: DataError) => Promise<never>;

const me = fixtures.communityUsers.me;

// My run as a post card. The mock has no heart rate or cadence totals, so a watch run gets
// the 7.3 sheet's values.
function shareableOf(record: RecordFixture): PostRecord {
  return {
    ...toSummary(record),
    place: record.title.replace(/ 출발$/, ''),
    courseRun: record.courseId !== null,
    averageHeartRate: record.watch ? 158 : null,
    cadence: record.watch ? 170 : null,
  };
}

// 7.x 커뮤니티 mock: posts, likes, bookmarks, comments and follows kept in memory.
export function createCommunityMock({
  respond,
  fail,
  records,
}: {
  respond: Respond;
  fail: Fail;
  // My runs as the records mock keeps them, newest first.
  records: () => RecordFixture[];
}): {
  community: Repositories['community'];
  runners: Repositories['runners'];
  myPostCount: () => number;
  setPrivate: (isPrivate: boolean) => void;
} {
  const first = records().find(run => run.id === fixtures.myPost.recordId);
  // My own post (7.2b 게시물 메뉴) shares one of my runs, so it is built from the records mock.
  let posts: PostFixture[] = [
    ...(first
      ? [
          {
            ...fixtures.myPost,
            author: me,
            record: shareableOf(first),
            liked: false,
            bookmarked: false,
            comments: [],
          },
        ]
      : []),
    ...fixtures.posts.map(post => ({ ...post })),
  ];
  const profiles = new Map(
    Object.entries(fixtures.runnerProfiles).map(([id, profile]) => [
      id,
      { ...profile },
    ]),
  );
  let nextId = 1;

  const find = (postId: string) => {
    const post = posts.find(item => item.id === postId);
    if (!post) {
      throw new Error(`게시물 없음: ${postId}`);
    }
    return post;
  };
  const update = (postId: string, change: Partial<PostFixture>) => {
    posts = posts.map(post =>
      post.id === postId ? { ...post, ...change } : post,
    );
  };
  const postWith = (commentId: string) =>
    posts.find(post => post.comments.some(item => item.id === commentId));
  const view = ({ comments, ...post }: PostFixture) => ({
    ...post,
    isMine: post.author.userId === me.userId,
    commentCount: comments.length,
  });
  const following = (userId: string) =>
    userId === me.userId || profiles.get(userId)?.followStatus === 'FOLLOWING';
  const record = (recordId: string | null) => {
    const mine = records();
    const found = recordId ? mine.find(item => item.id === recordId) : mine[0];
    if (!found) {
      throw new Error(`기록 없음: ${recordId}`);
    }
    return found;
  };

  const profileOf = (userId: string): RunnerProfile => {
    const profile = profiles.get(userId);
    if (!profile) {
      throw new Error(`러너 없음: ${userId}`);
    }
    const isMe = userId === me.userId;
    const user = Object.values(fixtures.communityUsers).find(
      item => item.userId === userId,
    );
    const month = kstDay(fixtures.now).slice(0, 7);
    // Mine are my own runs; someone else's are the runs they shared.
    const runs = isMe
      ? records().map(run => ({
          record: toSummary(run),
          postId: null as string | null,
        }))
      : posts
          .filter(post => post.author.userId === userId)
          .map(post => ({ record: post.record, postId: post.id }));
    const thisMonth = runs
      .map(run => run.record)
      .filter(run => kstDay(run.startedAt).startsWith(month));
    const summary = isMe
      ? summaryOf(
          records().filter(run => kstDay(run.startedAt).startsWith(month)),
        )
      : null;
    const distance = thisMonth.reduce((sum, run) => sum + run.distanceM, 0);
    const duration = thisMonth.reduce((sum, run) => sum + run.durationSec, 0);
    return {
      userId,
      handle: user?.handle ?? userId,
      nickname: user?.nickname ?? userId,
      level: profile.level,
      isMe,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      followStatus: profile.followStatus,
      isPrivate: profile.isPrivate,
      followRequestCount: isMe ? fixtures.myFollowRequestCount : null,
      monthly: {
        runCount: summary?.runCount ?? thisMonth.length,
        totalDistanceM: summary?.totalDistanceM ?? distance,
        averagePaceSecPerKm:
          summary?.averagePaceSecPerKm ??
          (distance ? Math.round(duration / (distance / 1000)) : null),
      },
      records: runs.slice(0, 3),
    };
  };

  const community: Repositories['community'] = {
    listFeed: scope =>
      respond(
        posts
          .filter(post => scope === 'ALL' || following(post.author.userId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(view),
      ),
    get: postId => {
      const post = find(postId);
      const detail: PostDetail = {
        ...view(post),
        comments: post.comments.map(comment => ({
          ...comment,
          isMine: comment.author.userId === me.userId,
        })),
      };
      return respond(detail);
    },
    getShareable: recordId => respond(shareableOf(record(recordId))),
    create: (recordId, draft) => {
      const id = `post-mine-${nextId++}`;
      posts = [
        {
          id,
          author: me,
          body: draft.body,
          record: shareableOf(record(recordId)),
          courseShared: draft.courseShared,
          createdAt: new Date().toISOString(),
          likeCount: 0,
          liked: false,
          bookmarked: false,
          comments: [],
        },
        ...posts,
      ];
      return respond({ id });
    },
    update: (postId, draft) => {
      update(postId, { body: draft.body, courseShared: draft.courseShared });
      return respond(undefined);
    },
    remove: postId => {
      posts = posts.filter(post => post.id !== postId);
      return respond(undefined);
    },
    setLiked: (postId, liked) => {
      const post = find(postId);
      if (post.liked !== liked) {
        update(postId, {
          liked,
          likeCount:
            post.likeCount === null ? null : post.likeCount + (liked ? 1 : -1),
        });
      }
      return respond(undefined);
    },
    setBookmarked: (postId, bookmarked) => {
      update(postId, { bookmarked });
      return respond(undefined);
    },
    addComment: (postId, body) => {
      const comment: PostComment = {
        id: `comment-mine-${nextId++}`,
        author: me,
        isMine: true,
        body,
        createdAt: new Date().toISOString(),
        likeCount: 0,
        liked: false,
      };
      update(postId, { comments: [...find(postId).comments, comment] });
      return respond(comment);
    },
    // CMT08 · CMT09 answer the same errors as the server.
    updateComment: (commentId, body) => {
      const post = postWith(commentId);
      const comment = post?.comments.find(item => item.id === commentId);
      if (!post || !comment) {
        return fail(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
      }
      if (comment.author.userId !== me.userId) {
        return fail(new DataError('NOT_AUTHOR', '내 댓글이 아님'));
      }
      const text = body.trim();
      if (!text) {
        return fail(new DataError('EMPTY_COMMENT', '빈 댓글'));
      }
      update(post.id, {
        comments: post.comments.map(item =>
          item.id === commentId ? { ...item, body: text } : item,
        ),
      });
      return respond(text);
    },
    removeComment: commentId => {
      const post = postWith(commentId);
      const comment = post?.comments.find(item => item.id === commentId);
      if (!post || !comment) {
        return fail(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
      }
      if (comment.author.userId !== me.userId) {
        return fail(new DataError('NOT_AUTHOR', '내 댓글이 아님'));
      }
      update(post.id, {
        comments: post.comments.filter(item => item.id !== commentId),
      });
      return respond(undefined);
    },
  };

  const runners: Repositories['runners'] = {
    getProfile: userId => respond(profileOf(userId ?? me.userId)),
    // U22: a private account takes a request first (PENDING).
    setFollowing: (userId, follow) => {
      const profile = profiles.get(userId);
      if (profile) {
        const was = profile.followStatus;
        profile.followStatus = !follow
          ? 'NONE'
          : profile.isPrivate
          ? 'PENDING'
          : 'FOLLOWING';
        profile.followerCount +=
          (profile.followStatus === 'FOLLOWING' ? 1 : 0) -
          (was === 'FOLLOWING' ? 1 : 0);
      }
      return respond(profileOf(userId));
    },
  };

  return {
    community,
    runners,
    // 8.4: my posts that go away with the account.
    myPostCount: () =>
      posts.filter(post => post.author.userId === me.userId).length,
    // 8.1 계정 공개 범위 shows on 7.4b.
    setPrivate: (isPrivate: boolean) => {
      const profile = profiles.get(me.userId);
      if (profile) {
        profile.isPrivate = isPrivate;
      }
    },
  };
}
