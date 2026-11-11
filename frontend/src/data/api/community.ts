import type {
  CommentLike,
  CourseMapData,
  Post,
  PostAuthor,
  PostComment,
  PostDetail,
  PostPage,
  PostRegion,
  PostRecord,
  Repositories,
} from '../types';
import { basemapOf } from './basemap';
import { apiRequest } from './http';
import { imageAddress } from './images';
import { listItems } from './listItems';
import type { Regions } from './regions';
import { tokenStore } from './tokenStore';

// CMT01–CMT19 커뮤니티 (docs/design/api/community.md). Posts carry their like and comment counts, my
// like, my bookmark and the author's photo; comments carry their author. The server has no handles or the
// run's place and heart rate yet, so those are filled in below.

type AuthorResponse = {
  userId: number;
  nickname: string | null;
  profileImageUrl?: string | null;
};

type RecordSummaryResponse = {
  distanceM: number | null;
  movingDurationSec: number | null;
  averagePaceSecPerKm: number | null;
};

// CMT02 item and CMT03 (which adds updatedAt). U21 lists a runner's posts in the same shape. courseId is
// null for a free run, or when the author did not share the course and I am not the author.
export type PostResponse = {
  id: number;
  authorId: number;
  sessionId: number;
  body: string | null;
  regionCode: string | null;
  createdAt: string;
  courseId?: number | null;
  courseShared?: boolean;
  commentCount?: number;
  reactionCount?: number;
  myReaction?: 'LIKE' | null;
  // S15P31E105-634: whether I bookmarked it (CMT16 · CMT17); an older server leaves it out.
  bookmarked?: boolean;
  author: AuthorResponse;
  recordSummary: RecordSummaryResponse | null;
};

// CMT02 · CMT18 · CMT19 page. nextCursor is null when hasNext is false.
type PostListResponse = {
  items?: PostResponse[] | null;
  nextCursor?: string | null;
  hasNext?: boolean;
};

// The app reads 20 a page (S15P31E105-647 D-3).
export const postPageSize = 20;

// C03, only the route (GeoJSON [longitude, latitude]) and its map thumbnail (S15P31E105-612, missing on an older
// server).
type CourseRouteResponse = {
  route: { coordinates: [number, number][] };
  basemap?: unknown;
  unmeasuredEdges?: number[] | null;
};

// A course's points for 7.2, 7.3 and 7.3e; a course that cannot be read leaves the page without them.
const readCourseRoute = (courseId: number | string) =>
  apiRequest<CourseRouteResponse>(`/courses/${courseId}`)
    .then(course => course.route.coordinates)
    .catch(() => null);

// CMT06 item and CMT07. S15P31E105-633 adds deleted, reactionCount and myReaction; a deleted root kept for its
// replies comes without authorId, author and body. An older server leaves the new fields out.
type CommentResponse = {
  id: number;
  postId: number;
  authorId: number | null;
  author?: AuthorResponse | null;
  parentCommentId: number | null;
  body: string | null;
  createdAt: string;
  deleted?: boolean;
  reactionCount?: number;
  myReaction?: 'LIKE' | null;
};

// CMT14 · CMT15.
type CommentReactionResponse = {
  commentId: number;
  reactionCount: number;
  myReaction: 'LIKE' | null;
};

// A runner without a nickname (a closed account), or a comment from a server without its author.
const unknownAuthor = '러너';
const myName = '나';

// Hermes and Node provide atob, but React Native's type definitions leave it out.
const { atob } = globalThis as unknown as { atob?: (data: string) => string };

