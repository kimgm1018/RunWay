import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  createMockRepositories,
  DataProvider,
  type Post,
  type PostComment,
} from '../../../data';
import {
  COMMENT_FOLD_LINES,
  COMMENT_LIMIT,
  CommentRow,
  CommentSheet,
  longComment,
} from '../comments';

// S15P31E105-780: quick taps on 게시 send one comment, the bar stops at COMMENT_LIMIT and long comments fold.

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });

async function openSheet() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const feed = await repositories.community.listFeed('ALL', null);
  const post = feed.items[0] as Post;
  let finish: (comment: PostComment) => void = () => {};
  const addComment = jest.fn(
    (_postId: string, body: string) =>
      new Promise<PostComment>(resolve => {
        finish = resolve;
        void body;
      }),
  );
  repositories.community.addComment = addComment;
  let root!: ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <DataProvider repositories={repositories}>
          <CommentSheet
            post={post}
            onClose={() => {}}
            onCountChange={() => {}}
          />
        </DataProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
  return { root, addComment, finish: (c: PostComment) => finish(c) };
}

const sendButton = (root: ReactTestRenderer) =>
  root.root.find(
    node =>
      node.props.accessibilityLabel === '게시' &&
      typeof node.props.onPress === 'function',
  );

describe('comment sheet sending', () => {
  it('sends one comment however quickly 게시 is pressed again', async () => {
    const { root, addComment } = await openSheet();
    const input = root.root.findByType(TextInput);
    act(() => input.props.onChangeText('연타'));
    const press = sendButton(root).props.onPress;
    await act(async () => {
      press();
      press();
      press();
    });
    expect(addComment).toHaveBeenCalledTimes(1);
    expect(addComment.mock.calls[0][1]).toBe('연타');
  });

  it('stops the bar at the limit and shows the count near it', async () => {
    const { root } = await openSheet();
    const input = root.root.findByType(TextInput);
    expect(input.props.maxLength).toBe(COMMENT_LIMIT);
    act(() => input.props.onChangeText('가'.repeat(COMMENT_LIMIT - 10)));
    const texts = root.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain(`${COMMENT_LIMIT - 10}/${COMMENT_LIMIT}`);
  });
});

describe('long comments', () => {
  it('folds long or many-line comments only', () => {
    expect(longComment('짧은 댓글')).toBe(false);
    expect(longComment('가'.repeat(141))).toBe(true);
    expect(
      longComment(
        Array(COMMENT_FOLD_LINES + 1)
          .fill('줄')
          .join('\n'),
      ),
    ).toBe(true);
  });

  it('shows 더 보기 and opens the whole comment', () => {
    const comment = {
      id: 'c1',
      rootId: 'c1',
      deleted: false,
      author: {
        userId: 'u1',
        nickname: '러너',
        handle: 'runner',
        profileImageUrl: null,
      },
      body: '가'.repeat(3000),
      likeCount: 0,
      liked: false,
      isMine: false,
      createdAt: new Date().toISOString(),
    } as unknown as PostComment;
    let root!: ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <DataProvider repositories={createMockRepositories({ latencyMs: 0 })}>
          <CommentRow
            comment={comment}
            onReply={null}
            onMenu={null}
            onLike={() => {}}
          />
        </DataProvider>,
      );
    });
    const body = () =>
      root.root.find(
        node =>
          node.props.numberOfLines !== undefined ||
          node.props.children?.[1] === comment.body,
      );
    expect(body().props.numberOfLines).toBe(COMMENT_FOLD_LINES);
    const more = root.root.find(
      node =>
        node.props.accessibilityLabel === '댓글 더 보기' &&
        typeof node.props.onPress === 'function',
    );
    act(() => more.props.onPress());
    expect(
      root.root.findAll(node => node.props.accessibilityLabel === '댓글 접기')
        .length,
    ).toBeGreaterThan(0);
  });
});
