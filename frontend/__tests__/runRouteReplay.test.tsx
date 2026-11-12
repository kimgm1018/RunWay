import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { NaverMapPathOverlay } from '@mj-studio/react-native-naver-map';
import { ToastProvider } from '../src/components';
import {
  calmRunPart,
  runRouteOf,
  shortRouteM,
  spikeM,
} from '../src/components/mapRoute';
import { RunMap } from '../src/components/RunMap';
import {
  createMockRepositories,
  DataProvider,
  type RunRecordDetail,
} from '../src/data';
import { distanceM, type LngLat } from '../src/geo';
import { lineOfParts } from '../src/screens/community/RouteReplay';
import { RecordView } from '../src/screens/records/RecordView';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// S15P31E105-690: my run's GPS route on the map (4.5 러닝 결과 · 5.1 기록 카드) and its 경로 재생. Points are synthetic.

// Two parts along a street with a 100 m break between them (a source change or lost GPS), about 200 m each.
const north = (from: number, metres: number): LngLat[] =>
  Array.from({ length: 5 }, (_, index) => [
    129.1,
    35.15 + (from + (metres * index) / 4) / 111320,
  ]);
const first = north(0, 200);
const second = north(300, 200);

// Lines compared point by point to well under a centimetre (the calming averages, so floats differ in the last bits).
const near = (line: LngLat[] | undefined, want: LngLat[]) => {
  expect(line).toHaveLength(want.length);
  line?.forEach((point, index) =>
    expect(distanceM(point, want[index])).toBeLessThan(0.01),
  );
};
const nearParts = (parts: LngLat[][] | undefined, want: LngLat[][]) => {
  expect(parts).toHaveLength(want.length);
  parts?.forEach((part, index) => near(part, want[index]));
};

test('a run is drawn only when its parts of two or more points cover enough ground', () => {
  expect(runRouteOf(null)).toBeNull();
  expect(runRouteOf([])).toBeNull();
  // A single point, or a few metres of drift indoors, is no route.
  expect(runRouteOf([[first[0]]])).toBeNull();
  expect(runRouteOf([north(0, shortRouteM / 2)])).toBeNull();
  // Lone points are dropped; the parts stay apart and the camera line is them in order.
  const kept = runRouteOf([first, [second[0]], second]);
  nearParts(kept?.parts, [first, second]);
  near(kept?.route, [...first, ...second]);
  // One part is its own line; a straight, even line stays as it was.
  near(runRouteOf([first])?.route, first);
});

// Points east of a start, in metres along and across a street.
const east = (points: [number, number][]): LngLat[] =>
  points.map(([along, across]) => [
    129.1 + along / (111320 * Math.cos((35.15 * Math.PI) / 180)),
    35.15 + across / 111320,
  ]);

test('the map line drops GPS spikes and calms the zigzag, keeping where the run began and ended', () => {
  // A jump 40 m off the street and straight back is no step of the run.
  const spiked = east([
    [0, 0],
    [10, 0],
    [20, 0],
    [25, 40],
    [30, 0],
    [40, 0],
    [50, 0],
  ]);
  const calm = calmRunPart(spiked);
  expect(calm).toHaveLength(6);
  calm.forEach(point =>
    expect(Math.abs(point[1] - 35.15) * 111320).toBeLessThan(1),
  );
  // A turn longer than a spike is kept.
  expect(
    calmRunPart(
      east([
        [0, 0],
        [0, spikeM * 2],
        [spikeM * 2, spikeM * 2],
      ]),
    ),
  ).toHaveLength(3);
  // Wander of 6 m either side of a straight street is mostly smoothed away; the ends stay put.
  const zigzag = east(
    Array.from({ length: 21 }, (_, index) => [
      index * 10,
      index % 2 === 0 ? 6 : -6,
    ]),
  );
  const smooth = calmRunPart(zigzag);
  expect(smooth[0]).toEqual(zigzag[0]);
  expect(smooth[20]).toEqual(zigzag[20]);
  smooth
    .slice(2, -2)
    .forEach(point =>
      expect(Math.abs(point[1] - 35.15) * 111320).toBeLessThan(1.5),
    );
});

test('the replay plays my parts as one line whose breaks are unmeasured edges', () => {
  // Two parts of five points: the edge from point 4 (the first part's end) to point 5 is the break.
  expect(lineOfParts([first, second])).toEqual({
    route: [...first, ...second],
    unmeasuredEdges: [4],
  });
  // Lone points are no part; one part has no breaks.
  expect(lineOfParts([first, [second[0]]])).toEqual({
    route: first,
    unmeasuredEdges: [],
  });
  expect(lineOfParts([])).toEqual({ route: [], unmeasuredEdges: [] });
});

