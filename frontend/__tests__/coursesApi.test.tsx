import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import { now } from '../src/data/mock/fixtures';

// 3.1b 추천 코스, 3.1c 저장한 코스 and 2.1 저장한 코스 against the server (dataSource 'api'): C01·C03·C07·C08·C09.

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

const loop: [number, number][] = [
  [129.118, 35.153],
  [129.122, 35.156],
  [129.125, 35.152],
  [129.118, 35.153],
];

const courseDetail = (id: number) => ({
  id,
  myAlias: null,
  description: null,
  route: { type: 'LineString', coordinates: loop },
  startPosition: { type: 'Point', coordinates: loop[0] },
  distanceM: 5000,
  elevationGainM: 12,
  elevationProfile: null,
  environmentTags: ['PARK'],
  estimatedDurationSec: 1800,
  status: 'ACTIVE',
  mergedIntoCourseId: null,
});

// C01 makes routes for the search (courses.md 코스 생성 후속): two loops with Route's words and 100m grades.
const generated = (seed: number) => ({
  courses: [0, 1].map(index => ({
    index,
    distanceM: 5000,
    route: { type: 'LineString', coordinates: loop },
    elevationProfile: [
      { startDistanceM: 0, endDistanceM: 100, gradePercent: 2 },
      { startDistanceM: 100, endDistanceM: 200, gradePercent: -1 },
    ],
    summary: `강변을 많이 지나는 코스예요 ${seed}-${index}`,
    reasons: ['강변 구간이 40%예요'],
    caveats: [],
    score: 1.2,
    scoreTerms: [],
  })),
  notices: ['이 주변은 공원 정보가 일부만 있어요'],
  nextSeed: seed + 24,
});
let recommendations: (body: { seed?: number }) => ReturnType<typeof respond>;

// My bookmarks live here so PUT and DELETE change what C09 answers.
let bookmarked: number[];
let failUnsave: boolean;

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/regions') {
        return respond(200, {
          items: [
            {
              regionCode: '26500',
              sidoName: '부산광역시',
              sigunguName: '수영구',
            },
          ],
          currentRegionCode: null,
        });
      }
      if (path === '/users/me/running-profile') {
        return respond(200, {
          selfReportedLevel: 'INTERMEDIATE',
          baselineDistanceM: null,
          baselineDurationSec: null,
          usualPaceSecPerKm: 360,
          onboardingCompleted: true,
          updatedAt: '2026-11-02T00:00:00Z',
        });
      }
      if (path === '/users/me/bookmarked-courses') {
        return respond(200, {
          items: bookmarked.map(id => ({
            id,
            regionCode: id === 7 ? '26500' : null,
            status: 'ACTIVE',
            mergedIntoCourseId: null,
            myAlias: id === 7 ? '내 아침 코스' : null,
            distanceM: 5000,
          })),
        });
      }
      if (path === '/courses/recommendations') {
        return recommendations(
          JSON.parse((init as { body?: string }).body ?? '{}'),
        );
      }
      const bookmark = path.match(/^\/courses\/(\d+)\/bookmark$/);
      if (bookmark) {
        const id = Number(bookmark[1]);
        if (init.method === 'DELETE') {
          if (failUnsave) {
            return respond(503, {
              code: 'SERVICE_UNAVAILABLE',
              message: '',
              details: {},
            });
          }
          bookmarked = bookmarked.filter(item => item !== id);
          return respond(200, { bookmarked: false });
        }
        bookmarked = [id, ...bookmarked.filter(item => item !== id)];
        return respond(200, {
          alias: null,
          createdAt: '2026-11-02T00:00:00Z',
          bookmarked: true,
        });
      }
      const course = path.match(/^\/courses\/(\d+)$/);
      if (course) {
        return respond(200, courseDetail(Number(course[1])));
      }
      if (path.startsWith('/running-records/statistics')) {
        return respond(200, {
          runCount: 0,
          totalDistanceM: 0,
          totalDurationSec: 0,
          averagePaceSecPerKm: null,
          breakdown: [],
          heartRateZones: [],
          previousPeriod: null,
          items: [],
          changeSecPerKm: null,
        });
      }
      if (path === '/running-records') {
        return respond(200, { items: [] });
      }
      throw new Error(`unexpected request ${init.method} ${address}`);
    },
  );
}

