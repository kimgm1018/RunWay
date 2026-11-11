import { useCallback, useEffect, useRef, useState } from 'react';
import type { Post, PostPage } from '../../data';
import { usePostChanges, type PostChangeOptions } from './parts';

// Reads one page of posts from the cursor (null for the first page): CMT02 by scope or author, CMT18, CMT19.
// Pass a stable function (useCallback); a new one starts the list again from its first page.
export type PostPageLoad = (cursor: string | null) => Promise<PostPage>;

// How a refresh ended: the first page is in, it failed (the list read so far stays), or a newer read took over.
export type PostRefresh = 'refreshed' | 'failed' | 'dropped';

export type PostPages = {
  // loading: the first page of this list is on its way (nothing to show yet). A refresh keeps the list ready,
  // and a refresh that fails keeps it ready too (error is only for a first page that never came).
  status: 'loading' | 'error' | 'ready';
  posts: Post[];
  // Ready with no posts at all.
  empty: boolean;
  // There is a next page to read.
  hasMore: boolean;
  loadingMore: boolean;
  // Why the first page failed.
  error: Error | null;
  // Why the last loadMore failed; loadMore or retry tries the same page again.
  moreError: Error | null;
  // Reads the next page; does nothing while a page is on its way or after the last page.
  loadMore: () => void;
  // Reads the first page again with the current list kept on screen; settles when it is in or failed (never
  // rejects). On failure the list and the next page's cursor stay as they were.
  refresh: () => Promise<PostRefresh>;
  // After an error: the first page again, or the page that failed.
  retry: () => void;
  // Takes a post out of the list at once (a deleted post, or one I took back in 내 스크랩 · 좋아요).
  remove: (postId: string) => void;
  // Puts the changed post in place of the one with its id (likes, bookmarks).
  replace: (post: Post) => void;
  // Changes the post with that id, if it is still in the list (the comment count).
  update: (postId: string, change: (post: Post) => Post) => void;
};

type State = {
  status: PostPages['status'];
  posts: Post[];
  hasMore: boolean;
  loadingMore: boolean;
  error: Error | null;
  moreError: Error | null;
};

const initial: State = {
  status: 'loading',
  posts: [],
  hasMore: false,
  loadingMore: false,
  error: null,
  moreError: null,
};

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

// A post already listed is not listed twice when the pages overlap (a post written between two reads).
function appended(posts: Post[], more: Post[]) {
  const seen = new Set(posts.map(post => post.id));
  return [...posts, ...more.filter(post => !seen.has(post.id))];
}

