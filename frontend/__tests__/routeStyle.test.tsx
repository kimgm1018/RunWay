import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Polyline } from 'react-native-svg';
import {
  NaverMapMultiPathOverlay,
  NaverMapPathOverlay,
} from '@mj-studio/react-native-naver-map';
import { RunMap } from '../src/components/RunMap';
import { RouteLine as CourseLine } from '../src/screens/course/RouteLine';
import { CourseGlyph } from '../src/screens/course/SavedCoursesScreen';
import { RouteLine as FeedLine } from '../src/screens/community/FeedPage';
import { RouteTrace } from '../src/screens/run/resultLook';
import {
  RouteReplay,
  type ReplayRun,
} from '../src/screens/community/RouteReplay';
import type { LngLat } from '../src/geo';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const route: LngLat[] = [
  [129.1, 35.15],
  [129.101, 35.151],
  [129.102, 35.15],
];
const shape: [number, number][] = [
  [0.1, 0.8],
  [0.5, 0.2],
  [0.9, 0.8],
];
const run: ReplayRun = {
  key: 'style-test',
  kind: '경로',
  title: '합성 경로',
  byline: '',
  startedAt: '2026-11-12T00:00:00Z',
  shareMessage: '',
  link: null,
  runner: { nickname: '나', userId: '', photo: null, mine: true },
  distanceM: 300,
  durationSec: 120,
  averagePaceSecPerKm: 400,
  cadence: null,
  shape,
  parts: null,
};

async function withScreen(
  element: React.ReactElement,
  check: (root: TestRenderer.ReactTestInstance) => void,
) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(element);
  });
  try {
    check(screen.root);
  } finally {
    await act(async () => screen.unmount());
  }
}

test.each([
  ['flat', {}],
  ['tilted', { view: 'lean' as const }],
  ['mint', { look: 'mint' as const, mintLine: true }],
])(
  '%s maps draw the approved community outline around the mint route',
  async (_, props) => {
    await withScreen(<RunMap route={route} {...props} />, root => {
      const paths = root
        .findAllByType(NaverMapPathOverlay)
        .map(node => node.props);
      expect(paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ color: '#003A2C', width: 18 }),
          expect.objectContaining({ color: '#00785A', width: 12.2 }),
        ]),
      );
      const core = root.findByType(NaverMapMultiPathOverlay).props;
      expect(core.width).toBe(6.9);
      expect(core.outlineWidth).toBe(1.2);
      expect(core.pathParts[0]).toEqual(
        expect.objectContaining({ color: '#4DFFD2', outlineColor: '#B3FFEC' }),
      );
    });
  },
);

test('a replay without GPS uses the same four visible route layers', async () => {
  // Freeze animation time while leaving React's scheduler real, as in the community playback tests.
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'],
  });
  try {
    await withScreen(
      <RouteReplay run={run} visible onClose={() => undefined} />,
      root => {
        const lines = root
          .findAllByType(Polyline)
          .filter(node => node.props.strokeDasharray)
          .map(node => node.props);
        expect(lines.map(line => line.stroke)).toEqual([
          '#003A2C',
          '#00785A',
          '#B3FFEC',
          '#4DFFD2',
        ]);
      },
    );
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test('each separate measured replay part has the full outline without bridging its gap', async () => {
  const parts = [route.slice(0, 2), route.slice(1)];
  await withScreen(
    <RouteReplay run={{ ...run, parts }} visible onClose={() => undefined} />,
    root => {
      const lines = root
        .findAllByType(NaverMapPathOverlay)
        .map(node => node.props);
      expect(lines).toHaveLength(6);
      for (const line of lines) {
        expect(line.coords).toHaveLength(2);
      }
      expect(lines.map(line => line.passedColor)).toEqual([
        '#003A2C',
        '#00785A',
        '#4DFFD2',
        '#003A2C',
        '#00785A',
        '#4DFFD2',
      ]);
    },
  );
});

test.each([
  ['course fallback', <CourseLine route={route} />],
  ['saved card', <CourseGlyph shape={shape} />],
  ['feed fallback', <FeedLine shape={shape} width={300} height={600} />],
  ['run result', <RouteTrace route={route} width={300} height={200} />],
])(
  '%s uses the same four route layers with proportional widths',
  async (_, element) => {
    await withScreen(element, root => {
      const lines = root.findAllByType(Polyline).map(node => node.props);
      expect(lines.map(line => line.stroke)).toEqual([
        '#003A2C',
        '#00785A',
        '#B3FFEC',
        '#4DFFD2',
      ]);
      expect(lines.map(line => line.points)).toEqual(
        Array(4).fill(lines[0].points),
      );
      const scale = lines[0].strokeWidth / 18;
      [18, 12.2, 9.3, 6.9].forEach((width, index) => {
        expect(lines[index].strokeWidth).toBeCloseTo(width * scale, 5);
        expect(lines[index].strokeLinecap).toBe('round');
        expect(lines[index].strokeLinejoin).toBe('round');
      });
    });
  },
);
