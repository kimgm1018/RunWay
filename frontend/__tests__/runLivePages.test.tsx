import React from 'react';
import { StyleSheet, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createApiRepositories, createMockRepositories } from '../src/data';
import type { RunGuidance, RunSample } from '../src/data';
import { RunLiveFrame } from '../src/screens/run/live/RunLiveFrame';
import {
  CoachingPage,
  metricPages,
} from '../src/screens/run/live/RunLivePages';
import { lastCoaching } from '../src/screens/run/runControl';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// 러닝 중 화면의 수치 페이지(S15P31E105-517): values keep their own names, and a missing value says so.

const texts = (root: TestRenderer.ReactTestInstance) =>
  root
    .findAll(node => typeof node.props.children === 'string')
    .map(node => node.props.children as string)
    .join(' ');

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer.root;
}

const now = new Date('2026-11-07T08:00:00Z');
const coaching = {
  commandId: 'cmd-1',
  coachingId: 'co-1',
  expectedVersion: 3,
  targetBpm: 168,
  recommendedPaceSecPerKm: 345,
  expiresAt: '2026-11-07T08:05:00Z',
};

test('코칭 names the target BPM, the applied BPM and the cadence apart, and the app gap as the app’s', () => {
  const root = render(
    <CoachingPage
      pace={350}
      goalPace={360}
      coaching={coaching}
      currentBpm={164}
      cadence={171}
      now={now}
    />,
  );
  const shown = texts(root);
  for (const text of [
    '추천 페이스',
    '5′45″',
    '목표 BPM',
    '168',
    '적용 BPM',
    '164',
    '워치 적용이 확인된 값',
    '케이던스',
    '171',
    '목표보다 10초 빠름',
    '앱이 현재 페이스로 계산',
  ]) {
    expect(shown).toContain(text);
  }
  expect(shown).not.toContain('지난 코칭');
});

test('an expired coaching is marked, and without coaching or measures nothing is made up', () => {
  const expired = texts(
    render(
      <CoachingPage
        pace={null}
        goalPace={null}
        coaching={{ ...coaching, expiresAt: '2026-11-07T07:59:00Z' }}
        currentBpm={null}
        cadence={null}
        now={now}
      />,
    ),
  );
  expect(expired).toContain('지난 코칭 · 새 코칭을 기다려요');
  expect(expired).toContain('적용이 확인된 값 없음');
  expect(expired).toContain('설정 안 함');

  const empty = texts(
    render(
      <CoachingPage
        pace={350}
        goalPace={360}
        coaching={null}
        currentBpm={null}
        cadence={null}
        now={now}
      />,
    ),
  );
  expect(empty).toContain('아직 받은 코칭이 없어요');
  expect(empty).not.toContain('추천 페이스');
});

// S15P31E105-782: the 코칭 tab was put in a View with no height, so the page (flex: 1) had none and drew empty
// tiles. The page is the pager's page itself and carries the phone-only line inside.
test('코칭 is the page itself and says why a phone-only run has no heart-rate coaching', () => {
  const root = render(
    <CoachingPage
      pace={350}
      goalPace={null}
      coaching={null}
      currentBpm={null}
      cadence={null}
      now={now}
      phoneOnly
    />,
  );
  const page = root.findByType(View);
  expect(StyleSheet.flatten(page.props.style)).toMatchObject({ flex: 1 });
  expect(texts(root)).toContain(
    '워치가 없어 심박·케이던스 기반 코칭은 제공되지 않아요',
  );
  const watch = texts(
    render(
      <CoachingPage
        pace={350}
        goalPace={null}
        coaching={coaching}
        currentBpm={null}
        cadence={null}
        now={now}
      />,
    ),
  );
  expect(watch).not.toContain('워치가 없어');
});

test('the last coaching stays within the session after the server stops sending it', () => {
  expect(lastCoaching(null, coaching, true)).toBe(coaching);
  expect(lastCoaching(undefined, coaching, true)).toBe(coaching);
  expect(lastCoaching(null, coaching, false)).toBeNull();
  const next = { ...coaching, coachingId: 'co-2', targetBpm: 170 };
  expect(lastCoaching(next, coaching, true)).toBe(next);
});

