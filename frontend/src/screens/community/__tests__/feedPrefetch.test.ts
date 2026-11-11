import { postsChanged, takePostsChanged } from '../../../data/postsChanged';
import type { PostPage, Repositories } from '../../../data/types';
import { prefetchFeed, takePrefetchedFeed } from '../feedPrefetch';

const page: PostPage = { items: [], nextCursor: null };

function community() {
  const listFeed = jest.fn(async () => page);
  const getRoute = jest.fn(async () => null);
  return {
    listFeed,
    getRoute,
    repo: { listFeed, getRoute } as unknown as Repositories['community'],
  };
}

afterEach(() => {
  takePrefetchedFeed();
  takePostsChanged();
});

test('the first 전체 page read ahead is used once', async () => {
  const { listFeed, repo } = community();
  prefetchFeed(repo, 1000);
  prefetchFeed(repo, 2000);
  expect(listFeed).toHaveBeenCalledTimes(1);
  expect(listFeed).toHaveBeenCalledWith('ALL', null);
  await expect(takePrefetchedFeed(3000)).resolves.toBe(page);
  expect(takePrefetchedFeed(3000)).toBeNull();
});

test('a page read ahead more than a minute ago is not used', () => {
  const { repo } = community();
  prefetchFeed(repo, 0);
  expect(takePrefetchedFeed(60_000)).toBeNull();
});

test('a post written after the read ahead makes it out of date', () => {
  const { repo } = community();
  prefetchFeed(repo, 0);
  postsChanged();
  expect(takePrefetchedFeed(1)).toBeNull();
});

test('the first shared courses are read ahead too', async () => {
  const { listFeed, getRoute, repo } = community();
  const post = (id: string, courseShared: boolean) => ({
    id,
    courseShared,
    record: { route: null },
  });
  listFeed.mockResolvedValueOnce({
    ...page,
    items: [post('1', true), post('2', false), post('3', true)],
  } as unknown as PostPage);
  prefetchFeed(repo, 0);
  await takePrefetchedFeed(1);
  expect(getRoute.mock.calls).toEqual([['1']]);
});

test('gives the first readable shared course of the first posts, for the warm map', async () => {
  const { listFeed, getRoute, repo } = community();
  const post = (id: string, courseShared: boolean) => ({
    id,
    courseShared,
    record: { route: null },
  });
  const route = [
    [129.06, 35.15],
    [129.07, 35.16],
  ];
  listFeed.mockResolvedValueOnce({
    ...page,
    items: [post('1', false), post('2', true), post('3', true)],
  } as unknown as PostPage);
  getRoute.mockResolvedValueOnce({ route } as never);
  const course = prefetchFeed(repo, 0);
  // Asked again while fresh, the same course.
  expect(prefetchFeed(repo, 1)).toBe(course);
  await expect(course).resolves.toEqual(route);
  expect(getRoute.mock.calls).toEqual([['2']]);
});

test('no warm course when the first page cannot be read', async () => {
  const { listFeed, repo } = community();
  listFeed.mockRejectedValueOnce(new Error('offline'));
  await expect(prefetchFeed(repo, 0)).resolves.toBeNull();
});
