import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';
import { setGroupIntroSeenForTest } from '../src/data/group/groupIntroSeen';
import { GroupIntro } from '../src/screens/group/GroupIntro';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

let mounted: Screen | null = null;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  // jest.setup.js marks the intro seen; this file starts each case as a fresh install (empty keystore).
  setGroupIntroSeenForTest(false);
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  try {
    if (screen) {
      await act(async () => screen.unmount());
    }
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

async function openApp() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createMockRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  mounted = screen!;
  await settle();
  return screen!;
}

test('the group tab opens on its intro for a member who has not seen it, and 함께 달리러 가기 opens 6.0', async () => {
  const screen = await openApp();
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(1);
  expect(texts(screen)).toContain('함께 달리러 가기');

  await press(screen, '함께 달리러 가기');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(0);
  expect(texts(screen)).toContain('내 크루');
  expect(texts(screen)).toContain('광안리 새벽 크루');

  // Back to the group tab in the same launch: straight to 6.0.
  await press(screen, '홈');
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(0);
  expect(texts(screen)).toContain('광안리 새벽 크루');
});

async function relaunch(screen: Screen) {
  await act(async () => screen.unmount());
  mounted = null;
  // A new launch remembers nothing in memory; only the keystore carries over.
  setGroupIntroSeenForTest(false);
  return openApp();
}

test('S15P31E105-697: once seen, the intro stays away after the app is launched again', async () => {
  let screen = await openApp();
  await press(screen, '그룹');
  await press(screen, '함께 달리러 가기');

  screen = await relaunch(screen);
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(0);
  expect(texts(screen)).toContain('광안리 새벽 크루');
});

test('S15P31E105-697: leaving the intro without 함께 달리러 가기 shows it again on the next launch', async () => {
  let screen = await openApp();
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(1);

  screen = await relaunch(screen);
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(1);
});

test('S15P31E105-697: an unreadable keystore still opens the tab on the intro, and 함께 달리러 가기 works', async () => {
  const Keychain = require('react-native-keychain');
  Keychain.getGenericPassword.mockRejectedValueOnce(new Error('locked'));
  const screen = await openApp();
  await press(screen, '그룹');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(1);

  await press(screen, '함께 달리러 가기');
  expect(screen.root.findAllByType(GroupIntro)).toHaveLength(0);
  expect(texts(screen)).toContain('광안리 새벽 크루');
});
