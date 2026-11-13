import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RunMap } from '../src/components/RunMap';
import type { LngLat } from '../src/geo';

// A covered map can take its markers off (markers={false}): the native map then stops redrawing their views
// (7.2's map under the course replay). The lines stay, and true, the default, keeps every other map as it was.

const naverMap = jest.requireMock('@mj-studio/react-native-naver-map') as {
  __holdMapsReady: (held: boolean) => void;
  __readyHeldMaps: () => void;
};

const route: LngLat[] = [
  [129.13, 35.15],
  [129.135, 35.152],
  [129.14, 35.155],
];

const count = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(
    node => typeof node.type === 'string' && node.props.testID === testID,
  ).length;
const markers = (root: ReactTestRenderer.ReactTestInstance) =>
  count(root, 'naver-map-marker');
const lines = (root: ReactTestRenderer.ReactTestInstance) =>
  count(root, 'naver-map-path') + count(root, 'naver-map-multipath');

afterEach(() => naverMap.__holdMapsReady(false));

test('a map keeps its S and F poles by default', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<RunMap route={route} />);
  });
  expect(markers(renderer.root)).toBe(2);
  expect(lines(renderer.root)).toBeGreaterThan(0);
});

test('markers off takes the poles off and keeps the lines; back on brings them back', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<RunMap route={route} />);
  });
  const shownLines = lines(renderer.root);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} markers={false} />),
  );
  expect(markers(renderer.root)).toBe(0);
  expect(lines(renderer.root)).toBe(shownLines);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} markers />),
  );
  expect(markers(renderer.root)).toBe(2);
  expect(lines(renderer.root)).toBe(shownLines);
});

// S15P31E105-739: the waiting room's small map leaves the poles out so the km pills stay clear; pills stay.
test('poles off takes only the S and F poles off', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <RunMap route={route} paceLabels={['5′36″']} poles={false} />,
    );
  });
  const withoutPoles = markers(renderer.root);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} paceLabels={['5′36″']} />),
  );
  expect(markers(renderer.root)).toBe(withoutPoles + 2);
  expect(withoutPoles).toBeGreaterThan(0);
});

// S15P31E105-692: nothing goes on a map before it is ready, whatever markers says, so turning them on or off
// then removes nothing from the native map.
test('switching markers before the map is ready puts nothing on it', () => {
  naverMap.__holdMapsReady(true);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <RunMap route={route} markers={false} />,
    );
  });
  const overlays = () => markers(renderer.root) + lines(renderer.root);
  expect(overlays()).toBe(0);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} markers />),
  );
  expect(overlays()).toBe(0);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} markers={false} />),
  );
  expect(overlays()).toBe(0);
  ReactTestRenderer.act(() => naverMap.__readyHeldMaps());
  // Ready with markers off: the lines only.
  expect(markers(renderer.root)).toBe(0);
  expect(lines(renderer.root)).toBeGreaterThan(0);
  ReactTestRenderer.act(() =>
    renderer.update(<RunMap route={route} markers />),
  );
  expect(markers(renderer.root)).toBe(2);
  ReactTestRenderer.act(() => renderer.unmount());
});
