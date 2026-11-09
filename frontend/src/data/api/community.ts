import type {
  Post,
  PostAuthor,
  PostComment,
  PostDetail,
  PostRecord,
  Repositories,
} from '../types';
import { apiRequest } from './http';
import { listItems } from './listItems';
import { tokenStore } from './tokenStore';

// CMT01–CMT11 커뮤니티 (docs/design/api/community.md). The server has no like or comment counts, my
// like, comment authors' names, handles or the run's route, place and heart rate yet, so those are
// filled in below. Bookmarks have no API and stay on this phone for the session.

type AuthorResponse = { userId: number; nickname: string };

type RecordSummaryResponse = {
  distanceM: number | null;
  movingDurationSec: number | null;
  averagePaceSecPerKm: number | null;
};

// CMT02 item; CMT03 adds courseId and updatedAt. U21 lists a runner's posts in the same shape.
export type PostResponse = {
  id: number;
  authorId: number;
  sessionId: number;
  body: string | null;
  regionCode: string | null;
  createdAt: string;
  courseId?: number | null;
  author: AuthorResponse;
  recordSummary: RecordSummaryResponse | null;
};

// C03, only the route (GeoJSON [longitude, latitude]).
type CourseRouteResponse = { route: { coordinates: [number, number][] } };

type CommentResponse = {
  id: number;
  postId: number;
  authorId: number;
  parentCommentId: number | null;
  body: string;
  createdAt: string;
};

// A comment by someone other than me or the post's author has only an id.
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
const authorOf = (userId: number, nickname: string): PostAuthor => ({
  userId: String(userId),
  handle: nickname,
  nickname,
});

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

export function createCommunityApi({
  records,
}: {
  records: Repositories['records'];
}): Repositories['community'] {
  // Likes I made or took back in this session: the server does not say whether I liked a post.
  const likes = new Map<string, boolean>();
  const bookmarks = new Set<string>();

  const toPost = (response: PostResponse): Post => {
    const id = String(response.id);
    return {
      id,
      author: authorOf(response.author.userId, response.author.nickname),
      isMine: String(response.authorId) === myUserId(),
      body: response.body,
      record: recordOf(response),
      // There is no 코스도 함께 공유 flag; a run on a course shares it.
      courseShared: response.courseId != null,
      createdAt: response.createdAt,
      likeCount: null,
      liked: likes.get(id) ?? false,
      commentCount: null,
      bookmarked: bookmarks.has(id),
    };
  };

  const toComment = (
    response: CommentResponse,
    postAuthor: AuthorResponse,
  ): PostComment => {
    const me = String(response.authorId) === myUserId();
    const nickname =
      response.authorId === postAuthor.userId
        ? postAuthor.nickname
        : me
        ? myName
        : unknownAuthor;
    return {
      id: String(response.id),
      author: authorOf(response.authorId, nickname),
      isMine: me,
      body: response.body,
      createdAt: response.createdAt,
      // Comment likes have no API.
      likeCount: 0,
      liked: false,
    };
  };

  return {
    listFeed: async scope => {
      const items = listItems(
        await apiRequest<{ items: PostResponse[] }>('/posts', {
          query: { scope },
        }),
      );
      return items.map(toPost);
    },
    get: async postId => {
      const [post, commentsPage] = await Promise.all([
        apiRequest<PostResponse>(`/posts/${postId}`),
        apiRequest<{ items: CommentResponse[] }>(`/posts/${postId}/comments`),
      ]);
      const items = listItems(commentsPage);
      const base = toPost(post);
      // 7.2 shows the shared course on the real map (S15P31E105-561): its points from C03. A course that cannot
      // be read leaves the post without a route rather than failing the page.
      const route =
        post.courseId == null
          ? null
          : await apiRequest<CourseRouteResponse>(`/courses/${post.courseId}`)
              .then(course => course.route.coordinates)
              .catch(() => null);
      const detail: PostDetail = {
        ...base,
        record: { ...base.record, route },
        commentCount: items.length,
        comments: items.map(item => toComment(item, post.author)),
      };
      return detail;
    },
    // 7.3 shares one of my runs: the given one, or the newest.
    getShareable: async recordId => {
      const id = recordId ?? (await records.getRecent('recent', 1))[0]?.id;
      if (!id) {
        throw new Error('공유할 기록 없음');
      }
      const detail = await records.getDetail(id);
      return {
        ...detail,
        place: '',
        courseRun: detail.courseId !== null,
        route: detail.route,
        averageHeartRate: null,
        cadence: null,
      };
    },
    // CMT01 takes the run as its session id. 코스도 함께 공유 has no field, so it is not sent.
    create: async (recordId, draft) => {
      const { id } = await apiRequest<{ id: number }>('/posts', {
        method: 'POST',
        body: { sessionId: Number(recordId), body: draft.body },
      });
      return { id: String(id) };
    },
    update: async (postId, draft) => {
      await apiRequest(`/posts/${postId}`, {
        method: 'PATCH',
        body: { body: draft.body },
      });
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
    setBookmarked: async (postId, bookmarked) => {
      if (bookmarked) {
        bookmarks.add(postId);
      } else {
        bookmarks.delete(postId);
      }
    },
    addComment: async (postId, body) => {
      const comment = await apiRequest<CommentResponse>(
        `/posts/${postId}/comments`,
        { method: 'POST', body: { body } },
      );
      return {
        id: String(comment.id),
        author: authorOf(comment.authorId, myName),
        isMine: true,
        body: comment.body,
        createdAt: comment.createdAt,
        likeCount: 0,
        liked: false,
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
  };
}
