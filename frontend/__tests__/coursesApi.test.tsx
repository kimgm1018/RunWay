import {
  defaultCoursePreferences,
  copyCoursePreferences,
  courseFilterOptions,
} from '../src/data/coursePreferences';
import type { RecommendationPreferences } from '../src/data';
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
    candidateToken: `v1.1762311600.token-${seed}-${index}`,
  })),
  notices: ['이 주변은 공원 정보가 일부만 있어요'],
  nextSeed: seed + 24,
});
let recommendations: (body: { seed?: number }) => ReturnType<typeof respond>;
// C10's answer when a generated route is saved or picked (S15P31E105-526).
let storeGenerated: () => ReturnType<typeof respond>;

// My bookmarks live here so PUT and DELETE change what C09 answers.
let bookmarked: number[];
let failUnsave: boolean;
let preferences: RecommendationPreferences;
let failPreferenceRead: boolean;
let failPreferenceSave: boolean;

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/places/search') {
        return respond(200, {
          items: [
            {
              name: '민락수변공원 주차장 입구',
              address: '부산 수영구 민락수변로 7',
              position: [129.1318, 35.1543],
              distanceM: null,
            },
          ],
        });
      }
      if (path === '/users/me/preferences') {
        if (init.method === 'PUT') {
          if (failPreferenceSave)
            return respond(503, { code: 'SERVICE_UNAVAILABLE', message: '' });
          preferences = copyCoursePreferences(JSON.parse(init.body!));
        } else if (failPreferenceRead)
          return respond(503, { code: 'SERVICE_UNAVAILABLE', message: '' });
        return respond(200, copyCoursePreferences(preferences));
      }
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
      if (path === '/courses/generated' && init.method === 'POST') {
        return storeGenerated();
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

// Swipes the 3.1b row to its last card, which asks for the next page (S15P31E105-474).
function swipeToLast(screen: Screen) {
  const rows = screen.root.findAll(
    node =>
      node.props.horizontal === true &&
      typeof node.props.onMomentumScrollEnd === 'function',
  );
  rows[rows.length - 1].props.onMomentumScrollEnd({
    nativeEvent: { contentOffset: { x: 100000 } },
  });
}

async function swipe(screen: Screen) {
  await act(async () => swipeToLast(screen));
  await settle();
  await settle();
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
          // 3.1 starts from 현재 위치 (S15P31E105-494); a synthetic fix stands in for the phone.
          phoneLocation: {
            start: async () => false,
            stop: async () => undefined,
            subscribe: () => () => undefined,
            requestPermission: async () => true,
            current: async () => ({
              latitude: 35.1551,
              longitude: 129.1301,
              accuracyM: 5,
              altitudeM: null,
              time: Date.UTC(2026, 10, 6, 1, 0, 0),
            }),
          },
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

// 2.0M 코스 러닝 opens the map (2.0C), whose 코스 설정 opens 3.1 오늘의 러닝 (담당자 요청).
async function openTodayRun() {
  const screen = await launch();
  await press(screen, '러닝');
  await press(screen, '코스 러닝');
  await press(screen, '코스 설정');
  return screen;
}

beforeEach(async () => {
  bookmarked = [7, 9];
  failUnsave = false;
  preferences = defaultCoursePreferences();
  failPreferenceRead = false;
  failPreferenceSave = false;
  recommendations = body => respond(200, generated(body.seed ?? 1));
  storeGenerated = () => respond(200, { courseId: 11, reused: false });
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

test('2.0C opens my saved courses from the server beside 코스 설정 (S15P31E105-564)', async () => {
  const screen = await launch();
  // 2.1 has no 저장한 코스 any more.
  expect(texts(screen)).not.toContain('저장한 코스');
  await press(screen, '러닝');
  await press(screen, '코스 러닝');
  await press(screen, '저장한 코스');
  await settle();
  expect(texts(screen)).toContain('5.0km');
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

test('3.1c draws each saved course on its own map from the C03 points (S15P31E105-562)', async () => {
  const screen = await openTodayRun();
  await press(screen, '저장한 코스');
  const maps = screen.root.findAll(
    node =>
      typeof node.type !== 'string' &&
      Array.isArray(node.props.route) &&
      node.props.compact === true,
  );
  expect(maps.length).toBeGreaterThan(0);
  expect(maps[0].props.route).toEqual(loop);
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

test('3.1b shows the generated routes, asks again with nextSeed, and saves and runs one through C10', async () => {
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
  expect(page).toContain('강변을 많이 지나는 코스예요 1-0');
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

  // Swiping to the last card asks for the next page with the same conditions and the nextSeed of the last
  // answer; the new courses join the end of the row, after the ones already shown.
  await swipe(screen);
  const bodies = recommendationBodies();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual({ ...first, seed: 25 });
  page = texts(screen);
  expect(page).toContain('강변을 많이 지나는 코스예요 1-0');
  expect(page).toContain('강변을 많이 지나는 코스예요 25-0');

  // Saving a route C01 just made stores it with C10 first and bookmarks the stored course; running it
  // again uses the same course without a second C10.
  await press(screen, '내 코스에 저장');
  expect(
    sent('POST').filter(path => path === '/courses/generated'),
  ).toHaveLength(1);
  expect(sent('PUT')).toContain('/courses/11/bookmark');
  await press(screen, '이 코스로 달리기');
  await settle(50);
  expect(
    sent('POST').filter(path => path === '/courses/generated'),
  ).toHaveLength(1);
  page = texts(screen);
  expect(page).toContain('오늘의 러닝 전략');
  expect(page).toContain('5.0km 코스');
  expect(sent('GET')).toContain('/courses/11');
});

test('3.1b says to ask again when C10 finds the route too old, and stays on the cards', async () => {
  storeGenerated = () =>
    respond(422, {
      code: 'COURSE_CANDIDATE_INVALID',
      message: '',
      details: {},
    });
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  await press(screen, '이 코스로 달리기');
  const page = texts(screen);
  expect(page).toContain('추천받은 지 오래된 코스예요. 다시 추천받아 주세요');
  expect(page).not.toContain('오늘의 러닝 전략');
  expect(page).toContain('강변을 많이 지나는 코스예요 1-0');
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

  // Two swipes to the end before the next page answers send it once.
  await act(async () => {
    swipeToLast(screen);
    swipeToLast(screen);
  });
  await settle();
  await settle();
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25]);
});

test('3.1b asks for no next page once nextSeed is past the seed range', async () => {
  recommendations = () =>
    respond(200, { ...generated(9_999_990), nextSeed: 10_000_014 });
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  await swipe(screen);
  expect(recommendationBodies().map(body => body.seed)).toEqual([1]);
});

test('3.1b adds the next page twice per search and again after a new search', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');

  // S15P31E105-383: 첫 추천 + 2 more pages. Route looks back that many answers to leave out courses shown before.
  await swipe(screen);
  await swipe(screen);
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25, 49]);
  const page = texts(screen);
  for (const seed of [1, 25, 49]) {
    expect(page).toContain(`강변을 많이 지나는 코스예요 ${seed}-0`);
  }
  // The end of the third page asks for nothing more.
  await swipe(screen);
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25, 49]);

  // A new search from 3.1 (still mounted under 3.1b) starts again with the first seed and one page.
  await press(screen, '코스 추천 받기');
  expect(recommendationBodies().map(body => body.seed)).toEqual([1, 25, 49, 1]);
  await swipe(screen);
  expect(recommendationBodies().at(-1)).toMatchObject({ seed: 25 });
});

test('3.1 offers distances only up to the 15km C01 makes', async () => {
  const screen = await openTodayRun();
  // Each condition is a card that opens its ruler or chips (운동 목표 sheet, 담당자 요청).
  await press(screen, '목표 거리 설정');

  const slider = screen.root.find(
    node => node.props.label === '목표 거리' && node.props.max !== undefined,
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

test('U11의 형태·환경 기본값을 표시하고 변경·추천만으로는 저장하지 않는다', async () => {
  preferences.shape = 'out_and_back';
  preferences.filters.river = true;
  preferences.filters.avoid_steps = true;
  const screen = await openTodayRun();
  await press(screen, '코스 형태 설정');
  expect(labelled(screen, '왕복').props.accessibilityState.selected).toBe(true);
  await press(screen, '조건 목록으로');
  await press(screen, '환경 설정');
  expect(labelled(screen, '강변').props.accessibilityState.checked).toBe(true);
  expect(labelled(screen, '계단 피하기').props.accessibilityState.checked).toBe(
    true,
  );
  await press(screen, '평지 위주');
  await press(screen, '코스 추천 받기');
  expect(recommendationBodies()[0]).toMatchObject({
    shape: 'out_and_back',
    filters: {
      river: true,
      beach: false,
      park: false,
      trail: false,
      pedestrian: false,
      flat: true,
      avoidMajorRoad: false,
      avoidSteps: true,
      avoidTunnel: false,
    },
  });
  expect(sent('PUT')).toEqual([]);
  expect(preferences.filters.flat).toBe(false);
});

test('지도 출발·도착 좌표를 확정한 뒤 C01에 전달하고 취소는 기존 위치를 유지한다', async () => {
  const screen = await openTodayRun();
  const tap = async (latitude: number, longitude: number) => {
    await act(async () =>
      screen.root
        .findAll(node => typeof node.props.onTapMap === 'function')
        .pop()!
        .props.onTapMap({ latitude, longitude }),
    );
  };
  await press(screen, '기준 위치 현재 위치');
  await tap(35.152, 129.119);
  await press(screen, '취소');
  expect(hasButton(screen, '기준 위치 현재 위치')).toBe(true);
  await press(screen, '기준 위치 현재 위치');
  await tap(35.152, 129.119);
  await press(screen, '이 위치로 확정');
  await press(screen, '코스 형태 설정');
  await press(screen, '편도');
  await press(screen, '조건 목록으로');
  await press(screen, '도착 위치 선택');
  await act(async () =>
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '장소·주소 검색' &&
          typeof node.props.onChangeText === 'function',
      )
      .pop()!
      .props.onChangeText('민락수변공원'),
  );
  await settle(400);
  await press(screen, '민락수변공원 주차장 입구, 부산 수영구 민락수변로 7');
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(true);
  await tap(35.16, 129.14);
  await press(screen, '이 위치로 확정');
  await press(screen, '이 조건을 기본값으로 저장');
  const saved = fetchMock.mock.calls.find(
    ([address, init]) =>
      address.endsWith('/users/me/preferences') && init.method === 'PUT',
  );
  expect(Object.keys(JSON.parse(saved![1].body)).sort()).toEqual([
    'filters',
    'shape',
  ]);
  await press(screen, '코스 추천 받기');
  expect(recommendationBodies()[0]).toMatchObject({
    latitude: 35.152,
    longitude: 129.119,
    shape: 'point_to_point',
    endLatitude: 35.16,
    endLongitude: 129.14,
  });
});

test('편도 도착지 없이도 기본값은 저장할 수 있지만 추천은 도착지를 골라야 한다', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 형태 설정');
  await press(screen, '편도');
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(true);
  await press(screen, '조건 목록으로');
  await press(screen, '환경 설정');
  await press(screen, '큰길 피하기');
  await press(screen, '이 조건을 기본값으로 저장');
  const put = fetchMock.mock.calls.find(
    ([address, init]) =>
      address.endsWith('/users/me/preferences') && init.method === 'PUT',
  );
  const body = JSON.parse(put![1].body);
  expect(body).toEqual({
    shape: 'point_to_point',
    filters: { ...defaultCoursePreferences().filters, avoid_major_road: true },
  });
  expect(texts(screen)).toContain('추천 기본값을 저장했어요');
  expect(recommendationBodies()).toEqual([]);
  await press(screen, '조건 목록으로');
  await press(screen, '도착 위치 선택');
  // 장소 검색(searchPlaces) answers after typing stops (S15P31E105-494).
  await act(async () => {
    const fields = screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '장소·주소 검색' &&
        typeof node.props.onChangeText === 'function',
    );
    fields[fields.length - 1].props.onChangeText('민락수변공원');
  });
  await settle(400);
  await press(screen, '민락수변공원 주차장 입구, 부산 수영구 민락수변로 7');
  await press(screen, '이 위치로 확정');
  await press(screen, '코스 추천 받기');
  expect(recommendationBodies()[0]).toMatchObject({
    shape: 'point_to_point',
    endLatitude: 35.1543,
    endLongitude: 129.1318,
    filters: { avoidMajorRoad: true },
  });
});

test('기본값 저장 실패는 선택값을 유지하고 재시도할 수 있다', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 형태 설정');
  await press(screen, '왕복');
  await press(screen, '조건 목록으로');
  await press(screen, '환경 설정');
  await press(screen, '트레일');
  failPreferenceSave = true;
  await press(screen, '이 조건을 기본값으로 저장');
  expect(texts(screen)).toContain('기본값을 저장하지 못했어요');
  expect(labelled(screen, '트레일').props.accessibilityState.checked).toBe(
    true,
  );
  await press(screen, '조건 목록으로');
  expect(texts(screen)).toContain('왕복');
  expect(preferences).toEqual(defaultCoursePreferences());
  failPreferenceSave = false;
  await press(screen, '이 조건을 기본값으로 저장');
  expect(preferences.shape).toBe('out_and_back');
  expect(preferences.filters.trail).toBe(true);
});

