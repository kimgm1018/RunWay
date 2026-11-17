import React from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, tokenStore } from '../src/data';
import { RunnerArt } from '../src/screens/onboarding/look';
import { KeyboardBackdrop } from '../src/screens/onboarding/parts';

// S15P31E105-902: with the keyboard up, 1.3 회원가입 drops the runner and its backdrop like 1.2 로그인, so the
// fields move up; the keyboard down brings both back.

jest.mock('../src/health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
  refreshWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

// Every screen and box listening to the keyboard hears it.
const listeners: Record<string, ((event: KeyboardEvent) => void)[]> = {};

function keyboard(open: boolean) {
  const names = open
    ? ['keyboardDidShow', 'keyboardWillShow']
    : ['keyboardDidHide', 'keyboardWillHide'];
  act(() => {
    names
      .flatMap(name => listeners[name] ?? [])
      .forEach(listener =>
        listener({
          endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 344 },
        } as KeyboardEvent),
      );
  });
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
async function press(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => {
    matches[matches.length - 1].props.onPress();
  });
  await settle();
}

beforeEach(async () => {
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((name: string, listener: unknown) => {
      const list = (listeners[name] ??= []);
      list.push(listener as (event: KeyboardEvent) => void);
      return {
        remove: () => {
          const at = list.indexOf(listener as never);
          if (at >= 0) {
            list.splice(at, 1);
          }
        },
      } as never;
    });
  await tokenStore.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.keys(listeners).forEach(name => delete listeners[name]);
});

test('회원가입 moves its fields up like 로그인 while the keyboard is up', async () => {
  let screen!: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={createMockRepositories({ latencyMs: 0 })} />,
    );
  });
  await settle();
  await press(screen, '시작하기'); // 1.2 로그인
  await press(screen, '회원가입'); // 1.3 회원가입, over 로그인
  // 로그인 below and 회원가입 on top each draw the runner.
  expect(screen.root.findAllByType(RunnerArt)).toHaveLength(2);

  keyboard(true);

  expect(screen.root.findAllByType(RunnerArt)).toHaveLength(0);
  expect(screen.root.findAllByType(KeyboardBackdrop)).toHaveLength(2);

  keyboard(false);

  expect(screen.root.findAllByType(RunnerArt)).toHaveLength(2);
  expect(screen.root.findAllByType(KeyboardBackdrop)).toHaveLength(0);
  act(() => screen.unmount());
});
