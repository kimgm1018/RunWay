import { threadComments, withoutComment } from '../commentThread';
import { DataError } from '../errors';
import type {
  PostAuthor,
  PostComment,
  PostDetail,
  PostPage,
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
// U24 reads 10 requests a page.
const requestPage = 10;
// U26 · U27 read 20 a page.
const followPage = 20;
// CMT02 · CMT18 · CMT19 read 20 a page (S15P31E105-647).
const postPage = 20;

// My run as a post card. The mock has no heart rate or cadence totals, so a watch run gets
// the 7.3 sheet's values.
function shareableOf(record: RecordFixture): PostRecord {
  return {
    ...toSummary(record),
    place: record.title.replace(/ 출발$/, ''),
    courseRun: record.courseId !== null,
    route: record.route,
    averageHeartRate: record.watch ? 158 : null,
    cadence: record.watch ? 170 : null,
  };
}

// A deleted root kept for its replies: no author, text or likes (CMT06).
const deletedPlace = (comment: PostFixture['comments'][number]) => ({
  ...comment,
  deleted: true,
  author: null,
  body: '',
  likeCount: 0,
  liked: false,
});

// 7.x 커뮤니티 mock: posts, likes, bookmarks, comments and follows kept in memory.
export function createCommunityMock({
  respond,
  fail,
  records,
  myPhoto,
}: {
  respond: Respond;
  fail: Fail;
  // My runs as the records mock keeps them, newest first.
  records: () => RecordFixture[];
  // My photo as 8.2 last set it; the other runners' come from fixtures.runnerPhotos.
  myPhoto: () => string | null;
}): {
  community: Repositories['community'];
  runners: Repositories['runners'];
  myPostCount: () => number;
  setPrivate: (isPrivate: boolean) => void;
  removeRecordPosts: (recordId: string) => void;
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
  // CMT02 newest first; the key also places a cursor, so a post taken out between pages skips nothing.
  const postKey = (post: PostFixture) => `${post.createdAt}|${post.id}`;
  const byNewest = (list: PostFixture[]) =>
    [...list].sort((a, b) => postKey(b).localeCompare(postKey(a)));
  // CMT18 · CMT19 list in the order I bookmarked or liked, newest first: each mark gets the next number. The
  // fixtures' marks count up from the oldest post.
  let markCount = 0;
  const marked = (list: PostFixture[]) =>
    new Map(
      byNewest(list)
        .reverse()
        .map(post => [post.id, ++markCount] as const),
    );
  const bookmarkMarks = marked(posts.filter(post => post.bookmarked));
  const likeMarks = marked(posts.filter(post => post.liked));
  const setMark = (marks: Map<string, number>, postId: string, on: boolean) => {
    if (on) {
      marks.set(postId, ++markCount);
    } else {
      marks.delete(postId);
    }
  };
  // 7.4b 팔로우 요청: answered ones leave the list (U24 lists PENDING only).
  let followRequests = fixtures.myFollowRequests.map(request => ({
    ...request,
  }));
  // 7.4c: who follows whom besides me; my own follows come from followStatus.
  const followers = new Map(
    Object.entries(fixtures.runnerFollowers).map(([id, ids]) => [id, [...ids]]),
  );
  // A request that is no longer waiting answers 404 like U25.
  const settle = (requesterId: string, approved: boolean) => {
    followRequests = followRequests.filter(
      request => request.requesterId !== requesterId,
    );
    const mine = profiles.get(me.userId);
    if (approved && mine) {
      mine.followerCount += 1;
      followers.set(me.userId, [
        requesterId,
        ...(followers.get(me.userId) ?? []).filter(id => id !== requesterId),
      ]);
    }
  };
  // U26 · U27 newest first: the ones I follow, then the fixture's.
  const followersOf = (userId: string) => [
    ...(userId !== me.userId &&
    profiles.get(userId)?.followStatus === 'FOLLOWING'
      ? [me.userId]
      : []),
    ...(followers.get(userId) ?? []),
  ];
  const followingOf = (userId: string) =>
    userId === me.userId
      ? [...profiles.entries()]
          .filter(([, profile]) => profile.followStatus === 'FOLLOWING')
          .map(([id]) => id)
      : [...followers.entries()]
          .filter(([, ids]) => ids.includes(userId))
          .map(([id]) => id);
  const nicknameOf = (userId: string) =>
    Object.values(fixtures.communityUsers).find(user => user.userId === userId)
      ?.handle ??
    fixtures.myFollowRequests.find(request => request.requesterId === userId)
      ?.nickname ??
    '러너';

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
  // A live comment (not a deleted root's place) and its post, or the server's COMMENT_NOT_FOUND.
  const liveComment = (commentId: string) => {
    const post = postWith(commentId);
    const comment = post?.comments.find(item => item.id === commentId);
    return post && comment && !comment.deleted ? { post, comment } : null;
  };
  // Authors carry their photo like CMT02 · CMT03 · CMT06 author.profileImageUrl.
  const photoOf = (userId: string) =>
    userId === me.userId ? myPhoto() : fixtures.runnerPhotos[userId] ?? null;
  const withPhoto = (author: PostAuthor): PostAuthor => ({
    ...author,
    profileImageUrl: photoOf(author.userId),
  });
  const view = ({ comments, ...post }: PostFixture) => ({
    ...post,
    author: withPhoto(post.author),
    isMine: post.author.userId === me.userId,
    // As CMT02 · CMT03: a deleted root kept for its replies is not counted.
    commentCount: comments.filter(comment => !comment.deleted).length,
  });
  const following = (userId: string) =>
    userId === me.userId || profiles.get(userId)?.followStatus === 'FOLLOWING';
  // As the server: a private runner's posts only once they approve me.
  const visible = (post: PostFixture) => {
    const profile = profiles.get(post.author.userId);
    return (
      !profile?.isPrivate ||
      post.author.userId === me.userId ||
      profile.followStatus === 'FOLLOWING'
    );
  };
  // 20 a page from a list sorted by key, newest first; the cursor is the last key given, as the server's.
  const pageOf = (
    list: PostFixture[],
    keyOf: (post: PostFixture) => string,
    cursor?: string | null,
  ): PostPage => {
    const from = cursor ? list.findIndex(post => keyOf(post) < cursor) : 0;
    const start = from === -1 ? list.length : from;
    const page = list.slice(start, start + postPage);
    return {
      items: page.map(view),
      nextCursor:
        start + postPage < list.length ? keyOf(page[page.length - 1]) : null,
    };
  };
  const feedPage = (list: PostFixture[], cursor?: string | null) =>
    pageOf(byNewest(list.filter(visible)), postKey, cursor);
  const markPage = (marks: Map<string, number>, cursor?: string | null) => {
    const keyOf = (post: PostFixture) =>
      String(marks.get(post.id) ?? 0).padStart(10, '0');
    const list = posts
      .filter(post => marks.has(post.id) && visible(post))
      .sort((a, b) => keyOf(b).localeCompare(keyOf(a)));
    return pageOf(list, keyOf, cursor);
  };
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
    // As U21: a private account shows only the name, photo and follow state until it approves me.
    const accessible =
      isMe || !profile.isPrivate || profile.followStatus === 'FOLLOWING';
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
      profileImageUrl: photoOf(userId),
      level: accessible ? profile.level : null,
      isMe,
      followerCount: accessible ? profile.followerCount : null,
      followingCount: accessible ? profile.followingCount : null,
      followStatus: profile.followStatus,
      accessible,
      followRequests: isMe
        ? {
            count: Math.min(followRequests.length, requestPage),
            more: followRequests.length > requestPage,
          }
        : null,
      monthly: accessible
        ? {
            runCount: summary?.runCount ?? thisMonth.length,
            totalDistanceM: summary?.totalDistanceM ?? distance,
            averagePaceSecPerKm:
              summary?.averagePaceSecPerKm ??
              (distance ? Math.round(duration / (distance / 1000)) : null),
          }
        : { runCount: 0, totalDistanceM: 0, averagePaceSecPerKm: null },
      // Five of mine (four shown, one telling 더보기, S15P31E105-682), three of someone else's, as the API.
      records: accessible ? runs.slice(0, isMe ? 5 : 3) : [],
    };
  };

  const community: Repositories['community'] = {
    // Mock posts carry no region, so a picked region keeps them all (S15P31E105-687).
    listFeed: (scope, cursor) =>
      respond(
        feedPage(
          posts.filter(
            post => scope === 'ALL' || following(post.author.userId),
          ),
          cursor,
        ),
      ),
    listRegions: () =>
      respond([
        {
          code: '11000',
          name: '서울',
          areas: [
            { code: '11140', name: '중구' },
            { code: '11680', name: '강남구' },
          ],
        },
        {
          code: '26000',
          name: '부산',
          areas: [
            { code: '26350', name: '해운대구' },
            { code: '26500', name: '수영구' },
          ],
        },
      ]),
    // 7.3 지역: every mock course starts by 광안리.
    regionAt: () => respond({ code: '26500', label: '부산 수영구' }),
    listAuthorPosts: (userId, cursor) =>
      respond(
        feedPage(
          posts.filter(post => post.author.userId === userId),
          cursor,
        ),
      ),
    listMyBookmarks: cursor => respond(markPage(bookmarkMarks, cursor)),
    listMyLikes: cursor => respond(markPage(likeMarks, cursor)),
    get: postId => {
      const post = find(postId);
      const detail: PostDetail = {
        ...view(post),
        // As CMT06: each root followed by its replies.
        comments: threadComments(post.comments).map(({ comment }) => ({
          ...comment,
          author: comment.author ? withPhoto(comment.author) : null,
          isMine: comment.author?.userId === me.userId,
        })),
      };
      return respond(detail);
    },
    getRoute: postId => {
      const post = find(postId);
      // The mock's posts all run round 민락수변공원, so a shared course gets that map image.
      return respond(
        post.courseShared && post.record.route
          ? { route: post.record.route, basemap: fixtures.minrakBasemap }
          : null,
      );
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
          // As CMT01: a free run keeps courseShared false.
          courseShared:
            draft.courseShared && record(recordId).courseId !== null,
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
      update(postId, {
        body: draft.body,
        courseShared: draft.courseShared && find(postId).record.courseRun,
      });
      return respond(undefined);
    },
    remove: postId => {
      posts = posts.filter(post => post.id !== postId);
      return respond(undefined);
    },
    setLiked: (postId, liked) => {
      const post = find(postId);
      if (post.liked !== liked) {
        setMark(likeMarks, postId, liked);
        update(postId, {
          liked,
          likeCount:
            post.likeCount === null ? null : post.likeCount + (liked ? 1 : -1),
        });
      }
      return respond(undefined);
    },
    setBookmarked: (postId, bookmarked) => {
      const post = posts.find(item => item.id === postId);
      if (post && post.bookmarked !== bookmarked) {
        setMark(bookmarkMarks, postId, bookmarked);
      }
      update(postId, { bookmarked });
      return respond(undefined);
    },
    // CMT07: a reply answers a live root of the same post (the server's INVALID_PARENT_COMMENT otherwise).
    addComment: (postId, body, parentId) => {
      const parent = parentId
        ? find(postId).comments.find(item => item.id === parentId)
        : null;
      if (parentId && (!parent || parent.deleted || parent.parentId)) {
        return fail(
          new DataError(
            'INVALID_PARENT_COMMENT',
            '답글을 달 수 없는 댓글',
            null,
            422,
          ),
        );
      }
      const comment: PostComment = {
        id: `comment-mine-${nextId++}`,
        parentId: parentId ?? null,
        deleted: false,
        author: withPhoto(me),
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
      const found = liveComment(commentId);
      if (!found) {
        return fail(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
      }
      const { post, comment } = found;
      if (comment.author?.userId !== me.userId) {
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
    // A root with replies stays as a deleted place; one without leaves, as does a deleted place whose last
    // reply goes (CMT06 D-1).
    removeComment: commentId => {
      const found = liveComment(commentId);
      if (!found) {
        return fail(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
      }
      const { post, comment } = found;
      if (comment.author?.userId !== me.userId) {
        return fail(new DataError('NOT_AUTHOR', '내 댓글이 아님'));
      }
      update(post.id, {
        comments: withoutComment(post.comments, commentId, deletedPlace),
      });
      return respond(undefined);
    },
    // CMT14 · CMT15: idempotent, and my own comment can be liked too.
    setCommentLiked: (commentId, liked) => {
      const found = liveComment(commentId);
      if (!found) {
        return fail(new DataError('COMMENT_NOT_FOUND', '댓글 없음'));
      }
      const { post, comment } = found;
      const likeCount =
        comment.liked === liked
          ? comment.likeCount
          : Math.max(0, comment.likeCount + (liked ? 1 : -1));
      update(post.id, {
        comments: post.comments.map(item =>
          item.id === commentId ? { ...item, liked, likeCount } : item,
        ),
      });
      return respond({ likeCount, liked });
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
        const change =
          (profile.followStatus === 'FOLLOWING' ? 1 : 0) -
          (was === 'FOLLOWING' ? 1 : 0);
        profile.followerCount += change;
        // 7.4b 팔로잉 counts the runners 7.4c lists for me (S15P31E105-534).
        const mine = profiles.get(me.userId);
        if (mine) {
          mine.followingCount += change;
        }
      }
      return respond(profileOf(userId));
    },
    // U24 pages of 10; the cursor is where the next page starts.
    listFollowRequests: cursor => {
      const start = cursor ? Number(cursor) : 0;
      const end = start + requestPage;
      return respond({
        items: followRequests.slice(start, end),
        nextCursor: end < followRequests.length ? String(end) : null,
      });
    },
    // U26 · U27: a private account answers 403 until it approves me.
    listFollows: (userId, kind, cursor) => {
      const profile = profiles.get(userId);
      if (!profile) {
        return fail(new DataError('USER_NOT_FOUND', '러너 없음'));
      }
      if (
        userId !== me.userId &&
        profile.isPrivate &&
        profile.followStatus !== 'FOLLOWING'
      ) {
        return fail(new DataError('ACCOUNT_ACCESS_DENIED', '비공개 계정'));
      }
      const ids =
        kind === 'followers' ? followersOf(userId) : followingOf(userId);
      const start = cursor ? Number(cursor) : 0;
      const end = start + followPage;
      return respond({
        items: ids.slice(start, end).map(id => ({
          userId: id,
          nickname: nicknameOf(id),
          profileImageUrl: photoOf(id),
        })),
        nextCursor: end < ids.length ? String(end) : null,
      });
    },
    decideFollowRequest: (request, decision) => {
      const waiting = followRequests.find(
        item =>
          item.requesterId === request.requesterId &&
          item.requestId === request.requestId,
      );
      if (!waiting) {
        return fail(new DataError('REQUEST_NOT_FOUND', '요청 없음'));
      }
      settle(request.requesterId, decision === 'APPROVE');
      return respond(undefined);
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
      // Going public approves every waiting request (U14).
      if (!isPrivate) {
        followRequests.forEach(request => settle(request.requesterId, true));
      }
    },
    // S09 기록 삭제 takes my posts sharing that run with it.
    removeRecordPosts: (recordId: string) => {
      posts = posts.filter(
        post =>
          !(post.author.userId === me.userId && post.record.id === recordId),
      );
    },
  };
}
