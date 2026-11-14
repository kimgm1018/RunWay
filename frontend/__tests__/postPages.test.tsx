import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createMockRepositories,
  DataProvider,
  type Post,
  type PostPage,
  type Repositories,
} from '../src/data';
import { postChanges } from '../src/screens/community/parts';
import {
  usePostListChanges,
  usePostPages,
  type PostListKind,
  type PostPageLoad,
  type PostPages,
} from '../src/screens/community/usePostPages';

// S15P31E105-647: the page logic for 7.1 and the profile's 저장 · 좋아요 · 게시물 lists.

let base: Post;

beforeAll(async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  base = (await repositories.community.listFeed('ALL')).items[0];
});

const postOf = (id: string, change: Partial<Post> = {}): Post => ({
  ...base,
  id,
  ...change,
});

const pageOf = (ids: string[], nextCursor: string | null): PostPage => ({
  items: ids.map(id => postOf(id)),
  nextCursor,
});

type Deferred = {
  cursor: string | null;
  resolve: (page: PostPage) => void;
  reject: (error: Error) => void;
};

// A load whose every call waits until the test answers it.
function controlledLoad() {
  const calls: Deferred[] = [];
  const load = jest.fn(
    (cursor: string | null) =>
      new Promise<PostPage>((resolve, reject) => {
        calls.push({ cursor, resolve, reject });
      }),
  );
  return { load, calls };
}

let mounted: TestRenderer.ReactTestRenderer | null = null;

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

function Harness({
  load,
  kind,
  out,
}: {
  load: PostPageLoad;
  kind: PostListKind;
  out: {
    pages?: PostPages;
    like?: (post: Post) => Promise<void>;
    bookmark?: (post: Post) => Promise<void>;
  };
}) {
  const pages = usePostPages(load);
  const { like, bookmark } = usePostListChanges(pages, kind);
  out.pages = pages;
  out.like = like;
  out.bookmark = bookmark;
  return null;
}

async function render(
  load: PostPageLoad,
  kind: PostListKind = 'feed',
  repositories: Repositories = createMockRepositories({ latencyMs: 0 }),
) {
  const out: React.ComponentProps<typeof Harness>['out'] = {};
  const element = (current: PostPageLoad) => (
    <DataProvider repositories={repositories}>
      <Harness load={current} kind={kind} out={out} />
    </DataProvider>
  );
  await act(async () => {
    mounted = TestRenderer.create(element(load));
  });
  const screen = mounted!;
  return {
    out,
    pages: () => out.pages!,
    setLoad: async (next: PostPageLoad) => {
      await act(async () => screen.update(element(next)));
    },
  };
}

async function answer(call: Deferred, page: PostPage | Error) {
  await act(async () => {
    if (page instanceof Error) {
      call.reject(page);
    } else {
      call.resolve(page);
    }
  });
}

const ids = (pages: PostPages) => pages.posts.map(post => post.id);

test('reads the first page, then the next ones from the cursor, and nothing after the last', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  expect(pages().status).toBe('loading');
  expect(calls.map(call => call.cursor)).toEqual([null]);

  await answer(calls[0], pageOf(['1', '2'], 'c1'));
  expect(pages()).toMatchObject({
    status: 'ready',
    hasMore: true,
    empty: false,
  });

  await act(async () => pages().loadMore());
  expect(pages().loadingMore).toBe(true);
  await answer(calls[1], pageOf(['3', '4'], null));
  expect(ids(pages())).toEqual(['1', '2', '3', '4']);
  expect(pages()).toMatchObject({ hasMore: false, loadingMore: false });

  // The last page: no more requests.
  await act(async () => pages().loadMore());
  expect(calls.map(call => call.cursor)).toEqual([null, 'c1']);
});

test('loadMore is ignored while a page is on its way, and before the first page is in', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await act(async () => pages().loadMore());
  expect(calls).toHaveLength(1);

  await answer(calls[0], pageOf(['1'], 'c1'));
  await act(async () => {
    pages().loadMore();
    pages().loadMore();
    pages().loadMore();
  });
  expect(calls.map(call => call.cursor)).toEqual([null, 'c1']);

  // A post that comes again on the next page is listed once.
  await answer(calls[1], pageOf(['1', '2'], 'c2'));
  expect(ids(pages())).toEqual(['1', '2']);
});

