import React from 'react';
import { Image, Modal } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { NavigationContext } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  createMockRepositories,
  DataProvider,
  type Post,
  type PostComment,
} from '../../../data';
import { Greeting } from '../../home/HomeScreen';
import { CommentRow, CommentSheet } from '../comments';
import { PhotoZoom, zoomablePhoto } from '../PhotoZoom';

// S15P31E105-797 (TEAM QA T10 · T13 · T25): 홈 photo → 내 프로필, 프로필 photo enlarged, 댓글 author → profile.

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

const pressable = (root: ReactTestRenderer, label: string) =>
  root.root.find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

describe('홈 프로필 사진 (T10)', () => {
  it('opens 내 프로필 once when the photo is pressed', () => {
    const open = jest.fn();
    let root!: ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <Greeting nickname="민준" photo={null} onPressPhoto={open} />,
      );
    });
    act(() => pressable(root, '내 프로필 보기').props.onPress());
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('프로필 사진 확대 (T13)', () => {
  const render = (photo: string | null, onClose: () => void) => {
    let root!: ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SafeAreaProvider initialMetrics={metrics}>
          <PhotoZoom photo={photo} onClose={onClose} />
        </SafeAreaProvider>,
      );
    });
    return root;
  };

  it('shows the photo large and closes by 닫기, the dim and 뒤로', () => {
    const onClose = jest.fn();
    const root = render('https://example.com/a.png', onClose);
    expect(root.root.findByType(Modal).props.visible).toBe(true);
    expect(root.root.findByType(Image).props.source).toEqual({
      uri: 'https://example.com/a.png',
    });
    act(() => pressable(root, '확대 사진 닫기').props.onPress());
    act(() => pressable(root, '사진 닫기').props.onPress());
    act(() => root.root.findByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('stays closed without a photo', () => {
    const root = render(null, jest.fn());
    expect(root.root.findByType(Modal).props.visible).toBe(false);
    expect(root.root.findAllByType(Image)).toHaveLength(0);
  });

  it('enlarges only another runner photo that exists', () => {
    expect(zoomablePhoto({ isMe: false, profileImageUrl: 'u' })).toBe('u');
    expect(zoomablePhoto({ isMe: false, profileImageUrl: null })).toBeNull();
    expect(zoomablePhoto({ isMe: true, profileImageUrl: 'u' })).toBeNull();
  });
});

describe('댓글 작성자 프로필 (T25)', () => {
  const author = {
    userId: 'u1',
    nickname: '러너',
    handle: 'runner',
    profileImageUrl: null,
  };
  const comment = {
    id: 'c1',
    rootId: 'c1',
    deleted: false,
    author,
    body: '안녕',
    likeCount: 0,
    liked: false,
    isMine: false,
    createdAt: new Date().toISOString(),
  } as unknown as PostComment;

  it('opens the profile from the author photo and handle', () => {
    const open = jest.fn();
    let root!: ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <DataProvider repositories={createMockRepositories({ latencyMs: 0 })}>
          <CommentRow
            comment={comment}
            onReply={null}
            onMenu={null}
            onLike={() => {}}
            onProfile={open}
          />
        </DataProvider>,
      );
    });
    act(() => pressable(root, 'runner 프로필 보기').props.onPress());
    expect(open).toHaveBeenCalledTimes(1);
    const handle = root.root.find(
      node => node.props.accessibilityRole === 'link',
    );
    act(() => handle.props.onPress());
    expect(open).toHaveBeenCalledTimes(2);
  });

  async function openSheet() {
    const repositories = createMockRepositories({ latencyMs: 0 });
    const feed = await repositories.community.listFeed('ALL', null);
    const post = feed.items[0] as Post;
    repositories.community.get = jest.fn(async () => ({
      ...(await createMockRepositories({ latencyMs: 0 }).community.get(
        post.id,
      )),
      comments: [comment, { ...comment, id: 'c2', rootId: 'c2', isMine: true }],
    }));
    const navigate = jest.fn();
    const onClose = jest.fn();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = TestRenderer.create(
        <SafeAreaProvider initialMetrics={metrics}>
          <NavigationContext.Provider value={{ navigate } as never}>
            <DataProvider repositories={repositories}>
              <CommentSheet
                post={post}
                onClose={onClose}
                onCountChange={() => {}}
              />
            </DataProvider>
          </NavigationContext.Provider>
        </SafeAreaProvider>,
      );
    });
    await flush();
    return { root, navigate, onClose };
  }

  it('closes the sheet and opens that runner profile once', async () => {
    const { root, navigate, onClose } = await openSheet();
    const rows = root.root.findAll(
      node =>
        node.props.accessibilityLabel === 'runner 프로필 보기' &&
        typeof node.props.onPress === 'function',
    );
    act(() => rows[0].props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('RunnerProfile', { userId: 'u1' });
  });

  it('opens 내 프로필 for my own comment', async () => {
    const { root, navigate, onClose } = await openSheet();
    const rows = root.root.findAll(
      node =>
        node.props.accessibilityLabel === 'runner 프로필 보기' &&
        typeof node.props.onPress === 'function',
    );
    act(() => rows[1].props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toBe('MyProfile');
  });
});