const sent = (method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => init.method === method)
    .map(([address]) => new URL(address).pathname.replace(/^.*\/api\/v1/, ''));

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

const hasButton = (screen: Screen, label: string) =>
  screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  ).length > 0;

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

// The screen the current test opened; afterEach unmounts it even when an expectation fails.
let mounted: Screen | null = null;

async function launch() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        // Pin the clock to midday: after sunset 2.0 shows the night place card instead of the plan.
        repositories={{
          ...createApiRepositories({ latencyMs: 0 }),
          clock: { now: () => new Date(now) },
        }}
        initialSignedIn
      />,
    );
  });
  mounted = screen!;
  await settle();
  await settle();
  return screen!;
}

// 2.0M 코스 러닝 opens 3.1 오늘의 러닝.
async function openTodayRun() {
  const screen = await launch();
  await press(screen, '러닝');
  await press(screen, '코스 러닝');
  return screen;
}

beforeEach(async () => {
  bookmarked = [7, 9];
  failUnsave = false;
  recommendations = body => respond(200, generated(body.seed ?? 1));
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  serve();
});

afterEach(async () => {
  const screen = mounted;
  mounted = null;
  if (screen) {
    await act(async () => screen.unmount());
  }
});

test('2.1 lists my saved courses from the server', async () => {
  const screen = await launch();
  const page = texts(screen);
  // 2.1 저장한 코스 shows the first one's distance (S15P31E105-367).
  expect(page).toContain('저장한 코스');
  expect(page).toContain('5.0km');
});

test('3.1c shows the server list and an unsave goes to the server', async () => {
  const screen = await openTodayRun();
  await press(screen, '저장한 코스');
  // 2.1 stays mounted underneath, so look for the 3.1c buttons rather than text.
  expect(hasButton(screen, '내 아침 코스 저장 해제')).toBe(true);
  expect(hasButton(screen, '5.0km 코스 저장 해제')).toBe(true);

  await press(screen, '5.0km 코스 저장 해제');
  expect(hasButton(screen, '5.0km 코스 저장 해제')).toBe(false);
  expect(texts(screen)).toContain('저장을 해제했어요');
  expect(sent('DELETE')).toEqual(['/courses/9/bookmark']);

  await press(screen, '되돌리기');
  expect(hasButton(screen, '5.0km 코스 저장 해제')).toBe(true);
  expect(sent('PUT')).toEqual(['/courses/9/bookmark']);
});

