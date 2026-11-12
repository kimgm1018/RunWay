import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  headingOf,
  lowerToLogo,
  RunMap,
  zoomFor,
} from '../src/components/RunMap';
import { darkMapLook, mintMapLook } from '../src/components/mapRoute';
import type { LngLat } from '../src/geo';

// The Naver map is a plain view in tests (jest.setup.js); these check what RunMap puts on it.

const route: LngLat[] = [
  [129.13, 35.15],
  [129.135, 35.152],
  [129.14, 35.155],
  [129.145, 35.153],
];

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer.root;
}

// Host views only: the mock overlay and the view it renders carry the same testID.
const count = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  ).length;

const texts = (root: ReactTestRenderer.ReactTestInstance) =>
  root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children);

// The props RunMap gave the mock overlays named `name` (their displayName in jest.setup.js).
const overlays = (root: ReactTestRenderer.ReactTestInstance, name: string) =>
  root
    .findAll(
      node =>
        typeof node.type !== 'string' &&
        (node.type as { displayName?: string }).displayName === name,
    )
    .map(node => node.props);

test('a course with paces shows its start, its finish and one pace label per km', () => {
  const root = render(
    <RunMap
      route={route}
      segmentPaces={[330, 345, 360]}
      paceLabels={['5\'30"', '5\'45"', '6\'00"']}
    />,
  );
  expect(texts(root)).toEqual(
    expect.arrayContaining(['S', 'F', '5\'30"', '5\'45"', '6\'00"']),
  );
  expect(texts(root)).not.toContain('SF');
  expect(count(root, 'naver-map-multipath')).toBe(1);
});

test('a course that ends where it starts has one SF pole', () => {
  const root = render(<RunMap route={[...route, [129.1302, 35.1501]]} />);
  expect(texts(root)).toContain('SF');
  expect(texts(root)).not.toContain('S');
  expect(texts(root)).not.toContain('F');
});

test('the course is a white ribbon round a thin centre over a soft shadow, the part run in grey (S15P31E105-562)', () => {
  const root = render(<RunMap route={route} progress={0.4} />);
  const [ribbon] = overlays(root, 'naver-map-multipath');
  expect(ribbon.width).toBe(2.2);
  expect(ribbon.outlineWidth).toBe(2.4);
  expect(ribbon.progress).toBe(0.4);
  expect(ribbon.pathParts[0]).toEqual(
    expect.objectContaining({
      color: '#060606',
      outlineColor: '#FFFFFF',
      passedColor: '#B4BDC4',
      passedOutlineColor: '#FFFFFF',
    }),
  );
  // The shadow is one wide faint line under the ribbon.
  expect(count(root, 'naver-map-path')).toBe(1);
  const [shadow] = overlays(root, 'naver-map-path');
  expect(shadow.width).toBe(10);
  expect(shadow.zIndex).toBeLessThan(ribbon.zIndex);
});

test('a card map (compact) is a lite map with small poles; a screen map is not', () => {
  const card = render(<RunMap route={route} compact />);
  expect(
    card.findByProps({ testID: 'naver-map' }).parent?.props.isLiteModeEnabled,
  ).toBe(true);
  const screen = render(<RunMap route={route} />);
  expect(
    screen.findByProps({ testID: 'naver-map' }).parent?.props.isLiteModeEnabled,
  ).toBe(false);
});

test('a compact tilted map keeps its building layer out of lite mode', () => {
  const root = render(<RunMap route={route} compact view="lean" />);
  const map = root.find(
    node => 'layerGroups' in node.props && 'buildingHeight' in node.props,
  );
  expect(map.props.layerGroups.BUILDING).toBe(true);
  expect(map.props.buildingHeight).toBe(1);
  expect(map.props.isLiteModeEnabled).toBe(false);
});

// S15P31E105-672 review: on the dark tilted map the course under a run is a dim, thinner guide with a grey edge,
// so only the run reads as the mint line.
test('while running on a tilted map the course is a dim, thin guide under the mint run', () => {
  const root = render(
    <RunMap route={route} trail={route.slice(0, 2)} view="heading" />,
  );
  const [guide] = overlays(root, 'naver-map-multipath');
  const run = overlays(root, 'naver-map-path').find(props => props.zIndex === 2);
  expect(run?.outlineColor).toBe(darkMapLook.ribbon);
  expect(guide.pathParts[0].outlineColor).toBe(darkMapLook.guideOutline);
  expect(guide.pathParts[0].outlineColor).not.toBe(run?.outlineColor);
  expect(guide.pathParts[0].color).toBe(darkMapLook.guide);
  expect(guide.width).toBeLessThan(run?.width);
  expect(guide.outlineWidth).toBeLessThan(run?.outlineWidth);
});

