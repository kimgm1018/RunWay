import { postsVersion } from '../../data/postsChanged';
import type { PostPage, Repositories } from '../../data/types';

// 7.1's first page read ahead while the user is still on another tab (사용자 요청: 커뮤니티 첫 진입을 빠르게), with
// the shared courses of its first posts, so entering 커뮤니티 starts drawing at once. It is used once, only while
// fresh and only if no post was written, edited or deleted since it was read.
const freshFor = 60_000;
// The posts whose course is read ahead: the first page on screen and the one under it.
const routesAhead = 2;

type Ahead = { at: number; version: number; page: Promise<PostPage> };
let ahead: Ahead | null = null;

export function prefetchFeed(
  community: Repositories['community'],
  now = Date.now(),
) {
  if (ahead && now - ahead.at < freshFor && ahead.version === postsVersion()) {
    return;
  }
  const page = community.listFeed('ALL', null);
  const read: Ahead = { at: now, version: postsVersion(), page };
  ahead = read;
  page.then(
    ({ items }) => {
      for (const post of items.slice(0, routesAhead)) {
        if (post.courseShared && !post.record.route) {
          community.getRoute(post.id).catch(() => undefined);
        }
      }
    },
    () => {
      if (ahead === read) {
        ahead = null;
      }
    },
  );
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