test('3.1c puts the course back when the server keeps it', async () => {
  failUnsave = true;
  const screen = await openTodayRun();
  await press(screen, '저장한 코스');

  await press(screen, '5.0km 코스 저장 해제');

  expect(hasButton(screen, '5.0km 코스 저장 해제')).toBe(true);
  expect(texts(screen)).toContain(
    '저장을 해제하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
});

const recommendationBodies = () =>
  fetchMock.mock.calls
    .filter(
      ([address, init]) =>
        init.method === 'POST' && address.endsWith('/courses/recommendations'),
    )
    .map(([, init]) => JSON.parse(init.body));

test('3.1b shows the generated routes, asks again with nextSeed and holds save and start', async () => {
  const screen = await openTodayRun();
  const before = fetchMock.mock.calls.length;
  await press(screen, '코스 추천 받기');

  // The C01 body is the backend contract: km, loop, preference flags and the first seed.
  const [first] = recommendationBodies();
  expect(Object.keys(first).sort()).toEqual(
    ['distanceKm', 'filters', 'latitude', 'longitude', 'seed', 'shape'].sort(),
  );
  expect(first).toMatchObject({ shape: 'loop', seed: 1 });
  expect(first).not.toHaveProperty('targetDistanceM');
  let page = texts(screen);
  expect(page).toContain('1 / 2');
  expect(page).toContain('이 주변은 공원 정보가 일부만 있어요');
  expect(hasButton(screen, '5.0km 코스, 코스 정보 보기')).toBe(true);
  // A candidate index is not a course id: no C03 and no C09 lookup for the cards.
  const afterRecommend = fetchMock.mock.calls
    .slice(before)
    .map(
      ([address, init]) =>
        `${init.method} ${new URL(address).pathname.replace(
          /^.*\/api\/v1/,
          '',
        )}`,
    );
  expect(afterRecommend).toEqual(['POST /courses/recommendations']);

  // 다른 코스 keeps the conditions and sends the nextSeed of the last answer.
  await press(screen, '다른 코스 추천받기');
  const bodies = recommendationBodies();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual({ ...first, seed: 25 });
  expect(texts(screen)).toContain('강변을 많이 지나는 코스예요 25-0');

  // Saving or running a route C01 just made waits for S15P31E105-371.
  await press(screen, '내 코스에 저장');
  expect(sent('PUT')).toEqual([]);
  expect(texts(screen)).toContain(
    '새로 만든 코스의 저장과 시작은 준비 중이에요',
  );
  await press(screen, '이 코스로 달리기');
  page = texts(screen);
  expect(page).not.toContain('오늘의 러닝 전략');
});

test('a second tap before the answer does not send C01 again', async () => {
  const screen = await openTodayRun();

  await act(async () => {
    const button = labelled(screen, '코스 추천 받기');
    button.props.onPress();
    button.props.onPress();
  });
  await settle();
  await settle();
  expect(recommendationBodies().map(body => body.seed)).toEqual([1]);

  await act(async () => {
    const more = labelled(screen, '다른 코스 추천받기');
    more.props.onPress();
    more.props.onPress();
  });
  await settle();
  await settle();
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25]);
});

test('3.1b has no 다른 코스 once nextSeed is past the seed range', async () => {
  recommendations = () =>
    respond(200, { ...generated(9_999_990), nextSeed: 10_000_014 });
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  expect(texts(screen)).toContain('1 / 2');
  expect(hasButton(screen, '다른 코스 추천받기')).toBe(false);
});

test('3.1b offers 다른 코스 twice per search and again after a new search', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  // S15P31E105-383: 첫 추천 + 다른 코스 2번. Route looks back that many answers to leave out courses shown before.
  await press(screen, '다른 코스 추천받기');
  expect(hasButton(screen, '다른 코스 추천받기')).toBe(true);
  await press(screen, '다른 코스 추천받기');
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25, 49]);
  expect(texts(screen)).toContain('강변을 많이 지나는 코스예요 49-0');
  expect(texts(screen)).toContain('다른 코스는 2번까지 볼 수 있어요');
  expect(hasButton(screen, '다른 코스 추천받기')).toBe(false);

  // A new search from 3.1 (still mounted under 3.1b) starts the count again with the first seed.
  await press(screen, '코스 추천 받기');
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25, 49, 1]);
  expect(hasButton(screen, '다른 코스 추천받기')).toBe(true);
  await press(screen, '다른 코스 추천받기');
  expect(recommendationBodies().at(-1)).toMatchObject({ seed: 25 });
});

test('3.1 offers distances only up to the 15km C01 makes', async () => {
  const screen = await openTodayRun();

  const slider = screen.root.find(
    node =>
      node.props.accessibilityLabel === '목표 거리' &&
      node.props.max !== undefined,
  );
  expect(slider.props.max).toBe(15);
});

test('3.1 says why C01 failed from details.reason and keeps the conditions', async () => {
  recommendations = () =>
    respond(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: '코스 추천 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
      details: { reason: 'ROUTE_BUSY' },
    });
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  expect(texts(screen)).toContain('지금 코스 추천 요청이 많아요.');
  expect(hasButton(screen, '코스 추천 받기')).toBe(true);
});