test('an empty first page is empty and asks nothing more', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf([], null));

  expect(pages()).toMatchObject({
    status: 'ready',
    empty: true,
    hasMore: false,
  });
  await act(async () => pages().loadMore());
  expect(calls).toHaveLength(1);
});

test('refresh keeps the list on screen and goes back to the first page; a page asked before it is dropped', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1', '2'], 'c1'));
  await act(async () => pages().loadMore());

  let refreshed = false;
  await act(async () => {
    pages()
      .refresh()
      .then(() => {
        refreshed = true;
      });
  });
  expect(calls.map(call => call.cursor)).toEqual([null, 'c1', null]);
  expect(pages()).toMatchObject({ status: 'ready' });
  expect(ids(pages())).toEqual(['1', '2']);

  // The old second page comes late: it belongs to the list before the refresh.
  await answer(calls[1], pageOf(['3'], 'old'));
  expect(ids(pages())).toEqual(['1', '2']);

  await answer(calls[2], pageOf(['0', '1'], 'n1'));
  expect(refreshed).toBe(true);
  expect(ids(pages())).toEqual(['0', '1']);
  await act(async () => pages().loadMore());
  expect(calls[3].cursor).toBe('n1');
});

test('a failed refresh keeps the list read so far and its next page', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1', '2'], 'c1'));
  await act(async () => pages().loadMore());
  await answer(calls[1], pageOf(['3'], 'c2'));

  let result: string | undefined;
  await act(async () => {
    pages()
      .refresh()
      .then(value => {
        result = value;
      });
  });
  await answer(calls[2], new Error('offline'));

  expect(result).toBe('failed');
  expect(pages()).toMatchObject({
    status: 'ready',
    error: null,
    hasMore: true,
    loadingMore: false,
  });
  expect(ids(pages())).toEqual(['1', '2', '3']);
  // The next page is still the one after the list on screen.
  await act(async () => pages().loadMore());
  expect(calls.map(call => call.cursor)).toEqual([null, 'c1', null, 'c2']);
  await answer(calls[3], pageOf(['4'], null));
  expect(ids(pages())).toEqual(['1', '2', '3', '4']);
});

test('a refresh that fails while a next page is on its way keeps that page to ask again', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1'], 'c1'));
  await act(async () => pages().loadMore());

  let result: string | undefined;
  await act(async () => {
    pages()
      .refresh()
      .then(value => {
        result = value;
      });
  });
  await answer(calls[2], new Error('offline'));
  // The page asked before the refresh belongs to the old read and is dropped.
  await answer(calls[1], pageOf(['2'], 'c2'));

  expect(result).toBe('failed');
  expect(ids(pages())).toEqual(['1']);
  await act(async () => pages().loadMore());
  expect(calls[3].cursor).toBe('c1');
});

test('a refresh before any list is shown fails to the error screen', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], new Error('offline'));
  await act(async () => {
    pages().refresh();
  });
  await answer(calls[1], new Error('offline'));
  expect(pages().status).toBe('error');
});

test('refresh says whether it came in, and a newer read drops it', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1'], null));
  const results: string[] = [];
  await act(async () => {
    pages()
      .refresh()
      .then(value => results.push(value));
    pages()
      .refresh()
      .then(value => results.push(value));
  });
  await answer(calls[1], pageOf(['old'], null));
  await answer(calls[2], pageOf(['new'], null));
  expect(results).toEqual(['dropped', 'refreshed']);
  expect(ids(pages())).toEqual(['new']);
});

test('a new load (scope) starts from its first page and drops what the old one still sends', async () => {
  const first = controlledLoad();
  const second = controlledLoad();
  const { pages, setLoad } = await render(first.load);
  await answer(first.calls[0], pageOf(['a1'], 'a-next'));
  await act(async () => pages().loadMore());

  await setLoad(second.load);
  expect(pages()).toMatchObject({ status: 'loading', posts: [] });
  expect(second.calls.map(call => call.cursor)).toEqual([null]);

  await answer(first.calls[1], pageOf(['a2'], null));
  expect(pages().posts).toEqual([]);

  await answer(second.calls[0], pageOf(['b1'], null));
  expect(ids(pages())).toEqual(['b1']);
});

