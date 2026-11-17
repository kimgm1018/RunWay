import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { RunMap } from '../src/components/RunMap';
import {
  mapAutoRemakes,
  mapInitTimeoutMs,
  mapLoadTimeoutMs,
  mapRemakeGapMs,
} from '../src/components/MapLoadGuard';
import {
  authRetryDelayMs,
  getMapAuthState,
  mapCreateGapMs,
  remakeStartDelayMs,
  remakeStartMaxMs,
  reportMapFailure,
  resetMapAuthForTests,
  retryCapMs,
  retryDelaysMs,
  setMapRandom,
} from '../src/components/naverMapAuth';
import type { LngLat } from '../src/geo';

// S15P31E105-898: a NAVER map that cannot authorize or load says so over itself and can be made again.

const naver = jest.requireMock('@mj-studio/react-native-naver-map') as {
  __holdMapsLoaded: (held: boolean) => void;
  __loadHeldMaps: () => void;
  __holdMapsReady: (held: boolean) => void;
  __readyHeldMaps: () => void;
};

const route: LngLat[] = [
  [129.13, 35.15],
  [129.14, 35.155],
];

let os: string;
let warn: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  os = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => 'android',
  });
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  resetMapAuthForTests();
  // The middle of every jitter: pauses as listed, remade maps start after half the random start.
  setMapRandom(() => 0.5);
  naver.__holdMapsLoaded(true);
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  ReactTestRenderer.act(() => {
    for (const renderer of mounted.splice(0)) renderer.unmount();
  });
  naver.__holdMapsLoaded(false);
  naver.__loadHeldMaps();
  naver.__holdMapsReady(false);
  naver.__readyHeldMaps();
  resetMapAuthForTests();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  warn.mockRestore();
  jest.useRealTimers();
});

function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <RunMap route={route} style={{ height: 200 }} />,
    );
  });
  mounted.push(renderer);
  const root = renderer.root;
  // On screen: the map has a size.
  const frame = root.find(node => typeof node.props.onLayout === 'function');
  ReactTestRenderer.act(() => {
    frame.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 200 } },
    });
  });
  return root;
}

const failure = (root: ReactTestRenderer.ReactTestInstance) =>
  root.findAll(
    node =>
      typeof node.type === 'string' && node.props.testID === 'map-load-failure',
  ).length;

const maps = (root: ReactTestRenderer.ReactTestInstance) =>
  root.findAll(
    node => typeof node.type === 'string' && node.props.testID === 'naver-map',
  );

const advance = (ms: number) =>
  ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(ms);
  });

test('a map still blank after the limit says so, and goes away once it draws', () => {
  const root = render();
  advance(mapLoadTimeoutMs - 1);
  expect(failure(root)).toBe(0);
  advance(1);
  expect(failure(root)).toBe(1);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('load timeout code=network'),
  );
  ReactTestRenderer.act(() => naver.__loadHeldMaps());
  expect(failure(root)).toBe(0);
});

test('다시 시도 makes the map again', () => {
  const root = render();
  advance(mapLoadTimeoutMs);
  const before = maps(root)[0];
  const retry = root.find(
    node =>
      node.props.testID === 'map-load-retry' &&
      typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => retry.props.onPress());
  expect(failure(root)).toBe(0);
  expect(getMapAuthState().generation).toBe(1);
  // Made again after its own random start.
  advance(remakeStartMaxMs / 2);
  expect(maps(root)[0]).toBeDefined();
  expect(maps(root)[0]).not.toBe(before);
  // The new map draws: nothing more to say.
  ReactTestRenderer.act(() => naver.__loadHeldMaps());
  advance(mapLoadTimeoutMs);
  expect(failure(root)).toBe(0);
});

test('an auth failure shows at once on blank maps and retries on its own until a map loads', () => {
  const root = render();
  ReactTestRenderer.act(() => reportMapFailure('429', 'source=sdk'));
  expect(failure(root)).toBe(1);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('auth failed code=429'),
  );
  const before = maps(root)[0];
  advance(retryDelaysMs[0] - 1);
  expect(maps(root)[0]).toBe(before);
  advance(1);
  advance(remakeStartMaxMs / 2);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('retry reason=auto map=map#'),
  );
  const second = maps(root)[0];
  expect(second).toBeDefined();
  expect(second).not.toBe(before);
  // The next pause is longer; it counts from the last retry.
  advance(retryDelaysMs[1] - remakeStartMaxMs / 2 - 1);
  expect(maps(root)[0]).toBe(second);
  advance(1);
  advance(remakeStartMaxMs / 2);
  expect(maps(root)[0]).not.toBe(second);
  // Still failing until a map loads; then the failure is over.
  expect(failure(root)).toBe(1);
  ReactTestRenderer.act(() => naver.__loadHeldMaps());
  expect(failure(root)).toBe(0);
  expect(getMapAuthState().failure).toBeNull();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('recovered after code=429'),
  );
  // No more retries once recovered.
  const drawn = maps(root)[0];
  advance(retryCapMs * 2);
  expect(maps(root)[0]).toBe(drawn);
});

