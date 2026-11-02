import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

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
        return respond(200, {
          courses: [
            {
              id: 21,
              regionCode: '26500',
              status: 'ACTIVE',
              distanceM: 5000,
              environmentTags: ['PARK'],
              estimatedDurationSec: 1800,
            },
          ],
        });
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
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  serve();
});

test('2.1 lists my saved courses from the server', async () => {
  const screen = await launch();
  const page = texts(screen);
  expect(page).toContain('저장한 코스');
  expect(page).toContain('내 아침 코스');
  expect(page).toContain('5.0km 코스');
  await act(async () => screen.unmount());
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
  await act(async () => screen.unmount());
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
  await act(async () => screen.unmount());
});

test('3.1b shows the server recommendation and saves it with C07', async () => {
  const screen = await openTodayRun();
  await press(screen, '코스 추천 받기');
  let page = texts(screen);
  expect(page).toContain('1 / 1');
  expect(hasButton(screen, '부산광역시 수영구 코스, 코스 정보 보기')).toBe(
    true,
  );

  await press(screen, '내 코스에 저장');
  expect(sent('PUT')).toEqual(['/courses/21/bookmark']);
  expect(() => labelled(screen, '저장 해제')).not.toThrow();

  // 코스 선택 plans 2.0 on the server course.
  await press(screen, '코스 선택');
  page = texts(screen);
  expect(page).toContain('부산광역시 수영구 코스');
  expect(page).toContain('오늘의 러닝 전략');
  await act(async () => screen.unmount());
});
