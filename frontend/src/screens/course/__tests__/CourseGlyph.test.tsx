import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { CourseGlyph, drawableShape } from '../SavedCoursesScreen';

// S15P31E105-567: H01 · CMT02 summaries carry no route, so a run tile gets shape [] and must not crash.
async function render(shape: [number, number][]) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(<CourseGlyph shape={shape} thin />);
  });
  return screen;
}

test('an empty route draws nothing instead of a made-up line', async () => {
  const screen = await render([]);
  expect(screen.root.findAllByType(Svg)).toHaveLength(0);
});

test('a single point draws only the start dot', async () => {
  const screen = await render([[0.5, 0.4]]);
  expect(screen.root.findAllByType(Polyline)).toHaveLength(0);
  const [dot] = screen.root.findAllByType(Circle);
  expect(dot.props.cx).toBe(50);
  expect(dot.props.cy).toBe(40);
});

test('a normal route draws the line from its first point', async () => {
  const screen = await render([
    [0.1, 0.9],
    [0.5, 0.1],
    [0.9, 0.9],
  ]);
  const [line] = screen.root.findAllByType(Polyline);
  expect(line.props.points).toBe('10,90 50,10 90,90');
  expect(screen.root.findByType(Circle).props.cx).toBe(10);
});

test('broken points are dropped and a route left with none draws nothing', async () => {
  const broken: [number, number][] = [
    [Number.NaN, 0.5],
    [0.3] as unknown as [number, number],
    null as unknown as [number, number],
  ];
  expect(drawableShape(broken)).toEqual([]);
  expect(drawableShape(undefined as unknown as [number, number][])).toEqual(
    [],
  );
  const screen = await render(broken);
  expect(screen.root.findAllByType(Svg)).toHaveLength(0);
  expect(drawableShape([...broken, [0.2, 0.3]])).toEqual([[0.2, 0.3]]);
});