const record = (change: Partial<RunRecordDetail> = {}): RunRecordDetail => ({
  id: 'run-1',
  title: '아침 러닝',
  startedAt: '2026-11-08T22:10:00Z',
  distanceM: 400,
  durationSec: 150,
  averagePaceSecPerKm: 375,
  shape: [],
  runType: 'SOLO',
  group: null,
  goalAchieved: null,
  route: null,
  routeParts: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
  averageHeartRate: null,
  aiAdvice: null,
  splits: [],
  courseId: null,
  myCourseId: null,
  ...change,
});

async function card(
  change: Partial<RunRecordDetail>,
  layout: 'records' | 'home' = 'records',
) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={createMockRepositories({ latencyMs: 0 })}>
        <ToastProvider>
          <RecordView record={record(change)} chartHeight={0} layout={layout} />
        </ToastProvider>
      </DataProvider>,
    );
  });
  return screen;
}

const texts = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

test('5.1 draws the record route on the map in its parts and plays it back from 경로 재생', async () => {
  const screen = await card({ routeParts: [first, second] });
  const map = screen.root.findByType(RunMap);
  nearParts(map.props.routeParts, [first, second]);
  near(map.props.route, [...first, ...second]);
  expect(texts(screen)).not.toContain('경로 기록이 없어요');

  await act(async () => {
    screen.root
      .find(
        node =>
          node.props.accessibilityLabel === '경로 재생' &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress();
  });
  // Each part is its own line, and my run draws no grey connector over the break (S15P31E105-552 draws one for a
  // shared course's unmeasured edges).
  const lines = screen.root.findAll(
    node =>
      node.type === NaverMapPathOverlay && node.props.passedColor !== undefined,
  );
  expect(lines).toHaveLength(2);
  expect(
    screen.root.findAll(
      node =>
        node.type === NaverMapPathOverlay && node.props.color === '#8A979E',
    ),
  ).toHaveLength(0);
  expect(texts(screen)).toContain('평균 페이스 (/KM)');
  expect(
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '경로 재생 닫기' &&
        typeof node.props.onPress === 'function',
    ).length,
  ).toBeGreaterThan(0);
  await act(async () => screen.unmount());
});

// My run's replay waits for its map's first tiles under the same loading cover as 7.2's (S15P31E105-719).
test('경로 재생 shows a loading cover until its map has drawn', async () => {
  const naverMap = jest.requireMock('@mj-studio/react-native-naver-map') as {
    __holdMapsLoaded: (held: boolean) => void;
    __loadHeldMaps: () => void;
  };
  naverMap.__holdMapsLoaded(true);
  try {
    const screen = await card({ routeParts: [first, second] });
    await act(async () => {
      screen.root
        .find(
          node =>
            node.props.accessibilityLabel === '경로 재생' &&
            typeof node.props.onPress === 'function',
        )
        .props.onPress();
    });
    const loading = () =>
      screen.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'replay-map-loading',
      ).length;
    expect(loading()).toBe(1);
    await act(async () => naverMap.__loadHeldMaps());
    expect(loading()).toBe(0);
    await act(async () => screen.unmount());
  } finally {
    naverMap.__holdMapsLoaded(false);
  }
});

test('5.1 says a run without a route has none, with no map and no replay', async () => {
  for (const routeParts of [null, [north(0, 10)]]) {
    const screen = await card({ routeParts });
    expect(screen.root.findAllByType(RunMap)).toHaveLength(0);
    expect(texts(screen)).toContain('경로 기록이 없어요');
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '경로 재생',
      ),
    ).toHaveLength(0);
    await act(async () => screen.unmount());
  }
});

// A past run opens on 2.1 러닝 분석 (S15P31E105-594), so its card carries the map too.
test('2.1 러닝 분석 shows the run route under its card, or says there is none', async () => {
  const drawn = await card({ routeParts: [first, second] }, 'home');
  nearParts(drawn.root.findByType(RunMap).props.routeParts, [first, second]);
  expect(
    drawn.root.findAll(
      node =>
        node.props.accessibilityLabel === '경로 재생' &&
        typeof node.props.onPress === 'function',
    ).length,
  ).toBeGreaterThan(0);
  await act(async () => drawn.unmount());

  const none = await card({ routeParts: null }, 'home');
  expect(none.root.findAllByType(RunMap)).toHaveLength(0);
  expect(texts(none)).toContain('경로 기록이 없어요');
  await act(async () => none.unmount());
});
