import React from 'react';
import { Image, StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Svg, { Circle, Polyline, Text } from 'react-native-svg';
import type { CourseBasemap, CourseMapData } from '../../../data';
import { routeProjector, shapeOfRoute } from '../../../geo';
import {
  basemapImage,
  basemapImageFrame,
  CourseGlyph,
  CourseMapThumb,
  drawableShape,
  glyphBox,
  kmMarks,
} from '../SavedCoursesScreen';

// Every render is unmounted after its test, so a card gives its map slot back (S15P31E105-715).
const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const screen of mounted.splice(0)) {
    await act(async () => screen.unmount());
  }
});

async function render(element: React.ReactElement) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(element);
  });
  mounted.push(screen);
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
  expect(drawableShape(undefined as unknown as [number, number][])).toEqual([]);
  const screen = await render(<CourseGlyph shape={broken} />);
  expect(screen.root.findAllByType(Svg)).toHaveLength(0);
  expect(drawableShape([...broken, [0.2, 0.3]])).toEqual([[0.2, 0.3]]);
});

// S15P31E105-612: with a C03 basemap the card is the server's map image (the course already on it) with
// © OpenStreetMap, and no outline over it; without one, or when the image fails, it keeps the plain outline.
// Before: a vector OSM basemap in SVG under the outline, and before that S15P31E105-562's compact Naver RunMap.
describe('CourseMapThumb', () => {
  const route: [number, number][] = [
    [129.13, 35.15],
    [129.14, 35.16],
  ];
  const shape: [number, number][] = [
    [0.2, 0.8],
    [0.8, 0.2],
  ];
  const basemap: CourseBasemap = {
    imageUrl: 'https://k15e105.p.ssafy.io/api/v1/courses/7/basemap.png',
    osmDataTimestamp: '2026-11-01T00:00:00Z',
  };
  const props = {
    shape,
    area: { top: 0.1, bottom: 0.5 },
    shadeFrom: 0.4,
  };
  const naverMaps = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root.findAll(
      node =>
        node.props.testID === 'naver-map' ||
        (typeof node.type !== 'string' && node.props.compact === true),
    );
  const images = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root
      .findAllByType(Image)
      .filter(node => node.props.testID === 'course-basemap');
  const attribution = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root.findAll(
      node =>
        node.props.testID === 'course-basemap-attribution' &&
        typeof node.type === 'string',
    );
  const glyphs = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root.findAllByType(CourseGlyph);
  // The card is laid out as a 175 × 245 saved course card.
  const layOut = async (screen: TestRenderer.ReactTestRenderer) => {
    const [thumb] = screen.root.findAll(
      node =>
        node.props.testID === 'course-thumb' &&
        typeof node.props.onLayout === 'function',
    );
    await act(async () =>
      thumb.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 175, height: 245 } },
      }),
    );
  };

  test('a course with a basemap shows its map image and © OpenStreetMap, without an outline once loaded', async () => {
    const screen = await render(
      <CourseMapThumb {...props} route={route} basemap={basemap} />,
    );
    await layOut(screen);
    expect(naverMaps(screen)).toHaveLength(0);
    // Until the image has loaded, the outline keeps the course on the card, with no map credit yet.
    expect(glyphs(screen)).toHaveLength(1);
    expect(attribution(screen)).toHaveLength(0);
    const [image] = images(screen);
    await act(async () => image.props.onLoad({ nativeEvent: {} }));
    expect(image.props.source).toEqual({ uri: basemap.imageUrl });
    expect(image.props.resizeMode).toBe('cover');
    // Placed by basemapImageFrame on the card's own size.
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({
      position: 'absolute',
      ...basemapImageFrame(175, 245, props.area),
    });
    // The image has the course on it: no outline is drawn over it.
    expect(glyphs(screen)).toHaveLength(0);
    // The dark fade is still over it.
    expect(screen.root.findAllByType(Svg)).toHaveLength(1);
    const [label] = attribution(screen);
    expect(label).toBeDefined();
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({
      position: 'absolute',
      top: 14,
      left: 16,
    });
    expect(
      StyleSheet.flatten(label.props.style).backgroundColor,
    ).toBeUndefined();
    const [text] = label.findAll(
      node =>
        node.props.accessibilityLabel === '지도 데이터 © OpenStreetMap 기여자',
    );
    expect(text.props.children).toBe('© OpenStreetMap');
  });

  test('the image is placed only once the card has a size', async () => {
    const screen = await render(
      <CourseMapThumb {...props} route={route} basemap={basemap} />,
    );
    expect(images(screen)).toHaveLength(0);
    // The outline shows meanwhile.
    expect(glyphs(screen)).toHaveLength(1);
  });

  test('an image that fails to load falls back to the plain outline', async () => {
    const screen = await render(
      <CourseMapThumb {...props} route={route} basemap={basemap} />,
    );
    await layOut(screen);
    const [image] = images(screen);
    await act(async () =>
      image.props.onError({ nativeEvent: { error: 'HTTP 404' } }),
    );
    expect(images(screen)).toHaveLength(0);
    expect(attribution(screen)).toHaveLength(0);
    const [glyph] = glyphs(screen);
    expect(glyph.props.shape).toEqual(shapeOfRoute(route));
    expect(glyph.props.tone).toBe('ink');
  });

  test('a card given a basemap does not ask for one', async () => {
    const load = jest.fn(() => Promise.resolve(null));
    const screen = await render(
      <CourseMapThumb {...props} basemap={basemap} load={load} />,
    );
    await layOut(screen);
    expect(load).not.toHaveBeenCalled();
    expect(images(screen)).toHaveLength(1);
  });

  test('without points it shows the outline, asks once, then the image', async () => {
    let answer!: (map: CourseMapData | null) => void;
    const load = jest.fn(
      () => new Promise<CourseMapData | null>(done => (answer = done)),
    );
    const screen = await render(<CourseMapThumb {...props} load={load} />);
    await layOut(screen);
    expect(images(screen)).toHaveLength(0);
    expect(glyphs(screen)[0].props.shape).toEqual(shape);
    await act(async () => answer({ route, basemap }));
    await act(async () =>
      screen.update(<CourseMapThumb {...props} load={load} />),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(naverMaps(screen)).toHaveLength(0);
    expect(images(screen)).toHaveLength(1);
    expect(attribution(screen)).toHaveLength(0);
    expect(glyphs(screen)).toHaveLength(1);
    const [image] = images(screen);
    await act(async () => image.props.onLoad({ nativeEvent: {} }));
    expect(glyphs(screen)).toHaveLength(0);
    expect(attribution(screen)).toHaveLength(1);
  });

  test('a loaded run without a basemap draws its outline from the points', async () => {
    const load = jest.fn(() => Promise.resolve({ route, basemap: null }));
    const screen = await render(<CourseMapThumb {...props} load={load} />);
    await layOut(screen);
    await act(async () => undefined);
    expect(load).toHaveBeenCalledTimes(1);
    expect(images(screen)).toHaveLength(0);
    expect(glyphs(screen)[0].props.shape).toEqual(shapeOfRoute(route));
  });

  test.each([
    ['no basemap', null],
    ['a basemap left out', undefined],
  ] as [string, CourseBasemap | null | undefined][])(
    '%s keeps the outline on the light ground until a real map is shown',
    async (_, given) => {
      const screen = await render(
        <CourseMapThumb {...props} route={route} basemap={given} />,
      );
      await layOut(screen);
      expect(images(screen)).toHaveLength(0);
      expect(attribution(screen)).toHaveLength(0);
      // S15P31E105-715: no server image, so a compact real map sits under the outline until it is shown.
      expect(naverMaps(screen).length).toBeGreaterThan(0);
      expect(glyphs(screen)).toHaveLength(1);
      const [thumb] = screen.root.findAll(
        node =>
          node.props.testID === 'course-thumb' &&
          typeof node.props.onLayout === 'function',
      );
      expect(StyleSheet.flatten(thumb.props.style).backgroundColor).toBe(
        '#F3F5F6',
      );
    },
  );

  // S15P31E105-715: a course card draws a real map when it has no server image or has grey connectors.
  const runMaps = (screen: TestRenderer.ReactTestRenderer) =>
    screen.root.findAll(
      node =>
        typeof node.type !== 'string' &&
        node.props.compact === true &&
        node.props.route,
    );

  test('a private course with no basemap draws its route on a compact map, and the outline leaves once it is shown', async () => {
    const screen = await render(
      <CourseMapThumb {...props} route={route} basemap={null} />,
    );
    await layOut(screen);
    const [map] = runMaps(screen);
    expect(map.props.route).toEqual(route);
    expect(map.props.interactive).toBe(false);
    // The same mint line as the course recommendation map, not the default black one.
    expect(map.props.mintLine).toBe(true);
    expect(glyphs(screen)).toHaveLength(1);
    await act(async () => map.props.onShown());
    expect(glyphs(screen)).toHaveLength(0);
  });

  test('grey connectors go to the map, and a server image is not used for them', async () => {
    const screen = await render(
      <CourseMapThumb
        {...props}
        route={route}
        basemap={basemap}
        unmeasuredEdges={[0]}
      />,
    );
    await layOut(screen);
    expect(images(screen)).toHaveLength(0);
    const [map] = runMaps(screen);
    expect(map.props.unmeasuredEdges).toEqual([0]);
  });

  test('only a few cards hold a map at a time and a leaving card gives its place back', async () => {
    const screens: TestRenderer.ReactTestRenderer[] = [];
    for (let card = 0; card < 4; card += 1) {
      screens.push(
        await render(
          <CourseMapThumb {...props} route={route} basemap={null} />,
        ),
      );
    }
    expect(screens.map(card => runMaps(card).length > 0)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    await act(async () => screens[0].unmount());
    mounted.splice(mounted.indexOf(screens[0]), 1);
    const fifth = await render(
      <CourseMapThumb {...props} route={route} basemap={null} />,
    );
    expect(runMaps(fifth).length).toBeGreaterThan(0);
  });

  test('a card with a loaded image keeps the image and draws no map', async () => {
    const screen = await render(
      <CourseMapThumb {...props} route={route} basemap={basemap} />,
    );
    await layOut(screen);
    expect(runMaps(screen)).toHaveLength(0);
  });

  test('a run with no points keeps the outline and does not fail', async () => {
    const load = jest.fn(() => Promise.reject(new Error('x')));
    const screen = await render(<CourseMapThumb {...props} load={load} />);
    await layOut(screen);
    await act(async () => undefined);
    expect(load).toHaveBeenCalledTimes(1);
    expect(naverMaps(screen)).toHaveLength(0);
    expect(images(screen)).toHaveLength(0);
    const [glyph] = glyphs(screen);
    expect(glyph.props.shape).toEqual(shape);
  });
});

