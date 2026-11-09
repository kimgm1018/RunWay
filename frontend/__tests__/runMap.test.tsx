import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  headingOf,
  lowerToLogo,
  RunMap,
  zoomFor,
} from '../src/components/RunMap';
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

test('a course with paces shows the start and one pace label per km', () => {
  const root = render(
    <RunMap
      route={route}
      segmentPaces={[330, 345, 360]}
      paceLabels={['5\'30"', '5\'45"', '6\'00"']}
    />,
  );
  expect(texts(root)).toEqual(
    expect.arrayContaining(['SF', '5\'30"', '5\'45"', '6\'00"']),
  );
  expect(count(root, 'naver-map-multipath')).toBe(1);
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
  expect(texts(root)).not.toContain('SF');
  expect(texts(root)).not.toContain('5\'30"');
  // The course stays a hollow line under the run, by day and after sunset alike.
  expect(count(root, 'naver-map-multipath')).toBe(1);
  expect(count(root, 'naver-map-polyline')).toBe(0);
  expect(count(root, 'naver-map-path')).toBe(1);
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