test('a map that already loaded is left alone by an auth failure elsewhere', () => {
  naver.__holdMapsLoaded(false);
  const root = render();
  const before = maps(root)[0];
  ReactTestRenderer.act(() => reportMapFailure('401'));
  expect(failure(root)).toBe(0);
  advance(retryDelaysMs[0]);
  expect(maps(root)[0]).toBe(before);
});

test('on iOS (no load event) nothing is watched', () => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => 'ios',
  });
  const root = render();
  advance(mapLoadTimeoutMs * 2);
  expect(failure(root)).toBe(0);
});

test('a map that never says it is ready is made again a few times, then says so', () => {
  naver.__holdMapsReady(true);
  const root = render();
  let current = maps(root)[0];
  for (let remake = 1; remake <= mapAutoRemakes; remake += 1) {
    advance(mapInitTimeoutMs);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`no ready signal map=map#`),
    );
    expect(failure(root)).toBe(0);
    advance(mapRemakeGapMs * remake);
    advance(remakeStartMaxMs / 2);
    expect(maps(root)[0]).toBeDefined();
    expect(maps(root)[0]).not.toBe(current);
    current = maps(root)[0];
  }
  advance(mapInitTimeoutMs);
  expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('giving up'));
  expect(failure(root)).toBe(1);
  // The remade map comes ready and draws: the cover goes.
  ReactTestRenderer.act(() => {
    naver.__readyHeldMaps();
    naver.__loadHeldMaps();
  });
  expect(failure(root)).toBe(0);
});

test('maps made together are spaced out', () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <>
        <RunMap route={route} style={{ height: 100 }} compact />
        <RunMap route={route} style={{ height: 100 }} compact />
      </>,
    );
  });
  mounted.push(renderer);
  expect(maps(renderer.root)).toHaveLength(1);
  advance(mapCreateGapMs);
  expect(maps(renderer.root)).toHaveLength(2);
});

test('each retry pause is jittered within ±20% and capped at 30 s', () => {
  // The first pause: 3 s, from 2.4 s to 3.6 s.
  expect(authRetryDelayMs(0, 0)).toBe(2400);
  expect(authRetryDelayMs(0, 0.5)).toBe(3000);
  expect(authRetryDelayMs(0, 0.999999)).toBe(3600);
  // Doubling: 6, 12, 24 s.
  expect(authRetryDelayMs(1, 0.5)).toBe(6000);
  expect(authRetryDelayMs(2, 0.5)).toBe(12000);
  expect(authRetryDelayMs(3, 0)).toBe(19200);
  expect(authRetryDelayMs(3, 0.999999)).toBe(28800);
  // The cap: 30 s, from 24 s, never over 30 s; it repeats.
  expect(authRetryDelayMs(4, 0)).toBe(24000);
  expect(authRetryDelayMs(4, 0.5)).toBe(retryCapMs);
  expect(authRetryDelayMs(4, 0.999999)).toBe(retryCapMs);
  expect(authRetryDelayMs(40, 0)).toBe(24000);
  expect(authRetryDelayMs(40, 0.999999)).toBe(retryCapMs);
});

test('a remade map starts after 0 to 500 ms', () => {
  expect(remakeStartDelayMs(0)).toBe(0);
  expect(remakeStartDelayMs(0.5)).toBe(250);
  expect(remakeStartDelayMs(0.999999)).toBe(remakeStartMaxMs);
});

test('the maps of one screen retry at their own times', () => {
  // Each map draws its own pause: the first one short, the second one long.
  const draws = [0, 0.999999];
  let next = 0;
  setMapRandom(() => draws[next++ % draws.length]);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <>
        <RunMap route={route} style={{ height: 100 }} compact />
        <RunMap route={route} style={{ height: 100 }} compact />
      </>,
    );
  });
  mounted.push(renderer);
  advance(mapCreateGapMs);
  const [first, second] = maps(renderer.root);
  ReactTestRenderer.act(() => reportMapFailure('429'));
  // 2.4 s for one map, 3.6 s for the other (plus each one's random start).
  advance(2400);
  advance(remakeStartMaxMs);
  const between = maps(renderer.root);
  expect(between).toHaveLength(2);
  expect(between).toContain(second);
  expect(between).not.toContain(first);
  advance(1200);
  advance(remakeStartMaxMs);
  const after = maps(renderer.root);
  expect(after).toHaveLength(2);
  expect(after).not.toContain(second);
});
