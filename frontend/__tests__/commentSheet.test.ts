import {
  countComments,
  createMockRepositories,
  DataError,
  threadComments,
  withoutComment,
  type PostComment,
} from '../src/data';
import {
  replyOpen,
  replyTargetOf,
  sheetFit,
} from '../src/screens/community/comments';

// S15P31E105-596: the 댓글 sheet sizes itself from its own window, which on Android may or may not shrink
// above the keyboard depending on the phone.
const base = { screen: 800, top: 40, bottom: 24 };

test('at rest the sheet takes two thirds of its window, over the bottom inset', () => {
  expect(sheetFit({ ...base, open: 780, frame: 780, keyboard: 0 })).toEqual({
    full: 780,
    height: Math.round(780 * 0.68),
    paddingBottom: 24,
  });
  // Before the window has laid out, the screen stands in.
  expect(sheetFit({ ...base, open: 0, frame: 0, keyboard: 0 }).height).toBe(
    Math.round(800 * 0.68),
  );
});

test('a window that stays full under the keyboard lifts the comment bar by the keyboard', () => {
  const fit = sheetFit({ ...base, open: 780, frame: 780, keyboard: 300 });
  expect(fit.height).toBe(780 - 40 - 8);
  expect(fit.paddingBottom).toBe(300);
});

test('a window that shrank above the keyboard does not lift the bar a second time', () => {
  const fit = sheetFit({ ...base, open: 780, frame: 480, keyboard: 300 });
  // The sheet fills the shrunk window up to the status bar, its bar right on the keyboard.
  expect(fit.height).toBe(480 - 40 - 8);
  expect(fit.paddingBottom).toBe(0);
});

// S15P31E105-633 대댓글 묶음.
const at = (minute: number) =>
  `2026-11-10T10:${String(minute).padStart(2, '0')}:00Z`;
const commentOf = (
  id: string,
  parentId: string | null,
  extra: Partial<PostComment> = {},
): PostComment => ({
  id,
  parentId,
  deleted: false,
  author: { userId: `u-${id}`, handle: `runner-${id}`, nickname: id },
  isMine: false,
  body: `body ${id}`,
  createdAt: at(Number(id)),
  likeCount: 0,
  liked: false,
  ...extra,
});
const placeOf = (comment: PostComment): PostComment => ({
  ...comment,
  deleted: true,
  author: null,
  body: '',
});

test('replies are grouped under their root even when the list comes in another order', () => {
  const list = [
    commentOf('1', null),
    commentOf('2', null),
    commentOf('3', '1'),
    commentOf('4', '2'),
    commentOf('5', '1'),
    // Its root is not in the list: it keeps its place instead of disappearing.
    commentOf('6', '99'),
  ];

  expect(
    threadComments(list).map(({ comment, reply }) => [comment.id, reply]),
  ).toEqual([
    ['1', false],
    ['3', true],
    ['5', true],
    ['2', false],
    ['4', true],
    ['6', false],
  ]);
});

test('a deleted root with replies stays as its place, without replies it leaves, and is never counted', () => {
  const list = [
    commentOf('1', null),
    commentOf('2', '1'),
    commentOf('3', null),
  ];

  const kept = withoutComment(list, '1', placeOf);
  expect(kept.map(item => [item.id, item.deleted])).toEqual([
    ['1', true],
    ['2', false],
    ['3', false],
  ]);
  expect(countComments(kept)).toBe(2);

  // The last reply going takes the deleted root's place with it.
  expect(withoutComment(kept, '2', placeOf).map(item => item.id)).toEqual([
    '3',
  ]);
  // A root without replies just leaves.
  expect(withoutComment(list, '3', placeOf).map(item => item.id)).toEqual([
    '1',
    '2',
  ]);
});

test('답글 달기 on a reply answers its root and names the reply author', () => {
  expect(replyTargetOf(commentOf('1', null))).toEqual({
    rootId: '1',
    handle: 'runner-1',
  });
  expect(replyTargetOf(commentOf('2', '1'))).toEqual({
    rootId: '1',
    handle: 'runner-2',
  });
});

test('답글 달기 is closed on a reply whose root is deleted or no longer listed', () => {
  const live = commentOf('1', null);
  const deleted = placeOf(commentOf('2', null));
  const list = [live, commentOf('3', '1'), deleted, commentOf('4', '2')];
  expect(replyOpen(live, list)).toBe(true);
  expect(replyOpen(list[1], list)).toBe(true);
  expect(replyOpen(list[3], list)).toBe(false);
  expect(replyOpen(commentOf('5', '9'), list)).toBe(false);
});

test('the mock rejects a reply to a deleted, absent or nested root with INVALID_PARENT_COMMENT, like CMT07', async () => {
  const { community } = createMockRepositories({ latencyMs: 0 });
  const postId = 'post-seoyun-1019';
  const root = await community.addComment(postId, '원댓글', null);
  const reply = await community.addComment(postId, '대댓글', root.id);
  expect(reply.parentId).toBe(root.id);
  const rejected = async (parentId: string) => {
    const error = await community
      .addComment(postId, '답글', parentId)
      .catch(caught => caught);
    expect(error).toBeInstanceOf(DataError);
    expect(error).toMatchObject({
      code: 'INVALID_PARENT_COMMENT',
      status: 422,
    });
  };
  // A reply is not a root, an unknown id is not one either.
  await rejected(reply.id);
  await rejected('comment-none');
  // The root deleted with a reply under it stays as its place, which takes no new replies.
  await community.removeComment(root.id);
  await rejected(root.id);
});
