// 대댓글 묶음 (S15P31E105-633): CMT06 lists comments flat, each root followed by its replies. The app groups them
// by parentId itself so a list in another order still shows every reply under its root.

type ThreadItem = { id: string; parentId: string | null; deleted: boolean };

// Each root followed by its replies, both in the order given. A reply whose root is not in the list keeps its
// place as if it were a root rather than disappearing.
export function threadComments<T extends ThreadItem>(comments: T[]) {
  const ids = new Set(comments.map(comment => comment.id));
  const isRoot = (comment: T) =>
    !comment.parentId || !ids.has(comment.parentId);
  return comments
    .filter(isRoot)
    .flatMap(root => [
      { comment: root, reply: false },
      ...comments
        .filter(comment => comment.parentId === root.id)
        .map(comment => ({ comment, reply: true })),
    ]);
}

// The comments a post counts: a deleted root kept for its replies is not one.
export const countComments = (comments: ThreadItem[]) =>
  comments.filter(comment => !comment.deleted).length;

// CMT09 (D-1): a root with replies turns into the deleted place, any other comment leaves, and a deleted place
// left without replies leaves too.
export function withoutComment<T extends ThreadItem>(
  comments: T[],
  commentId: string,
  placeholder: (comment: T) => T,
) {
  const replied = (rootId: string, list: T[]) =>
    list.some(item => item.parentId === rootId);
  const next = comments.flatMap(item => {
    if (item.id !== commentId) {
      return [item];
    }
    return !item.parentId && replied(item.id, comments)
      ? [placeholder(item)]
      : [];
  });
  return next.filter(item => !item.deleted || replied(item.id, next));
}
