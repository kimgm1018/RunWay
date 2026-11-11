import React from 'react';
import { ScrollView } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { RulerPicker } from '../RulerPicker';

// 목표 거리 눈금(S15P31E105-608): 0.5km 칸이지만 하프 마라톤 21.1km가 마지막 칸이다. max가 칸의 배수이면 예전과 같다.

const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  mounted.splice(0).forEach(renderer => act(() => renderer.unmount()));
});

function render(value: number, max: number, onChange: jest.Mock) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <RulerPicker
        label="목표 거리"
        value={value}
        min={1}
        max={max}
        step={0.5}
        format={v => `${v.toFixed(1)}km`}
        onChange={onChange}
        color="#000"
        mutedColor="#999"
      />,
    );
  });
  mounted.push(renderer);
  return renderer;
}

function step(value: number, max: number, actionName: 'increment' | 'decrement') {
  const onChange = jest.fn();
  const renderer = render(value, max, onChange);
  const ruler = renderer.root.find(node => node.props.accessibilityRole === 'adjustable');
  act(() => ruler.props.onAccessibilityAction({ nativeEvent: { actionName } }));
  return onChange.mock.calls[0][0];
}

test('the last tick of a 1–21.1km ruler is 21.1', () => {
  expect(step(21, 21.1, 'increment')).toBe(21.1);
  expect(step(21.1, 21.1, 'increment')).toBe(21.1);
  expect(step(21.1, 21.1, 'decrement')).toBe(21);
  expect(step(20.5, 21.1, 'increment')).toBe(21);
});

test('a max that is a whole number of steps works as before', () => {
  expect(step(14.5, 15, 'increment')).toBe(15);
  expect(step(15, 15, 'increment')).toBe(15);
  expect(step(15, 15, 'decrement')).toBe(14.5);
});

test('a value between 21.0 and 21.1 sits on the nearer tick', () => {
  expect(step(21.09, 21.1, 'decrement')).toBe(21);
  expect(step(21.04, 21.1, 'increment')).toBe(21.1);
});

test('dragging to the end of the ruler picks 21.1', () => {
  const onChange = jest.fn();
  const renderer = render(1, 21.1, onChange);
  // The ruler draws its ticks once it knows its width.
  const ruler = renderer.root.find(node => typeof node.props.onLayout === 'function');
  act(() => ruler.props.onLayout({ nativeEvent: { layout: { width: 300 } } }));
  const scroll = renderer.root.findByType(ScrollView);
  // 12px between ticks; tick 41 is the 42nd and last one.
  act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 41 * 12 } } }));
  expect(onChange).toHaveBeenLastCalledWith(21.1);
  act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 40 * 12 } } }));
  expect(onChange).toHaveBeenLastCalledWith(21);
});
