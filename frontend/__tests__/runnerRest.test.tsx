import React from 'react';
import { Keyboard } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  noteOnboardingTouch,
  RUNNER_REST_MS,
  useRunnerMoving,
} from '../src/screens/onboarding/look';

// S15P31E105-802 (TEAM QA T07): the 1.x runner art rests while the screen is touched or the keyboard is up,
// runs again RUNNER_REST_MS later, and does not run while the screen is behind another one.

type KeyboardListener = (...args: never[]) => void;
const keyboardListeners: Record<string, KeyboardListener[]> = {};

beforeEach(() => {
  jest.useFakeTimers();
  for (const key of Object.keys(keyboardListeners)) {
    delete keyboardListeners[key];
  }
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((name: string, listener: KeyboardListener) => {
      (keyboardListeners[name] ??= []).push(listener);
      return { remove: () => undefined } as never;
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function Probe({
  focused,
  seen,
}: {
  focused: boolean;
  seen: (moving: boolean) => void;
}) {
  seen(useRunnerMoving(focused));
  return null;
}

function mount(focused = true) {
  const values: boolean[] = [];
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      <Probe focused={focused} seen={value => values.push(value)} />,
    );
  });
  return { values, root, last: () => values[values.length - 1] };
}

test('a touch rests the runner, which runs again after the rest', () => {
  const { last } = mount();
  expect(last()).toBe(true);
  act(() => noteOnboardingTouch());
  expect(last()).toBe(false);
  act(() => {
    jest.advanceTimersByTime(RUNNER_REST_MS - 100);
  });
  expect(last()).toBe(false);
  // Another touch in the rest starts it again.
  act(() => noteOnboardingTouch());
  act(() => {
    jest.advanceTimersByTime(RUNNER_REST_MS - 100);
  });
  expect(last()).toBe(false);
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(last()).toBe(true);
});

test('the runner rests while the keyboard is up', () => {
  const { last } = mount();
  act(() =>
    keyboardListeners.keyboardDidShow.forEach(listener =>
      (listener as () => void)(),
    ),
  );
  act(() => {
    jest.advanceTimersByTime(RUNNER_REST_MS * 3);
  });
  expect(last()).toBe(false);
  act(() =>
    keyboardListeners.keyboardDidHide.forEach(listener =>
      (listener as () => void)(),
    ),
  );
  expect(last()).toBe(false);
  act(() => {
    jest.advanceTimersByTime(RUNNER_REST_MS);
  });
  expect(last()).toBe(true);
});

test('a screen behind another does not run its runner', () => {
  const { last } = mount(false);
  expect(last()).toBe(false);
});