// S15P31E105-720: the group run screens draw the course in the run start map's mint, not 673's black and purple.
test('a mint line course is the neon mint ribbon round a pale centre; a cancelled one stays grey', () => {
  const root = render(<RunMap route={route} mintLine />);
  const [course] = overlays(root, 'naver-map-multipath');
  expect(course.pathParts[0]).toEqual(
    expect.objectContaining({
      color: mintMapLook.ink,
      outlineColor: mintMapLook.ribbon,
    }),
  );
  expect(mintMapLook.ribbon).toBe('#4DFFD2');
  expect(mintMapLook.ink).toBe('#B8FFEC');
  expect(course.outlineWidth).toBe(mintMapLook.edge);
  // The thin mint keeps the colours at the plain course line's widths.
  const thin = render(<RunMap route={route} mintLine="thin" />);
  const [thinCourse] = overlays(thin, 'naver-map-multipath');
  expect(thinCourse.pathParts[0].outlineColor).toBe(mintMapLook.ribbon);
  expect(thinCourse.width).toBe(2.2);
  expect(thinCourse.outlineWidth).toBe(2.4);
  expect(thinCourse.outlineWidth).toBeLessThan(mintMapLook.edge);
  const muted = render(<RunMap route={route} mintLine muted />);
  const [grey] = overlays(muted, 'naver-map-multipath');
  expect(grey.pathParts[0].color).not.toBe(mintMapLook.ink);
});

// S15P31E105-691: the dark map's course line is the designated neon mint, as on the feed, not the 672 lime.
test('the dark map course line is the designated neon mint', () => {
  expect(darkMapLook.ink).toBe('#4DFFD2');
  expect(darkMapLook.ribbon).toBe('#B3FFEC');
  expect([darkMapLook.shadow, darkMapLook.glowInner, darkMapLook.glowOuter]).toEqual([
    '#00785A',
    '#00785A',
    '#003A2C',
  ]);
});

// S15P31E105-691: the dark map's lines sit halfway between 672's and the running screen's 8.8 dp centre with a
// 1.6 dp edge, so the border reads thinner.
test('the dark map lines are halfway to the running screen line', () => {
  const replayEdge = (darkMapLook.glowOuterWidth - darkMapLook.coreWidth) / 2;
  expect(darkMapLook.coreWidth).toBeCloseTo((5 + 8.8) / 2, 1);
  expect(replayEdge).toBeCloseTo(((24 - 5) / 2 + 1.6) / 2, 1);
  expect(darkMapLook.coreWidth + 2 * darkMapLook.coreEdge).toBeLessThan(
    darkMapLook.glowInnerWidth,
  );
  expect(darkMapLook.glowInnerWidth).toBeLessThan(darkMapLook.glowOuterWidth);
  const detailEdge = (darkMapLook.shadowWidth - darkMapLook.centre) / 2;
  expect(darkMapLook.centre).toBeCloseTo((3.2 + 8.8) / 2, 1);
  expect(detailEdge).toBeCloseTo(((12 - 3.2) / 2 + 1.6) / 2, 1);
  expect(darkMapLook.centre + 2 * darkMapLook.edge).toBeLessThan(
    darkMapLook.shadowWidth,
  );
});

test('a cancelled course is grey and casts no shadow', () => {
  const root = render(<RunMap route={route} muted />);
  expect(count(root, 'naver-map-path')).toBe(0);
});

test('while running the course is a guide: no start, no labels, the run on top', () => {
  const root = render(
    <RunMap
      route={route}
      trail={route.slice(0, 2)}
      paceLabels={['5\'30"']}
      segmentPaces={[330]}
    />,
  );
  expect(texts(root)).not.toContain('S');
  expect(texts(root)).not.toContain('F');
  expect(texts(root)).not.toContain('5\'30"');
  // The course stays a guide ribbon under the run; the run is the ink ribbon over its shadow.
  expect(count(root, 'naver-map-multipath')).toBe(1);
  expect(count(root, 'naver-map-polyline')).toBe(0);
  expect(count(root, 'naver-map-path')).toBe(2);
});

test('the map is the plain Naver day map, with no night map after sunset (S15P31E105-527, -521)', () => {
  const root = render(<RunMap route={route} trail={route.slice(0, 2)} />);
  const map = root.find(
    node => 'customStyleId' in node.props && 'mapType' in node.props,
  );
  expect(map.props.customStyleId).toBeUndefined();
  expect(map.props.mapType).toBe('Basic');
  expect(map.props.isNightModeEnabled).toBeFalsy();
});