test('a failed first page shows the error and retry reads it again', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], new Error('offline'));
  expect(pages()).toMatchObject({ status: 'error' });
  expect(pages().error?.message).toBe('offline');

  await act(async () => pages().retry());
  expect(pages().status).toBe('loading');
  await answer(calls[1], pageOf(['1'], null));
  expect(pages()).toMatchObject({ status: 'ready', error: null });
  expect(calls.map(call => call.cursor)).toEqual([null, null]);
});

test('a failed next page keeps the list, and retry asks for the same page again', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1'], 'c1'));
  await act(async () => pages().loadMore());
  await answer(calls[1], new Error('timeout'));

  expect(pages()).toMatchObject({ status: 'ready', loadingMore: false });
  expect(pages().moreError?.message).toBe('timeout');
  expect(ids(pages())).toEqual(['1']);

  await act(async () => pages().retry());
  expect(calls[2].cursor).toBe('c1');
  await answer(calls[2], pageOf(['2'], null));
  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().moreError).toBeNull();
});

test('remove and replace change the list at once', async () => {
  const { load, calls } = controlledLoad();
  const { pages } = await render(load);
  await answer(calls[0], pageOf(['1', '2', '3'], null));

  await act(async () => pages().remove('2'));
  expect(ids(pages())).toEqual(['1', '3']);

  await act(async () =>
    pages().replace(postOf('3', { liked: true, likeCount: 99 })),
  );
  expect(pages().posts[1]).toMatchObject({
    id: '3',
    liked: true,
    likeCount: 99,
  });
  // A post no longer listed is not brought back.
  await act(async () => pages().replace(postOf('2')));
  expect(ids(pages())).toEqual(['1', '3']);
});

// D-2: in 내 스크랩, a bookmark taken back leaves the list once the server takes it; in 좋아요 the same for a like.
function withCommunity(change: Partial<Repositories['community']>) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  return {
    ...repositories,
    community: { ...repositories.community, ...change },
  };
}

async function listOf(
  kind: PostListKind,
  change: Partial<Repositories['community']>,
) {
  const { load, calls } = controlledLoad();
  const view = await render(load, kind, withCommunity(change));
  await answer(calls[0], {
    items: [
      postOf('1', { bookmarked: true, liked: true, likeCount: 3 }),
      postOf('2', { bookmarked: true, liked: true, likeCount: 1 }),
    ],
    nextCursor: null,
  });
  return view;
}

test('내 스크랩: taking a bookmark back removes the post once the server takes it', async () => {
  let finish: () => void = () => {};
  const setBookmarked = jest.fn(
    () => new Promise<void>(resolve => (finish = resolve)),
  );
  const { pages, out } = await listOf('bookmarks', { setBookmarked });

  let done: Promise<void>;
  await act(async () => {
    done = out.bookmark!(pages().posts[0]);
  });
  // Shown taken back at once, still listed until the server answers.
  expect(pages().posts[0]).toMatchObject({ id: '1', bookmarked: false });
  await act(async () => {
    finish();
    await done;
  });
  expect(setBookmarked).toHaveBeenCalledWith('1', false);
  expect(ids(pages())).toEqual(['2']);
});

test('내 스크랩: a refused take-back keeps the post bookmarked in the list', async () => {
  const setBookmarked = jest.fn(async () => {
    throw new Error('offline');
  });
  const { pages, out } = await listOf('bookmarks', { setBookmarked });

  await act(async () => out.bookmark!(pages().posts[0]));

  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().posts[0].bookmarked).toBe(true);
});

