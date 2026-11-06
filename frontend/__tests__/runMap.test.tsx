import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { lowerToLogo, RunMap } from '../src/components/RunMap';
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
      dark={false}
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
  // After sunset the course is dashed under the run.
  expect(count(root, 'naver-map-polyline')).toBe(1);
  expect(count(root, 'naver-map-path')).toBe(1);
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
      dark={false}
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
      dark={false}
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
  const root = render(<RunMap dark={false} route={route} />);
  const map = layOut(root, 1000);
  expect(map.props.logoAlign).toBeUndefined();
  expect(map.props.logoMargin).toBeUndefined();
});
