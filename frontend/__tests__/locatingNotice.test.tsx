import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { LOCATING_AFTER_MS, locatingNotice } from '../src/screens/run/RunProgressScreen';
import { LiveMapPanel } from '../src/screens/run/live/RunLivePages';
import type { RunControlState } from '../src/screens/run/runControl';
import type { LiveMetrics } from '../src/watch/liveMetrics';

// 지도 보기의 "위치 확인 중"(S15P31E105-549). 합성 값만 쓴다.

const NOW = 1_000_000;

const live = (positionReceivedAt: number | null): LiveMetrics => ({
  source: 'WATCH',
  heartRate: 150,
  cadence: 170,
  distanceM: 1000,
  paceSecPerKm: 360,
  route: [],
  routeParts: [],
  here: null,
  positionReceivedAt,
  newSample: true,
  measuredAt: null,
  receivedAt: NOW,
});

const control = (change: Partial<RunControlState>): RunControlState => ({
  sessionId: '1',
  status: 'RUNNING',
  stateVersion: 2,
  startedAt: '2026-11-10T01:00:00Z',
  endedAt: null,
  pending: null,
  problem: null,
  joined: false,
  comparison: null,
  coaching: null,
  currentBpm: null,
  live: null,
  recordingMode: 'WATCH',
  watchLost: false,
  phoneGps: 'on',
  approxPosition: null,
  clock: null,
  watchRemoteGps: null,
  watchGps: null,
  ...change,
});

test('the notice shows only in a running watch run without a usable position for over 30 s', () => {
  // No position yet since the start.
  expect(locatingNotice(control({}), NOW)).toBe('위치 확인 중');
  // A position from the watch or the phone just now.
  expect(locatingNotice(control({ live: live(NOW - 5_000) }), NOW)).toBeNull();
  expect(locatingNotice(control({ live: live(NOW - LOCATING_AFTER_MS) }), NOW)).toBeNull();
  expect(locatingNotice(control({ live: live(NOW - LOCATING_AFTER_MS - 1) }), NOW)).toBe(
    '위치 확인 중',
  );
  // Paused, not started, a phone run (its own line covers GPS) or no control: nothing.
  expect(locatingNotice(control({ status: 'PAUSED' }), NOW)).toBeNull();
  expect(locatingNotice(control({ startedAt: null }), NOW)).toBeNull();
  expect(locatingNotice(control({ recordingMode: 'PHONE_FALLBACK' }), NOW)).toBeNull();
  expect(locatingNotice(null, NOW)).toBeNull();
});

test('the map shows the notice text and leaves it out without one', async () => {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <LiveMapPanel route={undefined} trail={[]} notice="위치 확인 중" area={undefined} logo={undefined} />,
    );
  });
  const texts = () =>
    screen.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
  expect(texts()).toContain('위치 확인 중');
  await act(async () => {
    screen.update(<LiveMapPanel route={undefined} trail={[]} notice={null} area={undefined} logo={undefined} />);
  });
  expect(texts()).not.toContain('위치 확인 중');
  await act(async () => screen.unmount());
});