test('U11 실패를 기본값 없음으로 숨기지 않고 재조회한다', async () => {
  failPreferenceRead = true;
  preferences.shape = 'out_and_back';
  const screen = await openTodayRun();
  expect(texts(screen)).toContain('추천 기본값을 불러오지 못했어요');
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(true);
  expect(sent('PUT')).toEqual([]);
  failPreferenceRead = false;
  await press(screen, '기본값 다시 불러오기');
  await press(screen, '코스 형태 설정');
  expect(labelled(screen, '왕복').props.accessibilityState.selected).toBe(true);
  expect(labelled(screen, '코스 추천 받기').props.disabled).toBe(false);
});

test('9개 조건을 모두 해제하면 false를 빠짐없이 저장한다', async () => {
  for (const { key } of courseFilterOptions) preferences.filters[key] = true;
  const screen = await openTodayRun();
  await press(screen, '환경 설정');
  for (const { label } of courseFilterOptions) await press(screen, label);
  await press(screen, '이 조건을 기본값으로 저장');
  expect(preferences).toEqual(defaultCoursePreferences());
});

test('저장 중 연속 클릭해도 U12는 한 번만 보낸다', async () => {
  const screen = await openTodayRun();
  const original = fetchMock.getMockImplementation()!;
  let release!: () => void;
  fetchMock.mockImplementation(async (address, init) => {
    if (address.endsWith('/users/me/preferences') && init.method === 'PUT')
      await new Promise<void>(resolve => {
        release = resolve;
      });
    return original(address, init);
  });
  try {
    const button = labelled(screen, '이 조건을 기본값으로 저장');
    await act(async () => {
      button.props.onPress();
      button.props.onPress();
    });
    expect(sent('PUT')).toEqual(['/users/me/preferences']);
    expect(labelled(screen, '이 조건을 기본값으로 저장').props.disabled).toBe(
      true,
    );
    await act(async () => {
      release();
    });
    await settle();
  } finally {
    release?.();
  }
});
