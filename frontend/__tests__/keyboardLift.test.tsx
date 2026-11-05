import React from 'react';
import { Keyboard, Text, View, type KeyboardEvent } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { KeyboardLift } from '../src/components/KeyboardLift';

// S15P31E105-473: footers stay right above the keyboard. The box is measured in the window, so a sheet that
// starts mid-screen lifts by exactly the part the keyboard covers, and a window that already shrank lifts by 0.

jest.setTimeout(60000);

type Listener = (event: KeyboardEvent) => void;

function setUp(box: { y: number; height: number }) {
  const listeners: Record<string, Listener> = {};
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((name: string, listener: unknown) => {
      listeners[name] = listener as Listener;
      return { remove: jest.fn() } as never;
    });
  let screen!: TestRenderer.ReactTestRenderer;
  act(() => {
    screen = TestRenderer.create(
      <KeyboardLift>
        <Text>다음</Text>
      </KeyboardLift>,
    );
  });
  // React Native's jest setup stubs measureInWindow; answer with the box's place in the window.
  screen.root
    .findAllByType(View)[0]
    .instance.measureInWindow.mockImplementation(
      (done: (x: number, y: number, w: number, h: number) => void) =>
        done(0, box.y, 390, box.height),
    );
  const lift = () =>
    screen.root.findAllByType(View)[1].props.style[1].marginBottom as number;
  const keyboard = (screenY: number | null) =>
    act(() => {
      // iOS listens to the will- events, Android to the did- events.
      const show = listeners.keyboardDidShow ?? listeners.keyboardWillShow;
      const hide = listeners.keyboardDidHide ?? listeners.keyboardWillHide;
      if (screenY === null) {
        hide({} as KeyboardEvent);
      } else {
        show({
          endCoordinates: {
            screenY,
            height: 844 - screenY,
            screenX: 0,
            width: 390,
          },
        } as KeyboardEvent);
      }
    });
  return { lift, keyboard };
}

afterEach(() => jest.restoreAllMocks());

test('a sheet from the middle of the screen lifts by the part the keyboard covers', () => {
  // The sheet runs from 300 to the bottom of an 844 screen; the keyboard top is at 500.
  const { lift, keyboard } = setUp({ y: 300, height: 544 });
  expect(lift()).toBe(0);
  keyboard(500);
  expect(lift()).toBe(344);
  keyboard(null);
  expect(lift()).toBe(0);
});

test('a box that already ends above the keyboard does not move', () => {
  // Older Android shrinks the window, so the box ends at the keyboard top.
  const { lift, keyboard } = setUp({ y: 0, height: 500 });
  keyboard(500);
  expect(lift()).toBe(0);
});
