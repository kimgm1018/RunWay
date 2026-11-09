import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Svg, { Circle, Polyline, Text } from 'react-native-svg';
import {
  CourseGlyph,
  CourseMapThumb,
  drawableShape,
  kmMarks,
} from '../SavedCoursesScreen';

async function render(element: React.ReactElement) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(element);
  });
  return screen;
}

const labels = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root.findAllByType(Text).map(node => node.props.children);

// S15P31E105-567: H01 · CMT02 summaries carry no route, so a run tile gets shape [] and must not crash.
test('an empty route draws nothing instead of a made-up line', async () => {
  const screen = await render(<CourseGlyph shape={[]} />);
  expect(screen.root.findAllByType(Svg)).toHaveLength(0);
});

test('a single point draws only the start dot', async () => {
  const screen = await render(<CourseGlyph shape={[[0.5, 0.4]]} />);
  expect(screen.root.findAllByType(Polyline)).toHaveLength(0);
  expect(labels(screen)).toEqual([]);
  const [dot] = screen.root.findAllByType(Circle);
  expect(dot.props.cx).toBe(50);
  expect(dot.props.cy).toBe(40);
});

test('a normal route draws the line from its first point, S at the start and F at the end', async () => {
  const screen = await render(
    <CourseGlyph
      shape={[
        [0.1, 0.9],
        [0.5, 0.1],
        [0.9, 0.9],
      ]}
    />,
  );
  const [line] = screen.root.findAllByType(Polyline);
  expect(line.props.points).toBe('10,90 50,10 90,90');
  expect(screen.root.findByType(Circle).props.cx).toBe(10);
  expect(labels(screen)).toEqual(['S', 'F']);
});

test('a loop or an out-and-back has one S·F', async () => {
  const screen = await render(
    <CourseGlyph
      shape={[
        [0.2, 0.7],
        [0.8, 0.3],
        [0.22, 0.71],
      ]}
    />,
  );
  expect(labels(screen)).toEqual(['S·F']);
});

test('S and F sit on the side away from the line, not on it', async () => {
  // A line straight down: S goes above the start, F below the finish.
  const screen = await render(
    <CourseGlyph
      shape={[
        [0.5, 0.2],
        [0.5, 0.8],
      ]}
    />,
  );
  const [start, finish] = screen.root.findAllByType(Text);
  expect([start.props.x, start.props.y]).toEqual([50, 13]);
  expect([finish.props.x, finish.props.y]).toEqual([50, 93]);
});

test('a loop puts S·F outside the corner where the line leaves and comes back', async () => {
  // Leaves to the right, comes back from below: S·F goes up and to the left.
  const screen = await render(
    <CourseGlyph
      shape={[
        [0.5, 0.5],
        [0.9, 0.5],
        [0.5, 0.9],
        [0.5, 0.51],
      ]}
    />,
  );
  const [label] = screen.root.findAllByType(Text);
  expect(label.props.x).toBeLessThan(50);
  expect(label.props.y).toBeLessThan(50);
});

test('S·F labels stay inside the box', async () => {
  const screen = await render(
    <CourseGlyph
      shape={[
        [0, 0.95],
        [1, 0.1],
      ]}
    />,
  );
  const [start, finish] = screen.root.findAllByType(Text);
  expect([start.props.x, start.props.y]).toEqual([7, 97]);
  expect([finish.props.x, finish.props.y]).toEqual([93, 9]);
});

test('ink on a light card, white on a dark one, each over a faint halo of the other', async () => {
  const shape: [number, number][] = [
    [0.1, 0.5],
    [0.9, 0.5],
  ];
  const strokes = async (element: React.ReactElement) =>
    (await render(element)).root
      .findAllByType(Polyline)
      .map(line => line.props.stroke);
  expect(await strokes(<CourseGlyph shape={shape} tone="ink" />)).toEqual([
    '#FFFFFF',
    '#060606',
  ]);
  expect(await strokes(<CourseGlyph shape={shape} />)).toEqual([
    '#060606',
    '#FFFFFF',
  ]);
});

test('a dot on each whole km, along the line', async () => {
  const screen = await render(
    <CourseGlyph
      shape={[
        [0, 0.5],
        [1, 0.5],
      ]}
      km={4}
    />,
  );
  // The start dot and the 1, 2, 3 km dots, evenly along the line.
  const dots = screen.root.findAllByType(Circle).map(node => node.props.cx);
  expect(dots).toEqual([25, 50, 75, 0]);
});

test('km dots: none for a short course, every 5 km past 10 km, none crowding the finish', () => {
  expect(kmMarks(undefined)).toEqual([]);
  expect(kmMarks(0.8)).toEqual([]);
  expect(kmMarks(3)).toEqual([1 / 3, 2 / 3]);
  // 5.1 km: the 5 km dot would sit on the finish.
  expect(kmMarks(5.1)).toHaveLength(4);
  // 21.1 km: 5, 10, 15; the 20 km dot is too close to the finish.
  expect(kmMarks(21.1)).toEqual([5 / 21.1, 10 / 21.1, 15 / 21.1]);
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
  const screen = await render(<CourseGlyph shape={broken} />);
  expect(screen.root.findAllByType(Svg)).toHaveLength(0);
  expect(drawableShape([...broken, [0.2, 0.3]])).toEqual([[0.2, 0.3]]);
});

// S15P31E105-562 담당자 요청: the card shows the course on the real map instead of a coloured fill.
describe('CourseMapThumb', () => {
  const route: [number, number][] = [
    [129.13, 35.15],
    [129.14, 35.16],
  ];
  const shape: [number, number][] = [
    [0.2, 0.8],
    [0.8, 0.2],
  ];
  const props = {
    shape,
    area: { top: 0.1, bottom: 0.5 },
    shadeFrom: 0.4,
  };
  const mapOf = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root.findAll(
      node => typeof node.type !== 'string' && node.props.compact === true,
    )[0];

  test('a course with points is drawn on a small still map, the logo over the fade', async () => {
    const screen = await render(<CourseMapThumb {...props} route={route} />);
    const map = mapOf(screen);
    expect(map.props.route).toEqual(route);
    expect(map.props.interactive).toBe(false);
    expect(map.props.logo).toEqual({ above: 0.6, side: 'right' });
    expect(screen.root.findAllByType(CourseGlyph)).toHaveLength(0);
  });

  test('without points it shows the outline, asks once, then the map', async () => {
    let answer!: (points: [number, number][] | null) => void;
    const load = jest.fn(
      () => new Promise<[number, number][] | null>(done => (answer = done)),
    );
    const screen = await render(<CourseMapThumb {...props} load={load} />);
    expect(mapOf(screen)).toBeUndefined();
    expect(screen.root.findAllByType(CourseGlyph)).toHaveLength(1);
    await act(async () => answer(route));
    expect(load).toHaveBeenCalledTimes(1);
    expect(mapOf(screen).props.route).toEqual(route);
  });

  test('a run with no points keeps the outline and does not fail', async () => {
    const screen = await render(
      <CourseMapThumb {...props} load={() => Promise.reject(new Error('x'))} />,
    );
    await act(async () => undefined);
    expect(mapOf(screen)).toBeUndefined();
    expect(screen.root.findAllByType(CourseGlyph)).toHaveLength(1);
  });
});
