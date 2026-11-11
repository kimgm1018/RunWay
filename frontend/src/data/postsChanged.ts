import type { Post } from './types';

// 7.1 keeps the posts it has read (and where it is in them) when it comes back from another screen; it reads its
// first page again only after a post was written, edited or deleted somewhere else (S15P31E105-647).
let changed = false;
// Counts the changes, so a first page read ahead (feedPrefetch) knows it is out of date.
let version = 0;

export function postsChanged() {
  changed = true;
  version += 1;
}

export function postsVersion() {
  return version;
}

// True once after postsChanged, so the next focus reads again and the one after keeps the list.
export function takePostsChanged() {
  const was = changed;
  changed = false;
  return was;
}

// A like, bookmark or comment count changed on 7.2: the feed shows it in place instead of reading again.
type PostChange = Partial<
  Pick<Post, 'liked' | 'likeCount' | 'bookmarked' | 'commentCount'>
>;
const listeners = new Set<(postId: string, change: PostChange) => void>();

// Returns the unsubscribe function, so it fits a useEffect cleanup.
export function onPostChanged(
  listener: (postId: string, change: PostChange) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function postChanged(postId: string, change: PostChange) {
  listeners.forEach(listener => listener(postId, change));
}