test('members are markers and a tap on the map gives the point', () => {
  const onTapMap = jest.fn();
  const root = render(
    <RunMap
      members={[
        { position: route[1], label: '민준', color: '#5D8194' },
        { position: route[2], label: '서연', color: '#5D8194' },
      ]}
      onTapMap={onTapMap}
    />,
  );
  expect(count(root, 'naver-map-marker')).toBe(2);
  ReactTestRenderer.act(() => {
    root
      .find(
        node =>
          typeof node.type === 'string' && node.props.testID === 'naver-map',
      )
      .props.onTapMap({ latitude: 35.1, longitude: 129.1, x: 0, y: 0 });
  });
  expect(onTapMap).toHaveBeenCalledWith([129.1, 35.1]);
});

// S15P31E105-429: the NAVER logo sits just over what the screen covers, counted from the padded bottom.
function layOut(root: ReactTestRenderer.ReactTestInstance, height: number) {
  const map = root.find(node => typeof node.props.onLayout === 'function');
  ReactTestRenderer.act(() => {
    map.props.onLayout({ nativeEvent: { layout: { width: 400, height } } });
  });
  return root.find(
    node => 'mapPadding' in node.props && 'logoAlign' in node.props,
  );
}

test('the logo goes just over the covered part when that reaches above the padding', () => {
  const root = render(
    <RunMap
      position={route[0]}
      area={{ top: 0.36, bottom: 0.36 }}
      logo={{ above: 0.47 }}
    />,
  );
  const map = layOut(root, 1000);
  // Padding bottom 280 (a point at 36%), covered 470: 190 up from the padded bottom, plus 8 of air.
  expect(map.props.logoAlign).toBe('BottomLeft');
  expect(map.props.logoMargin).toEqual({ left: 14, bottom: 198 });
});

test('a padding that ends above the sheet is lowered to it, the logo right on top', () => {
  const root = render(
    <RunMap
      route={route}
      area={{ top: 0.19, bottom: 0.56 }}
      logo={{ above: 0.19, side: 'right' }}
    />,
  );
  const map = layOut(root, 1000);
  expect(map.props.logoAlign).toBe('BottomRight');
  expect(map.props.logoMargin).toEqual({ right: 14, bottom: 8 });
  // The padding ends on the covered part, so the logo sits right on it.
  expect(map.props.mapPadding).toEqual({ top: 190, bottom: 190 });
});

test('lowering the padding to the sheet keeps the zoom and the middle of what is shown', () => {
  const region = {
    latitude: 35.14,
    longitude: 129.1,
    latitudeDelta: 0.02,
    longitudeDelta: 0.03,
  };
  const before = { top: 190, bottom: 440 };
  const after = lowerToLogo(region, before, { above: 0.19 }, 400, 1000);
  expect(after.padding).toEqual({ top: 190, bottom: 190 });
  // Pixels per degree of longitude, as fitBounds picks them for a box.
  const scale = (r: typeof region, box: number) => {
    const cos = Math.cos(((r.latitude + r.latitudeDelta / 2) * Math.PI) / 180);
    return Math.min(400 / r.longitudeDelta, (box * cos) / r.latitudeDelta);
  };
  expect(scale(after.region, 620)).toBeCloseTo(scale(region, 370), 0);
  // The old middle (370/2 below the top padding) still shows the old region's middle.
  const cos = Math.cos(((region.latitude + 0.01) * Math.PI) / 180);
  const newMiddle = after.region.latitude + after.region.latitudeDelta / 2;
  const atOldMiddle =
    newMiddle + ((620 - 370) / 2) * (cos / scale(region, 370));
  expect(atOldMiddle).toBeCloseTo(region.latitude + 0.01, 5);
  expect(after.region.longitude).toBe(region.longitude);
  expect(after.region.longitudeDelta).toBe(region.longitudeDelta);
});

test('without a logo the map keeps its own logo place', () => {
  const root = render(<RunMap route={route} />);
  const map = layOut(root, 1000);
  expect(map.props.logoAlign).toBeUndefined();
  expect(map.props.logoMargin).toBeUndefined();
});

// S15P31E105-521: the tilted views.
test('the map is flat without buildings unless the screen asks for the tilted view', () => {
  const flat = layOut(render(<RunMap route={route} />), 1000);
  expect(flat.props.layerGroups.BUILDING).toBe(false);
  expect(flat.props.camera).toBeUndefined();
  const lean = layOut(render(<RunMap route={route} view="lean" />), 1000);
  expect(lean.props.layerGroups.BUILDING).toBe(true);
  expect(lean.props.layerGroups.TRANSIT).toBe(false);
});

