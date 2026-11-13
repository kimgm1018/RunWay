import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider, type Post } from '../src/data';
import { CommentSheet } from '../src/screens/community/comments';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(60000);

// S15P31E105-812 (TEAM QA T14): on the phone the 댓글 sheet's handle did not move at all. The handle asked for the
// touch only once it moved, and Android never asked it then; it now takes the touch as it starts.
async function openSheet(onClose: () => void) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  jest
    .spyOn(repositories.community, 'get')
    .mockResolvedValue({ comments: [] } as never);
  const post = { id: 'post-1', author: { handle: 'minjun.run' } } as Post;
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <CommentSheet post={post} onClose={onClose} onCountChange={() => {}} />
      </DataProvider>,
    );
  });
  return screen;
}

// The handle row: the box with the sheet's pan handlers (the dim behind is a Pressable, which has no capture ones).
const handleOf = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root.findAll(
    node =>
      node.type === View &&
      Boolean(node.props.onMoveShouldSetResponderCapture),
  )[0];

// A one-finger touch at y, as React Native's responder system hands it on.
let clock = 0;
let lastY = 0;
const touchAt = (y: number, startY: number) => {
  clock += 16;
  const previousY = y === startY ? y : lastY;
  lastY = y;
  return {
    nativeEvent: { pageX: 0, pageY: y, timestamp: clock },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: clock,
      touchBank: [
        {
          touchActive: true,
          startPageX: 0,
          startPageY: startY,
          startTimeStamp: 0,
          currentPageX: 0,
          currentPageY: y,
          currentTimeStamp: clock,
          previousPageX: 0,
          previousPageY: previousY,
          previousTimeStamp: clock - 16,
        },
      ],
    },
  };
};

afterEach(() => jest.restoreAllMocks());

test('the handle takes the touch as it starts, so the sheet follows the finger', async () => {
  const screen = await openSheet(() => {});
  const handle = handleOf(screen);
  expect(handle.props.onStartShouldSetResponder(touchAt(100, 100))).toBe(true);
});

test('pulling the handle far enough down closes the sheet', async () => {
  const onClose = jest.fn();
  const screen = await openSheet(onClose);
  const handle = handleOf(screen);
  act(() => {
    handle.props.onStartShouldSetResponder(touchAt(100, 100));
    handle.props.onResponderGrant(touchAt(100, 100));
    handle.props.onResponderMove(touchAt(200, 100));
    handle.props.onResponderMove(touchAt(300, 100));
    handle.props.onResponderRelease(touchAt(300, 100));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a drag taken away halfway leaves the sheet open', async () => {
  const onClose = jest.fn();
  const screen = await openSheet(onClose);
  const handle = handleOf(screen);
  act(() => {
    handle.props.onStartShouldSetResponder(touchAt(100, 100));
    handle.props.onResponderGrant(touchAt(100, 100));
    handle.props.onResponderMove(touchAt(300, 100));
    handle.props.onResponderTerminate(touchAt(300, 100));
  });
  expect(onClose).not.toHaveBeenCalled();
});