// The map image's course (0.5, 0.30 of the image, 0.42 of its width) lands where the outline would be: on the
// centre of the outline's square, as wide as the outline's 0.8 of it, unless the card would show a bare edge.
describe('basemapImageFrame', () => {
  const courseOf = (
    frame: ReturnType<typeof basemapImageFrame>,
  ): { x: number; y: number; span: number } => ({
    x: frame.left + frame.width * basemapImage.courseX,
    y: frame.top + frame.height * basemapImage.courseY,
    span: frame.width * basemapImage.courseSpan,
  });
  const centreOf = (
    width: number,
    height: number,
    area: { top: number; bottom: number },
  ) => {
    const box = glyphBox(width, height, area);
    const side = box.scale * 100;
    return { x: box.x + side / 2, y: box.y + side / 2, side };
  };
  const covers = (
    frame: ReturnType<typeof basemapImageFrame>,
    width: number,
    height: number,
  ) => {
    expect(frame.left).toBeLessThanOrEqual(1e-9);
    expect(frame.top).toBeLessThanOrEqual(1e-9);
    expect(frame.left + frame.width).toBeGreaterThanOrEqual(width - 1e-9);
    expect(frame.top + frame.height).toBeGreaterThanOrEqual(height - 1e-9);
  };

  test('the image keeps its 2:3 shape', () => {
    const frame = basemapImageFrame(175, 245, { top: 0.1, bottom: 0.9 });
    expect(frame.height / frame.width).toBeCloseTo(1.5, 10);
  });

  test('a tall band: the course is exactly the outline’s size and place', () => {
    // A band as high as its 0.6 width, near the top: the strict fit (114.3 wide) already covers the card.
    const area = { top: 0.1, bottom: 0.5 };
    const [width, height] = [100, 150];
    const frame = basemapImageFrame(width, height, area);
    const centre = centreOf(width, height, area);
    const course = courseOf(frame);
    expect(course.x).toBeCloseTo(centre.x, 10);
    expect(course.y).toBeCloseTo(centre.y, 10);
    expect(course.span).toBeCloseTo(0.8 * centre.side, 10);
    covers(frame, width, height);
  });

  test.each([
    [
      'the 175 × 245 saved course card',
      175,
      245,
      { top: 44 / 245, bottom: 117 / 245 },
    ],
    ['a profile run tile', 110, 130, { top: 0.08, bottom: 0.5 }],
    ['the test card', 175, 245, { top: 0.1, bottom: 0.5 }],
  ] as [string, number, number, { top: number; bottom: number }][])(
    '%s: the course stays on the band centre and the image covers the card',
    (_, width, height, area) => {
      const frame = basemapImageFrame(width, height, area);
      const centre = centreOf(width, height, area);
      const course = courseOf(frame);
      expect(course.x).toBeCloseTo(centre.x, 10);
      expect(course.y).toBeCloseTo(centre.y, 10);
      // Never smaller than the outline would be; larger only to cover a bare edge.
      expect(course.span).toBeGreaterThanOrEqual(0.8 * centre.side - 1e-9);
      covers(frame, width, height);
    },
  );

  test('the saved course card grows the image just enough to reach the card’s top', () => {
    // Band 44–117 (73 high) under a 105 wide band: the square is 73, its centre 80.5 down. The strict fit (139 wide)
    // would leave the top bare, so the image is 80.5 / 0.3 = 268.3 high (178.9 wide) and starts at the card's top.
    const frame = basemapImageFrame(175, 245, {
      top: 44 / 245,
      bottom: 117 / 245,
    });
    expect(frame.top).toBeCloseTo(0, 10);
    expect(frame.width).toBeCloseTo(80.5 / 0.3 / 1.5, 10);
    expect(frame.left).toBeCloseTo(87.5 - frame.width / 2, 10);
  });
});