test('좋아요: an unlike removes the post on success and keeps it, count and all, on failure', async () => {
  const setLiked = jest
    .fn<Promise<void>, [string, boolean]>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const { pages, out } = await listOf('likes', { setLiked });

  await act(async () => out.like!(pages().posts[0]));
  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().posts[0]).toMatchObject({ liked: true, likeCount: 3 });

  await act(async () => out.like!(pages().posts[0]));
  expect(setLiked).toHaveBeenLastCalledWith('1', false);
  expect(ids(pages())).toEqual(['2']);
});

test('좋아요 list keeps a post whose bookmark is taken back, and the feed keeps both', async () => {
  const setBookmarked = jest.fn(async () => {});
  const likes = await listOf('likes', { setBookmarked });
  await act(async () => likes.out.bookmark!(likes.pages().posts[0]));
  expect(ids(likes.pages())).toEqual(['1', '2']);
  expect(likes.pages().posts[0].bookmarked).toBe(false);
  await act(async () => mounted!.unmount());
  mounted = null;

  const setLiked = jest.fn(async () => {});
  const feed = await listOf('feed', { setBookmarked, setLiked });
  await act(async () => feed.out.bookmark!(feed.pages().posts[0]));
  await act(async () => feed.out.like!(feed.pages().posts[1]));
  expect(ids(feed.pages())).toEqual(['1', '2']);
  expect(feed.pages().posts[1]).toMatchObject({ liked: false, likeCount: 0 });
});

// A server call per tap that waits until the test answers it.
function controlledToggle() {
  const calls: {
    value: boolean;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  const send = jest.fn(
    (_postId: string, value: boolean) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { send, calls };
}

test('내 스크랩: taken back and bookmarked again before the server answers keeps the post', async () => {
  const { send, calls } = controlledToggle();
  const { pages, out } = await listOf('bookmarks', { setBookmarked: send });

  let first: Promise<void>;
  let second: Promise<void>;
  await act(async () => {
    first = out.bookmark!(pages().posts[0]);
  });
  await act(async () => {
    second = out.bookmark!(pages().posts[0]);
  });
  // Shown bookmarked again at once; one request at a time.
  expect(pages().posts[0]).toMatchObject({ id: '1', bookmarked: true });
  expect(calls.map(call => call.value)).toEqual([false]);

  // The take-back succeeds late: the post stays, and the last tap goes to the server.
  await act(async () => calls[0].resolve());
  expect(ids(pages())).toEqual(['1', '2']);
  expect(calls.map(call => call.value)).toEqual([false, true]);
  await act(async () => {
    calls[1].resolve();
    await first;
    await second;
  });
  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().posts[0].bookmarked).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
});

test('내 스크랩: a tap back and forth that ends taken back removes the post once', async () => {
  const { send, calls } = controlledToggle();
  const { pages, out } = await listOf('bookmarks', { setBookmarked: send });

  let done: Promise<void>;
  await act(async () => {
    done = out.bookmark!(pages().posts[0]);
  });
  await act(async () => {
    out.bookmark!(pages().posts[0]);
  });
  await act(async () => {
    out.bookmark!(pages().posts[0]);
  });
  expect(pages().posts[0].bookmarked).toBe(false);

  // The server already holds the last tap: nothing more is sent and the post leaves.
  await act(async () => {
    calls[0].resolve();
    await done;
  });
  expect(calls.map(call => call.value)).toEqual([false]);
  expect(ids(pages())).toEqual(['2']);
});

test('좋아요: unliked and liked again before the server answers keeps the post and its count', async () => {
  const { send, calls } = controlledToggle();
  const { pages, out } = await listOf('likes', { setLiked: send });

  let done: Promise<void>;
  await act(async () => {
    done = out.like!(pages().posts[0]);
  });
  expect(pages().posts[0]).toMatchObject({ liked: false, likeCount: 2 });
  await act(async () => {
    out.like!(pages().posts[0]);
  });
  expect(pages().posts[0]).toMatchObject({ liked: true, likeCount: 3 });

  await act(async () => calls[0].resolve());
  await act(async () => {
    calls[1].resolve();
    await done;
  });
  expect(calls.map(call => call.value)).toEqual([false, true]);
  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().posts[0]).toMatchObject({ liked: true, likeCount: 3 });
});

