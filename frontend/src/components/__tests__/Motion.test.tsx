import React from 'react';
import { Animated, LayoutAnimation, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  animateNextLayout,
  motion,
  PressableScale,
  setReduceMotion,
  useCountUp,
} from '../Motion';

// 앱 움직임 기준 (S15P31E105-478): one press spring, counting numbers, layout transitions, and 동작 줄이기 turning all
// of them off. jest.setup.js turns 동작 줄이기 on before each test; these tests turn it off where they check a motion.

// Every renderer is unmounted after its test: one left mounted would re-render when the next test (or
// jest.setup.js) flips 동작 줄이기, after Jest has torn the test down (seen as a failed --runInBand run in CI).
const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function press(renderer: TestRenderer.ReactTestRenderer) {
  const target = renderer.root.findAll(
    node => typeof node.props.onPressIn === 'function',
  )[0];
  act(() => target.props.onPressIn({}));
  act(() => target.props.onPressOut({}));
}

test('a press sinks to 96% with the common spring and comes back', () => {
  setReduceMotion(false);
  const spring = jest.spyOn(Animated, 'spring');
  const renderer = mount(
    <PressableScale accessibilityLabel="눌러 보기" onPress={() => undefined} />,
  );

  press(renderer);

  expect(spring.mock.calls.map(([, config]) => config)).toEqual([
    expect.objectContaining({
      toValue: motion.press.scale,
      speed: motion.press.speed,
      bounciness: motion.press.bounciness,
    }),
    expect.objectContaining({ toValue: 1 }),
  ]);
  expect(motion.press.scale).toBe(0.96);
});

test('with 동작 줄이기 a press does not move', () => {
  setReduceMotion(true);
  const spring = jest.spyOn(Animated, 'spring');
  const renderer = mount(
    <PressableScale accessibilityLabel="눌러 보기" onPress={() => undefined} />,
  );

  press(renderer);

  expect(spring).not.toHaveBeenCalled();
});

function Counter({ target }: { target: number }) {
  return <Text>{Math.round(useCountUp(target))}</Text>;
}

const shown = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findByType(Text).props.children;

test('a number counts up to its value once, and shows it at once with 동작 줄이기', () => {
  jest.useFakeTimers();
  setReduceMotion(false);
  const renderer = mount(<Counter target={82} />);
  expect(shown(renderer)).toBe(0);
  act(() => {
    jest.advanceTimersByTime(motion.duration.count + 100);
  });
  expect(shown(renderer)).toBe(82);

  act(() => {
    setReduceMotion(true);
    renderer.update(<Counter target={64} />);
  });
  expect(shown(renderer)).toBe(64);
});

test('a layout change eases into place, unless 동작 줄이기 is on', () => {
  const configure = jest.spyOn(LayoutAnimation, 'configureNext');
  setReduceMotion(false);
  animateNextLayout();
  expect(configure).toHaveBeenCalledWith(
    expect.objectContaining({ duration: motion.duration.quick }),
  );

  configure.mockClear();
  setReduceMotion(true);
  animateNextLayout();
  expect(configure).not.toHaveBeenCalled();
});