// My user id is the access token's sub claim (ADR-0014), as U04 is not on the server yet.
function myUserId() {
  const payload = tokenStore.current()?.accessToken.split('.')[1];
  if (!payload || !atob) {
    return null;
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const { sub } = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

// The nickname doubles as the handle: the server has no seoyun.run style id.
const authorOf = (
  userId: number,
  nickname: string | null,
  profileImageUrl: string | null = null,
): PostAuthor => ({
  userId: String(userId),
  handle: nickname ?? unknownAuthor,
  nickname: nickname ?? unknownAuthor,
  profileImageUrl: imageAddress(profileImageUrl),
});

// The course the post shares (courseShared, defaulting to a server without the flag): the author still
// gets the courseId of a course left unshared, for 7.3e.
const sharedCourseOf = (response: PostResponse) =>
  (response.courseShared ?? true) && response.courseId != null
    ? response.courseId
    : null;

const authorFrom = (author: AuthorResponse) =>
  authorOf(author.userId, author.nickname, author.profileImageUrl);

// Only the distance, moving time and pace come with a post, so the card leaves the rest blank and is
// dated by the post.
export function recordOf(response: PostResponse): PostRecord {
  const distanceM = response.recordSummary?.distanceM ?? 0;
  const durationSec = response.recordSummary?.movingDurationSec ?? 0;
  const pace = response.recordSummary?.averagePaceSecPerKm;
  return {
    id: String(response.sessionId),
    title: '러닝 기록',
    startedAt: response.createdAt,
    distanceM,
    durationSec,
    averagePaceSecPerKm:
      pace != null
        ? Math.round(pace)
        : distanceM > 0
        ? Math.round(durationSec / (distanceM / 1000))
        : 0,
    shape: [],
    runType: 'SOLO',
    group: null,
    goalAchieved: null,
    place: '',
    courseRun: response.courseId != null,
    // The route comes with 7.2 (C03 by the post's course), not with the list.
    route: null,
    averageHeartRate: null,
    cadence: null,
  };
}

// How long a new post waits for the region its run started in before it is shared without one.
const regionWaitMs = 3000;

export function createCommunityApi({
  records,
  regions,
  addressOf = async () => null,
}: {
  records: Repositories['records'];
  // CMT12 (S15P31E105-687); without it 7.1 offers only 전국 and a post goes without a region.
  regions?: Regions;
  // The phone's full address of a [longitude, latitude] point, with its 시·도.
  addressOf?: (position: [number, number]) => Promise<string | null>;
}): Repositories['community'] {
  // The region of a shared course's start (S15P31E105-687, 사용자 결정 1번): only a post that shares its course
  // gets one, and the point is the course's own start, already public with it, never my GPS track. A phone that
  // finds nothing or one too slow gives none and the post goes without a region. Only codes from CMT12 come out
  // (posts.region_code references regions). Coordinates are never logged.
  const regionAt = async (
    position: [number, number],
  ): Promise<PostRegion | null> => {
    if (!regions) {
      return null;
    }
    const find = async () => {
      const code = await regions.codeAt(await addressOf(position));
      const label = code ? await regions.name(code) : null;
      return code && label ? { code, label } : null;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), regionWaitMs);
    });
    try {
      return await Promise.race([find().catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
  };
  // Likes I made or took back in this session, only for a server that leaves out myReaction: when the
  // post carries myReaction, the server's value wins on every read.
  const likes = new Map<string, boolean>();
  // The course of each post the list brought, and the routes read for 7.1 (S15P31E105-521): paging back to a
  // post does not ask again.
  const courseIds = new Map<string, number | null>();
  const routes = new Map<string, Promise<CourseMapData | null>>();
  const readRoute = async (postId: string): Promise<CourseMapData | null> => {
    const courseId = courseIds.has(postId)
      ? courseIds.get(postId)
      : sharedCourseOf(await apiRequest<PostResponse>(`/posts/${postId}`));
    if (courseId == null) {
      return null;
    }
    const course = await apiRequest<CourseRouteResponse>(
      `/courses/${courseId}`,
    );
    return {
      route: course.route.coordinates,
      basemap: basemapOf(course.basemap),
      unmeasuredEdges: course.unmeasuredEdges ?? [],
    };
  };

  const toPost = (response: PostResponse): Post => {
    const id = String(response.id);
    // Only a shared course is drawn on 7.1 and 7.2.
    const sharedCourse = sharedCourseOf(response);
    courseIds.set(id, sharedCourse);
    return {
      id,
      author: authorFrom(response.author),
      isMine: String(response.authorId) === myUserId(),
      body: response.body,
      record: recordOf(response),
      courseShared: sharedCourse !== null,
      createdAt: response.createdAt,
      likeCount: response.reactionCount ?? null,
      liked:
        response.myReaction !== undefined
          ? response.myReaction === 'LIKE'
          : likes.get(id) ?? false,
      commentCount: response.commentCount ?? null,
      bookmarked: response.bookmarked ?? false,
    };
  };

  // postAuthor names the comment's author when the server leaves it out: only the post's author and I are known.
  const toComment = (
    response: CommentResponse,
    postAuthor: AuthorResponse | null,
  ): PostComment => {
    const shared = {
      id: String(response.id),
      parentId:
        response.parentCommentId == null
          ? null
          : String(response.parentCommentId),
      createdAt: response.createdAt,
    };
    if (response.deleted || response.authorId == null) {
      return {
        ...shared,
        deleted: true,
        author: null,
        isMine: false,
        body: '',
        likeCount: 0,
        liked: false,
      };
    }
    const me = String(response.authorId) === myUserId();
    const nickname =
      postAuthor && response.authorId === postAuthor.userId
        ? postAuthor.nickname
        : me
        ? myName
        : unknownAuthor;
    return {
      ...shared,
      deleted: false,
      author: response.author
        ? authorFrom(response.author)
        : authorOf(response.authorId, nickname),
      isMine: me,
      body: response.body ?? '',
      likeCount: Math.max(0, response.reactionCount ?? 0),
      liked: response.myReaction === 'LIKE',
    };
  };

  const readPage = async (
    path: string,
    query: Record<string, string>,
    cursor: string | null | undefined,
  ): Promise<PostPage> => {
    const page = await apiRequest<PostListResponse | null>(path, {
      query: { ...query, limit: postPageSize, cursor: cursor ?? undefined },
    });
    return {
      items: listItems(page).map(toPost),
      nextCursor: page?.hasNext && page.nextCursor ? page.nextCursor : null,
    };
  };

  return {
    listFeed: (scope, cursor, regionCode) =>
      readPage(
        '/posts',
        regionCode ? { scope, regionCode } : { scope },
        cursor,
      ),
    listRegions: async () => (regions ? regions.provinces() : []),
    regionAt,
    listAuthorPosts: (userId, cursor) =>
      readPage('/posts', { authorId: userId }, cursor),
    listMyBookmarks: cursor => readPage('/users/me/bookmarks', {}, cursor),
    listMyLikes: cursor => readPage('/users/me/likes', {}, cursor),
    get: async postId => {
      const [post, commentsPage] = await Promise.all([
        apiRequest<PostResponse>(`/posts/${postId}`),
        apiRequest<{ items: CommentResponse[] }>(`/posts/${postId}/comments`),
      ]);
      const items = listItems(commentsPage);
      const base = toPost(post);
      // 7.2 shows the shared course on the real map (S15P31E105-561): its points from C03. My own post also gets
      // the course I left unshared (the server still gives me its courseId), so 7.3e can show what sharing it
      // again would show; 7.2 draws it only while shared. A course that cannot be read leaves the post without
      // a route rather than failing the page.
      // A shared course 7.1 already read is not asked for again (사용자 요청: 7.2 지도를 바로).
      const known = base.courseShared ? routes.get(postId) : undefined;
      const knownRoute = known ? (await known)?.route ?? null : null;
      const route =
        post.courseId == null || !(base.courseShared || base.isMine)
          ? null
          : knownRoute ?? (await readCourseRoute(post.courseId));
      const comments = items.map(item => toComment(item, post.author));
      const detail: PostDetail = {
        ...base,
        record: { ...base.record, route },
        // A deleted root kept for its replies is not a comment to count.
        commentCount:
          base.commentCount ?? comments.filter(item => !item.deleted).length,
        comments,
      };
      return detail;
    },
    // 7.1 draws the post on screen on the real map. A course that cannot be read leaves the drawn map, and is
    // asked for again next time rather than remembered as missing.
    getRoute: postId => {
      const known = routes.get(postId);
      if (known) {
        return known;
      }
      const route = readRoute(postId).catch(() => {
        routes.delete(postId);
        return null;
      });
      routes.set(postId, route);
      return route;
    },
    // 7.3 shares one of my runs: the given one, or the newest.
    getShareable: async recordId => {
      const id = recordId ?? (await records.getRecent('recent', 1))[0]?.id;
      if (!id) {
        throw new Error('공유할 기록 없음');
      }
      const detail = await records.getDetail(id);
      // What 코스도 함께 공유 shares is the run's course (C03), not my GPS track, so 7.3 previews that course;
      // a free run shares no route.
      const route =
        detail.courseId === null
          ? null
          : await readCourseRoute(detail.courseId);
      return {
        ...detail,
        place: '',
        courseRun: detail.courseId !== null,
        route,
        averageHeartRate: null,
        cadence: null,
      };
    },
    // CMT01 can create the private course from a free run when sharing is requested.
    // The region 7.3 showed goes along only with a shared course (S15P31E105-687).
    create: async (recordId, draft) => {
      const regionCode = draft.courseShared ? draft.regionCode : null;
      const response = await apiRequest<{
        id: number;
        courseShared: boolean;
        courseShareFailureReason?: string | null;
      }>('/posts', {
        method: 'POST',
        body: {
          sessionId: Number(recordId),
          body: draft.body,
          courseShared: draft.courseShared,
          ...(regionCode ? { regionCode } : {}),
        },
      });
      return {
        id: String(response.id),
        courseShared: response.courseShared,
        courseShareFailureReason: response.courseShareFailureReason ?? null,
      };
    },
    update: async (postId, draft) => {
      await apiRequest(`/posts/${postId}`, {
        method: 'PATCH',
        body: { body: draft.body, courseShared: draft.courseShared },
      });
      // 7.1 reads the route again after the next list, under the new choice.
      routes.delete(postId);
    },
    remove: async postId => {
      await apiRequest(`/posts/${postId}`, { method: 'DELETE' });
    },
    // CMT10 좋아요 · CMT11 취소.
    setLiked: async (postId, liked) => {
      await apiRequest(`/posts/${postId}/reactions/me`, {
        method: liked ? 'PUT' : 'DELETE',
        body: liked ? { reactionType: 'LIKE' } : undefined,
      });
      likes.set(postId, liked);
    },
    // CMT16 스크랩 · CMT17 취소, both idempotent.
    setBookmarked: async (postId, bookmarked) => {
      await apiRequest(`/posts/${postId}/bookmarks/me`, {
        method: bookmarked ? 'PUT' : 'DELETE',
      });
    },
    // CMT07; a reply names its root as parentCommentId (left out for a root comment).
    addComment: async (postId, body, parentId) => {
      const comment = await apiRequest<CommentResponse>(
        `/posts/${postId}/comments`,
        {
          method: 'POST',
          body: parentId
            ? { body, parentCommentId: Number(parentId) }
            : { body },
        },
      );
      const added = toComment(comment, null);
      return {
        ...added,
        // Without its author, my new comment is still mine.
        author: comment.author
          ? added.author
          : authorOf(comment.authorId ?? 0, myName),
        parentId:
          comment.parentCommentId == null
            ? parentId ?? null
            : String(comment.parentCommentId),
        isMine: true,
      };
    },
    updateComment: async (commentId, body) => {
      const comment = await apiRequest<{ body: string }>(
        `/comments/${commentId}`,
        { method: 'PATCH', body: { body } },
      );
      return comment.body;
    },
    removeComment: async commentId => {
      await apiRequest(`/comments/${commentId}`, { method: 'DELETE' });
    },
    // CMT14 좋아요 · CMT15 취소: the server's count and my like after the change.
    setCommentLiked: async (commentId, liked): Promise<CommentLike> => {
      const reaction = await apiRequest<CommentReactionResponse>(
        `/comments/${commentId}/reactions/me`,
        {
          method: liked ? 'PUT' : 'DELETE',
          body: liked ? { reactionType: 'LIKE' } : undefined,
        },
      );
      return {
        likeCount:
          typeof reaction?.reactionCount === 'number'
            ? Math.max(0, reaction.reactionCount)
            : null,
        liked:
          reaction?.myReaction !== undefined
            ? reaction.myReaction === 'LIKE'
            : liked,
      };
    },
  };
}