test('내 스크랩: when the second request fails the list shows what the server holds', async () => {
  const { send, calls } = controlledToggle();
  const { pages, out } = await listOf('bookmarks', { setBookmarked: send });

  let done: Promise<void>;
  await act(async () => {
    done = out.bookmark!(pages().posts[0]);
  });
  await act(async () => {
    out.bookmark!(pages().posts[0]);
  });
  await act(async () => calls[0].resolve());
  await act(async () => {
    calls[1].reject(new Error('offline'));
    await done;
  });
  // The server took the bookmark back and kept it so: shown taken back, still listed until the next read.
  expect(ids(pages())).toEqual(['1', '2']);
  expect(pages().posts[0].bookmarked).toBe(false);
});

test('postChanges shows a bookmark at once and puts it back when CMT16 fails', async () => {
  const shown: boolean[] = [];
  const community = {
    setLiked: jest.fn(async () => {}),
    setBookmarked: jest.fn(async () => {
      throw new Error('offline');
    }),
  };
  const { bookmark } = postChanges(community, post =>
    shown.push(post.bookmarked),
  );

  await bookmark(postOf('1', { bookmarked: false }));

  expect(community.setBookmarked).toHaveBeenCalledWith('1', true);
  expect(shown).toEqual([true, false]);
});

// The mock repository pages the same way, so the app without a server behaves as with one.
test('the mock pages 20 at a time and keeps 내 스크랩 · 좋아요 in the order they were made', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const { community } = repositories;
  const feed = await community.listFeed('ALL');
  expect(feed.items.length).toBeGreaterThan(0);
  expect(feed.items.length).toBeLessThanOrEqual(20);

  const bookmarked = (await community.listMyBookmarks()).items.map(
    post => post.id,
  );
  expect(bookmarked.length).toBeGreaterThan(0);
  const target = feed.items.find(post => !post.bookmarked)!;
  await community.setBookmarked(target.id, true);
  const after = await community.listMyBookmarks();
  expect(after.items.map(post => post.id)).toEqual([target.id, ...bookmarked]);
  expect(after.items[0].bookmarked).toBe(true);
  // It stays bookmarked on the next read of the feed.
  expect(
    (await community.listFeed('ALL')).items.find(post => post.id === target.id)
      ?.bookmarked,
  ).toBe(true);

  await community.setBookmarked(target.id, false);
  expect(
    (await community.listMyBookmarks()).items.map(post => post.id),
  ).toEqual(bookmarked);

  const liked = (await community.listMyLikes()).items.map(post => post.id);
  await community.setLiked(liked[0], false);
  expect((await community.listMyLikes()).items.map(post => post.id)).toEqual(
    liked.slice(1),
  );

  const author = feed.items[0].author.userId;
  const authored = await community.listAuthorPosts(author);
  expect(authored.items.every(post => post.author.userId === author)).toBe(
    true,
  );
});

test('the mock reads past 20 with the cursor and a post taken out between pages skips nothing', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const { community, run } = repositories;
  // 25 more of my posts, so the feed has more than a page. A run has one post (S15P31E105-830), so each shares a
  // run of its own.
  for (let index = 0; index < 25; index += 1) {
    const { recordId } = await run.saveRecord({
      mode: 'FREE',
      courseId: null,
      groupRunId: null,
      startedAt: '2026-10-01T06:00:00+09:00',
      durationSec: 1800,
      distanceM: 5000,
      averagePaceSecPerKm: 360,
      averageHeartRate: null,
      averageCadence: null,
      route: null,
      goalDistanceM: null,
      goalPaceSecPerKm: null,
      sessionId: null,
    });
    await community.create(recordId!, {
      body: `post ${index}`,
      courseShared: false,
    });
  }
  const first = await community.listFeed('ALL');
  expect(first.items).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const rest = await community.listFeed('ALL', first.nextCursor);
  expect(rest.nextCursor).toBeNull();

  // The last post of the first page goes before the next page is read.
  await community.remove(first.items[19].id);
  const second = await community.listFeed('ALL', first.nextCursor);
  expect(second.items.map(post => post.id)).toEqual(
    rest.items.map(post => post.id),
  );
});
