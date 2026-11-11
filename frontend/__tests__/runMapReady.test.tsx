import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RunMap } from '../src/components/RunMap';
import type { LngLat } from '../src/geo';

// S15P31E105-692: the Naver map adds overlays only once it is ready, so an overlay React removes before that
// crashed the app (getChildAt on an empty list) when a feed page left before its map came up. RunMap now puts
// nothing on a map until it is ready.

const naverMap = jest.requireMock('@mj-studio/react-native-naver-map') as {
  __holdMapsReady: (held: boolean) => void;
  __readyHeldMaps: () => void;
};

const route: LngLat[] = [
  [129.13, 35.15],
  [129.135, 35.152],
  [129.14, 35.155],
];

const overlays = (root: ReactTestRenderer.ReactTestInstance) =>
  root.findAll(
    node =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      node.props.testID.startsWith('naver-map-'),
  ).length;

afterEach(() => naverMap.__holdMapsReady(false));

test('a map that is not ready yet holds no overlays, so leaving it removes none', () => {
  naverMap.__holdMapsReady(true);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<RunMap route={route} />);
  });
  expect(overlays(renderer.root)).toBe(0);
  // Leaving before the map is ready (a feed switch) has nothing to take off it.
  ReactTestRenderer.act(() => renderer.unmount());
});

test('once the map is ready its course is drawn', () => {
  naverMap.__holdMapsReady(true);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<RunMap route={route} />);
  });
  expect(overlays(renderer.root)).toBe(0);
  ReactTestRenderer.act(() => naverMap.__readyHeldMaps());
  expect(overlays(renderer.root)).toBeGreaterThan(0);
});