test('페이스 · 거리 · 심박 · 케이던스 each get a page, with their own averages and no made-up values', () => {
  const pages = metricPages({
    pace: 330,
    goalPace: 360,
    distanceM: 2000,
    totalM: 5000,
    elapsedSec: 720,
    heartRate: null,
    cadence: 170,
    targetBpm: 168,
    history: [
      { t: 1, pace: 340, distanceM: 10, heartRate: 140, cadence: 168 },
      { t: 2, pace: 335, distanceM: 13, heartRate: 150, cadence: null },
      { t: 3, pace: 330, distanceM: 16, heartRate: null, cadence: 172 },
    ],
    rival: null,
    guidance: null,
  });
  expect(pages.map(page => page.title)).toEqual([
    '페이스',
    '거리',
    '심박',
    '케이던스',
  ]);
  const shown = texts(
    render(
      <View>
        {pages.map(page => (
          <React.Fragment key={page.key}>{page.content}</React.Fragment>
        ))}
      </View>,
    ),
  );
  for (const text of [
    '현재 페이스',
    '5′30″',
    '목표 6′00″',
    '평균 페이스',
    '6′00″',
    '남은 거리',
    '3.00',
    '진행률',
    '40',
    // No heart rate now: none, not zero. The page still keeps the measured average and peak.
    '측정값 없음',
    '평균 심박',
    '145',
    '최고 심박',
    '150',
    '평균 케이던스',
    // The server's target beat, named apart from the measured cadence.
    '목표 BPM',
    '168',
    '시작',
    '지금',
  ]) {
    expect(shown).toContain(text);
  }
});

// In API mode the screen record only counts the run time: no mock numbers, positions or turn guidance.
// The measured values come from the watch batches the phone relays (runControl live).
test('in API mode the run tracking counts time only and makes up no numbers or turn guidance', async () => {
  jest.useFakeTimers();
  try {
    const start: RunSample = {
      elapsedSec: 0,
      distanceM: 0,
      paceSecPerKm: null,
      heartRate: null,
      cadence: null,
      position: null,
    };
    const route: [number, number][] = [
      [129.13, 35.15],
      [129.14, 35.155],
    ];
    const samples: RunSample[] = [];
    const seen = (repositories: ReturnType<typeof createMockRepositories>) => {
      const guidance: (RunGuidance | null)[] = [];
      samples.length = 0;
      const stop = repositories.run.startTracking(
        start,
        route,
        (sample, line) => {
          guidance.push(line);
          samples.push(sample);
        },
      );
      jest.advanceTimersByTime(3000);
      stop();
      return guidance;
    };
    // The mock (demo) keeps its lines; the API repositories drop them.
    expect(seen(createMockRepositories({ latencyMs: 0 })).some(Boolean)).toBe(
      true,
    );
    const api = seen(createApiRepositories({ latencyMs: 0 }));
    expect(api.length).toBeGreaterThan(0);
    expect(api.every(line => line === null)).toBe(true);
    expect(samples[samples.length - 1]).toEqual({
      elapsedSec: 3,
      distanceM: 0,
      paceSecPerKm: null,
      heartRate: null,
      cadence: null,
      position: null,
    });
  } finally {
    jest.useRealTimers();
  }
});

// RN clears a layout event once its handler returns; the frame must read the height before updating state.
test('the frame measures its top, foot and screen from layout events that are cleared after the handler', () => {
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      <RunLiveFrame
        title="자유 러닝"
        status={{ text: '기록 중', tone: 'live' }}
        subtitle={null}
        pages={[{ key: 'a', title: '페이스', content: null }]}
        page={0}
        onPageChange={() => undefined}
        view="numbers"
        renderMap={() => null}
        mapSummary={[]}
        elapsedSec={0}
        paused={false}
        controls={null}
      />,
    );
  });
  const handlers = root.root.findAll(
    node =>
      typeof node.props.onLayout === 'function' &&
      typeof node.type === 'string',
  );
  expect(handlers.length).toBeGreaterThanOrEqual(3);
  expect(() =>
    act(() => {
      for (const node of handlers) {
        const event: { nativeEvent: unknown } = {
          nativeEvent: { layout: { height: 100, width: 100 } },
        };
        node.props.onLayout(event);
        event.nativeEvent = null;
      }
    }),
  ).not.toThrow();
});