test('the tilted views fit the region at the zoom the flat fit would pick', () => {
  const region = {
    latitude: 37.5,
    longitude: 127,
    latitudeDelta: 0.002,
    longitudeDelta: 0.01,
  };
  // 0.01° of longitude at 37.5° is about 883 m across 400 points.
  expect(zoomFor(region, undefined, 400, 1000)).toBeCloseTo(14.78, 1);
  // Twice the span is one zoom level out.
  expect(
    zoomFor({ ...region, longitudeDelta: 0.02 }, undefined, 400, 1000),
  ).toBeCloseTo(13.78, 1);
  // A tall region is held by the padded height instead.
  const tall = { ...region, latitudeDelta: 0.02, longitudeDelta: 0.001 };
  expect(zoomFor(tall, { top: 250, bottom: 250 }, 400, 1000)).toBeCloseTo(
    zoomFor(tall, undefined, 400, 500),
    5,
  );
});

test('the heading follows the last stretch of the run and holds while standing', () => {
  const start: LngLat = [127, 37.5];
  // About 33 m north, then 26 m east.
  const north: LngLat = [127, 37.5003];
  const east: LngLat = [127.0003, 37.5003];
  expect(headingOf([start, north], 200)).toBeCloseTo(0, 0);
  expect(headingOf([start, north, east], 0)).toBeCloseTo(90, 0);
  // A step of a few metres keeps the heading it had.
  expect(headingOf([north, [127.00002, 37.5003]], 135)).toBe(135);
});

// S15P31E105-549: a measured path in parts is drawn part by part, never joined across a lost position.
test('a trail in parts draws each part on its own, with its shadow', () => {
  const first: LngLat[] = [route[0], route[1]];
  const second: LngLat[] = [route[2], route[3]];
  const root = render(<RunMap trail={route} trailParts={[first, second, [route[3]]]} />);
  const paths = overlays(root, 'naver-map-path');
  // Two shadows and two ink lines; the single point part draws nothing.
  expect(paths).toHaveLength(4);
  expect(paths.map(props => props.coords.length)).toEqual([2, 2, 2, 2]);
});

test('a record route in parts goes to the multipath as separate parts with one shadow each', () => {
  const first: LngLat[] = [route[0], route[1]];
  const second: LngLat[] = [route[2], route[3]];
  const root = render(<RunMap route={route} routeParts={[first, second]} interactive={false} />);
  expect(overlays(root, 'naver-map-multipath')[0].pathParts).toHaveLength(2);
  expect(overlays(root, 'naver-map-path')).toHaveLength(2);
  expect(texts(root)).toEqual(expect.arrayContaining(['S', 'F']));
});

test('a course pause connector is grey and separate from measured route', () => {
  const root = render(<RunMap route={route} unmeasuredEdges={[1]} interactive={false} />);
  expect(overlays(root, 'naver-map-multipath')[0].pathParts).toHaveLength(2);
  expect(overlays(root, 'naver-map-path')).toEqual(
    expect.arrayContaining([expect.objectContaining({ color: '#8A979E', coords: expect.any(Array) })]),
  );
});

// A-3/B-3 (S15P31E105-549 review): parts of one point each never become one joined line.
test('a record route of single-point parts draws no line between them', () => {
  const root = render(
    <RunMap route={[route[0], route[2]]} routeParts={[[route[0]], [route[2]]]} interactive={false} />,
  );
  expect(overlays(root, 'naver-map-multipath')).toHaveLength(0);
  expect(overlays(root, 'naver-map-path')).toHaveLength(0);
});

// S15P31E105-659: 편도 추천 조건 화면은 출발·도착 두 끝점을 함께 보여 준다.
test('a start and a destination stand on S and F poles', () => {
  const start: LngLat = [129.13, 35.15];
  const end: LngLat = [129.2, 35.2];
  const root = render(<RunMap position={start} destination={end} />);
  expect(texts(root)).toEqual(expect.arrayContaining(['S', 'F']));
  const markers = overlays(root, 'naver-map-marker');
  expect(markers).toHaveLength(2);
  expect(markers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ latitude: 35.15, longitude: 129.13 }),
      expect.objectContaining({ latitude: 35.2, longitude: 129.2 }),
    ]),
  );
});

test('without a destination only the start dot shows; a course or run ignores the destination', () => {
  const start: LngLat = [129.13, 35.15];
  const alone = render(<RunMap position={start} />);
  expect(texts(alone)).not.toContain('S');
  expect(texts(alone)).not.toContain('F');
  expect(count(alone, 'naver-map-marker')).toBe(1);

  const withCourse = render(
    <RunMap route={route} position={start} destination={[129.2, 35.2]} />,
  );
  expect(texts(withCourse)).toContain('F');
  expect(count(withCourse, 'naver-map-marker')).toBe(2);
});