// S15P31E105-647: a list of posts read 20 at a time with the server's cursor, for 7.1 and the profile's 저장 ·
// 좋아요 · 게시물 lists. A response that comes back after a refresh, a new list or unmount is dropped.
export function usePostPages(load: PostPageLoad): PostPages {
  const [state, setState] = useState<State>(initial);
  // The first page (or a refresh) failed on screen: retry reads it again.
  const failedFirst = useRef(false);
  failedFirst.current = state.status === 'error';
  // The list on screen, so a failed refresh can put back what it had.
  const shown = useRef(state);
  shown.current = state;
  const loadRef = useRef(load);
  loadRef.current = load;
  // Each first-page read starts a new generation; a response from an older one is stale.
  const generation = useRef(0);
  // The cursor of the next page (null before the first page and after the last).
  const cursor = useRef<string | null>(null);
  // A page on its way: loadMore waits for it.
  const busy = useRef(false);

  const loadFirst = useCallback((keep: boolean): Promise<PostRefresh> => {
    const current = ++generation.current;
    // A refresh over a list on screen keeps it, and its next page, if the first page fails.
    const kept =
      keep && shown.current.status === 'ready'
        ? { cursor: cursor.current, moreError: shown.current.moreError }
        : null;
    cursor.current = null;
    busy.current = true;
    if (keep) {
      setState(value => ({ ...value, loadingMore: false, moreError: null }));
    } else {
      setState(initial);
    }
    return loadRef.current(null).then(
      page => {
        if (current !== generation.current) {
          return 'dropped';
        }
        busy.current = false;
        cursor.current = page.nextCursor;
        setState({
          ...initial,
          status: 'ready',
          posts: appended([], page.items),
          hasMore: page.nextCursor !== null,
        });
        return 'refreshed';
      },
      error => {
        if (current !== generation.current) {
          return 'dropped';
        }
        busy.current = false;
        if (kept) {
          cursor.current = kept.cursor;
          setState(value => ({
            ...value,
            status: 'ready',
            loadingMore: false,
            moreError: kept.moreError,
          }));
          return 'failed';
        }
        setState(value => ({
          ...value,
          status: 'error',
          error: asError(error),
          loadingMore: false,
        }));
        return 'failed';
      },
    );
  }, []);

  useEffect(() => {
    loadFirst(false);
    return () => {
      // Whatever is still on its way belongs to the list that left.
      generation.current += 1;
    };
  }, [load, loadFirst]);

  const loadMore = useCallback(() => {
    const from = cursor.current;
    if (busy.current || from === null) {
      return;
    }
    const current = generation.current;
    busy.current = true;
    setState(value => ({ ...value, loadingMore: true, moreError: null }));
    loadRef.current(from).then(
      page => {
        if (current !== generation.current) {
          return;
        }
        busy.current = false;
        cursor.current = page.nextCursor;
        setState(value => ({
          ...value,
          posts: appended(value.posts, page.items),
          hasMore: page.nextCursor !== null,
          loadingMore: false,
        }));
      },
      error => {
        if (current !== generation.current) {
          return;
        }
        busy.current = false;
        setState(value => ({
          ...value,
          loadingMore: false,
          moreError: asError(error),
        }));
      },
    );
  }, []);

  const refresh = useCallback(() => loadFirst(true), [loadFirst]);

  const retry = useCallback(() => {
    if (failedFirst.current) {
      loadFirst(false);
    } else {
      loadMore();
    }
  }, [loadFirst, loadMore]);

  const remove = useCallback(
    (postId: string) =>
      setState(value => ({
        ...value,
        posts: value.posts.filter(post => post.id !== postId),
      })),
    [],
  );
  const update = useCallback(
    (postId: string, change: (post: Post) => Post) =>
      setState(value => ({
        ...value,
        posts: value.posts.map(post =>
          post.id === postId ? change(post) : post,
        ),
      })),
    [],
  );
  const replace = useCallback(
    (next: Post) => update(next.id, () => next),
    [update],
  );

  return {
    ...state,
    empty: state.status === 'ready' && state.posts.length === 0,
    loadMore,
    refresh,
    retry,
    remove,
    replace,
    update,
  };
}

// Which list the posts are in: 내 스크랩 and 좋아요 hold only what I still keep there.
export type PostListKind = 'feed' | 'author' | 'bookmarks' | 'likes';

// S15P31E105-647 D-2: in 내 스크랩, a bookmark taken back leaves the list as soon as the server takes it back
// (it stays when that fails); in 좋아요 the same for a like taken back.
export function postListChangeOptions(
  kind: PostListKind,
  pages: Pick<PostPages, 'remove'>,
): PostChangeOptions {
  if (kind === 'bookmarks') {
    return { onUnbookmarked: post => pages.remove(post.id) };
  }
  if (kind === 'likes') {
    return { onUnliked: post => pages.remove(post.id) };
  }
  return {};
}

// like and bookmark for the posts of one list: shown at once, rolled back on failure, and taken out of 내 스크랩 ·
// 좋아요 when taken back there.
export function usePostListChanges(
  pages: Pick<PostPages, 'remove' | 'replace'>,
  kind: PostListKind,
) {
  return usePostChanges(pages.replace, postListChangeOptions(kind, pages));
}
