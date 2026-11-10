import React from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider, type Post } from '../src/data';
import { CommentSheet } from '../src/screens/community/comments';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(60000);

// S15P31E105-619: the 댓글 sheet keeps its comment bar clear of the phone's bottom bar by the insets of its
// own Modal window (the jest provider inside the Modal reports none), not the app window's 48.
async function openEmptySheet() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest
    .spyOn(repositories.community, 'get')
    .mockResolvedValue({ comments: [] } as never);
  const post = { id: 'post-1', author: { handle: 'minjun.run' } } as Post;
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <SafeAreaInsetsContext.Provider
          value={{ top: 40, bottom: 48, left: 0, right: 0 }}
        >
          <CommentSheet
            post={post}
            onClose={() => {}}
            onCountChange={() => {}}
          />
        </SafeAreaInsetsContext.Provider>
      </DataProvider>,
    );
  });
  return screen;
}

afterEach(() => jest.restoreAllMocks());

test('the sheet pads its foot by its own window inset, not the app window', async () => {
  const screen = await openEmptySheet();
  const sheet = screen.root.findAll(
    node => node.type === Animated.View && node.props.accessibilityViewIsModal,
  )[0];
  expect(StyleSheet.flatten(sheet.props.style).paddingBottom).toBe(0);
});

test('with no comments yet the note keeps as much room under it as over it', async () => {
  const screen = await openEmptySheet();
  const title = screen.root
    .findAllByType(Text)
    .find(node => node.props.children === '아직 댓글이 없어요')!;
  // The box the note sits in is the nearest one with room over it.
  let note = title.parent;
  while (note && !StyleSheet.flatten(note.props.style)?.paddingTop) {
    note = note.parent;
  }
  const style = StyleSheet.flatten(note!.props.style);
  expect(style.paddingBottom).toBeGreaterThanOrEqual(
    style.paddingTop as number,
  );
});
