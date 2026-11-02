import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 2.1 기록 sections, 5.1·5.2·5.3 against the server (dataSource 'api'): H01·H02·H03·H06·H07.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// Sunday 11.01 in Korea: a solo run at 07:10 and a group run at 19:00.
const solo = {
  id: 101,
  courseId: null,
  startedAt: '2026-10-31T22:10:00Z',
  totalDistance: 5020.5,
  movingDuration: 1800,
  averagePace: 358.52,
  goalAchieved: true,
};
const group = {
  id: 102,
  courseId: null,
  startedAt: '2026-11-01T10:00:00Z',
  totalDistance: 6000,
  movingDuration: 2160,
  averagePace: 360,
  goalAchieved: null,
};

const statistics = {
  runCount: 2,
  totalDistanceM: 11020.5,
  totalDurationSec: 3960,
  averagePaceSecPerKm: 359.26,
  breakdown: [
    { week: 1, distanceM: 11020.5 },
    { week: 2, distanceM: 0 },
    { week: 3, distanceM: 0 },
    { week: 4, distanceM: 0 },
    { week: 5, distanceM: 0 },
  ],
  heartRateZones: [
    { zone: 1, ratio: 0.1 },
    { zone: 2, ratio: 0.5 },
    { zone: 3, ratio: 0.3 },
    { zone: 4, ratio: 0.08 },
    { zone: 5, ratio: 0.02 },
  ],
  previousPeriod: {
    runCount: 1,
    totalDistanceM: 4000,
    averagePaceSecPerKm: 371.4,
    runCountDelta: 1,
    totalDistanceMDelta: 7020.5,
    averagePaceSecPerKmDelta: -12.14,
  },
};

const empty = {
  runCount: 0,
  totalDistanceM: 0,
  totalDurationSec: 0,
  averagePaceSecPerKm: null,
  breakdown: [0, 1, 2, 3, 4].map(week => ({ week: week + 1, distanceM: 0 })),
  heartRateZones: [],
  previousPeriod: null,
};

const months = [
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
];

// Answers every records request from my runs; `runs` false is an account without any.
function serve(runs = true) {
  fetchMock.mockImplementation(async (requested: string) => {
    const url = new URL(requested);
    // 2.1 저장한 코스 (C09) has nothing saved in these tests.
    if (url.pathname.endsWith('/users/me/bookmarked-courses')) {
      return respond(200, { items: [] });
    }
    const path = url.pathname.split('/running-records')[1];
    if (path === '/statistics/pace-trend') {
      return respond(200, {
        items: months.map((month, index) => ({
          month,
          averagePaceSecPerKm:
            runs && index >= 4 ? 371.4 - (index - 4) * 12 : null,
          runCount: runs && index >= 4 ? index - 3 : 0,
        })),
        changeSecPerKm: null,
      });
    }
    if (path === '/statistics') {
      return respond(200, runs ? statistics : empty);
    }
    if (path === '/101/splits') {
      return respond(200, {
        splits: [0, 1, 2, 3, 4, 5].map(index => ({
          startDistanceM: index * 1000,
          endDistanceM: index === 5 ? 5020.5 : (index + 1) * 1000,
          paceSecPerKm: 352 + index * 2,
          averageHeartRate: 148 + index,
          averageCadence: 170,
        })),
      });
    }
    if (path === '/101') {
      return respond(200, {
        sessionId: 101,
        targetDistanceM: 5000,
        targetDurationSec: 1800,
        actualDistanceM: 5020.5,
        movingDurationSec: 1795,
        elapsedDurationSec: 1900,
        averagePaceSecPerKm: 357.53,
        averageHeartRate: 150,
        averageCadence: 170,
        goalAchieved: true,
        courseId: null,
        targetPaceSecPerKm: 360,
        comparisonSessionId: null,
      });
    }
    if (path === '') {
      if (!runs) {
        return respond(200, { items: [] });
      }
      const runType = url.searchParams.get('runType');
      return respond(200, {
        items:
          runType === 'GROUP'
            ? [group]
            : runType === 'SOLO'
            ? [solo]
            : [group, solo],
      });
    }
    throw new Error(`unexpected request ${requested}`);
  });
}

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

async function launch() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await settle();
  return screen!;
}

beforeEach(async () => {
  // Monday 11.02 12:00 in Korea; timers still run so the screens settle.
  jest.useFakeTimers({
    now: new Date('2026-11-02T03:00:00Z'),
    advanceTimers: true,
  });
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

afterEach(() => {
  jest.useRealTimers();
});

test('2.1 shows this month and my recent runs from the server', async () => {
  serve();
  const screen = await launch();
  const page = texts(screen);
  for (const text of [
    '러닝 분석 11월 2 회 러닝 11.0 km 누적 거리 5′59″',
    // October averaged 6′11″, so this month is 12 seconds faster.
    '12초 빨라졌어요',
    '아침 러닝 5.02  km 30:00 · 5′59″/km',
  ]) {
    expect(page).toContain(text);
  }
  await act(async () => screen.unmount());
});

test('5.1 lists the month from the server and 5.2 opens a run with its splits', async () => {
  serve();
  const screen = await launch();
  await press(screen, '전체 기록 보기');
  let page = texts(screen);
  for (const text of [
    '2026년 11월',
    '2회 러닝',
    '11.0',
    '5′59″',
    '11.01 일 · 30:00',
    '저녁 러닝 그룹런 11.01 일 · 36:00',
  ]) {
    expect(page).toContain(text);
  }

  await press(screen, '아침 러닝, 11.01 일 · 30:00, 5.02km');
  page = texts(screen);
  for (const text of [
    '11.01 일 러닝',
    '5.02',
    '29:55',
    '5′58″/km',
    '목표 30:00 달성 · 5초 단축',
    '페이스',
    '심박',
  ]) {
    expect(page).toContain(text);
  }
  // No route or AI advice comes from the server yet.
  expect(page).not.toContain('AI 조언');
  await act(async () => screen.unmount());
});

test('5.3 shows the server statistics, pace trend and last month', async () => {
  serve();
  const screen = await launch();
  await press(screen, '분석 자세히 보기');
  const page = texts(screen);
  for (const text of [
    '2026년 11월',
    '11.0',
    '5′59″',
    '평균 페이스 추이',
    '지난달과 비교',
    '10월',
    '1회',
    '+1회',
    '4.0km',
    '+7.0km',
    '6′11″',
    '12초 단축',
  ]) {
    expect(page).toContain(text);
  }
  await act(async () => screen.unmount());
});

test('without any runs 5.1 and 5.3 show their empty states', async () => {
  serve(false);
  const screen = await launch();
  await press(screen, '전체 기록 보기');
  expect(texts(screen)).toContain('이 달에는 기록이 없어요');
  await act(async () => screen.unmount());

  const analysis = await launch();
  await press(analysis, '분석 자세히 보기');
  expect(texts(analysis)).toContain('이 기간에는 기록이 없어요');
  await act(async () => analysis.unmount());
});