// The outline's projection: any [longitude, latitude] point goes through the one the course does.
describe('route projection', () => {
  const route: [number, number][] = [
    [129.13, 35.15],
    [129.135, 35.158],
    [129.14, 35.16],
  ];

  test('a point equal to a course point projects to the same place', () => {
    const project = routeProjector(route);
    const shape = shapeOfRoute(route);
    route.forEach((point, index) => {
      expect(project([point[0], point[1]])).toEqual(shape[index]);
    });
    // A point off the course may fall outside the 0–1 box.
    const [x] = project([129.2, 35.15]);
    expect(x).toBeGreaterThan(1);
  });

  // B-1: the course's box is centred, as the server's map image is rendered round the course's centre.
  test.each([
    [
      'a wide east-west route',
      [
        [129.1, 35.15],
        [129.12, 35.152],
        [129.14, 35.151],
      ],
    ],
    [
      'a tall north-south route',
      [
        [129.13, 35.12],
        [129.132, 35.14],
        [129.131, 35.16],
      ],
    ],
  ] as [string, [number, number][]][])(
    '%s is centred, its longer side spanning 0.1–0.9',
    (_, given) => {
      const shape = shapeOfRoute(given);
      const xs = shape.map(([x]) => x);
      const ys = shape.map(([, y]) => y);
      const [minX, maxX, minY, maxY] = [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
      ];
      expect((minX + maxX) / 2).toBeCloseTo(0.5, 10);
      expect((minY + maxY) / 2).toBeCloseTo(0.5, 10);
      const [low, high] =
        maxX - minX >= maxY - minY ? [minX, maxX] : [minY, maxY];
      expect(low).toBeCloseTo(0.1, 10);
      expect(high).toBeCloseTo(0.9, 10);
      // The shorter side is strictly shorter and stays inside the box.
      expect(Math.min(maxX - minX, maxY - minY)).toBeLessThan(0.8);
      // North up: the northernmost point is drawn highest.
      const north = given.reduce(
        (best, point, index) => (point[1] > given[best][1] ? index : best),
        0,
      );
      expect(shape[north][1]).toBeCloseTo(minY, 10);
    },
  );
});
