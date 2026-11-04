import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RunMap } from '../src/components/RunMap';
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
