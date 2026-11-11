import { postsVersion } from '../../data/postsChanged';
import type { PostPage, Repositories } from '../../data/types';
import type { LngLat } from '../../geo';

// 7.1's first page read ahead while the user is still on another tab (사용자 요청: 커뮤니티 첫 진입을 빠르게), with
// the shared courses of its first posts, so entering 커뮤니티 starts drawing at once. It is used once, only while
// fresh and only if no post was written, edited or deleted since it was read.
const freshFor = 60_000;
// The posts whose course is read ahead: the first page on screen and the one under it.
const routesAhead = 2;

type Ahead = {
  at: number;
  version: number;
  page: Promise<PostPage>;
  course: Promise<LngLat[] | null>;
};
let ahead: Ahead | null = null;

// Reads the first page ahead and gives the course the feed's first real map will draw: the first of those
// posts that shares one (S15P31E105-665, 첫 지도 미리 데우기). Null when none does or it cannot be read.
export function prefetchFeed(
  community: Repositories['community'],
  now = Date.now(),
): Promise<LngLat[] | null> {
  if (ahead && now - ahead.at < freshFor && ahead.version === postsVersion()) {
    return ahead.course;
  }
  const page = community.listFeed('ALL', null);
  const routes = page.then(({ items }) =>
    items
      .slice(0, routesAhead)
      .filter(post => post.courseShared)
      .map(post =>
        post.record.route
          ? Promise.resolve(post.record.route)
          : community
              .getRoute(post.id)
              .then(map => map?.route ?? null)
              .catch(() => null),
      ),
  );
  const course = routes.then(
    async reads => {
      for (const read of reads) {
        const route = await read;
        if (route && route.length >= 2) {
          return route;
        }
      }
      return null;
    },
    () => null,
  );
  const read: Ahead = { at: now, version: postsVersion(), page, course };
  ahead = read;
  page.catch(() => {
    if (ahead === read) {
      ahead = null;
    }
  });
  return course;
}

// The first page read ahead, once; null when there is none to use.
export function takePrefetchedFeed(now = Date.now()): Promise<PostPage> | null {
  const read = ahead;
  ahead = null;
  if (!read || now - read.at >= freshFor || read.version !== postsVersion()) {
    return null;
  }
  return read.page;
}
