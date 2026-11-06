import { defaultCoursePreferences } from '../../coursePreferences';
import { appConfig } from '../../../config';
import { createMockRepositories } from '../../mock/createMockRepositories';
import type { CourseSearch } from '../../types';
import { createCoursesApi } from '../courses';
import { createRegions } from '../regions';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// A loop near 광안리 (start = end) and a one-way riverside course.
const loop: [number, number][] = [
  [129.118, 35.153],
  [129.122, 35.156],
  [129.125, 35.152],
  [129.118, 35.153],
];
const oneWay: [number, number][] = [
  [129.1, 35.17],
  [129.11, 35.18],
];

function detail(id: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    myAlias: null,
    description: null,
    route: { type: 'LineString', coordinates: id === 7 ? loop : oneWay },
    startPosition: {
      type: 'Point',
      coordinates: (id === 7 ? loop : oneWay)[0],
    },
    distanceM: id === 7 ? 5000 : 6200.5,
    elevationGainM: 12.4,
    elevationProfile: [3, 5, 9, 5, 3],
    environmentTags: ['PARK'],
    status: 'ACTIVE',
    mergedIntoCourseId: null,
    ...fields,
  };
}

const regions = {
  items: [
    { regionCode: '26500', sidoName: '부산광역시', sigunguName: '수영구' },
  ],
  currentRegionCode: null,
};

type Route = (
  url: URL,
  init: { method: string; body?: string },
) => ReturnType<typeof respond> | undefined;

function serve(route: Route) {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const answer = route(new URL(address), init);
      if (!answer) {
        throw new Error(`unexpected request ${init.method} ${address}`);
      }
      return answer;
    },
  );
}

// C09 with my two saved courses, CMT12 regions and C03 for each course.
const common: Route = (url, init) => {
  const path = url.pathname.replace(/^.*\/api\/v1/, '');
  if (path === '/regions') {
    return respond(200, regions);
  }
  if (path === '/users/me/bookmarked-courses') {
    return respond(200, {
      items: [
        {
          id: 7,
          regionCode: '26500',
          status: 'ACTIVE',
          mergedIntoCourseId: null,
          myAlias: '내 아침 코스',
          distanceM: 5000,
        },
        {
          id: 9,
          regionCode: null,
          status: 'ACTIVE',
          mergedIntoCourseId: null,
          myAlias: null,
          distanceM: 6200.5,
        },
      ],
    });
  }
  const match = path.match(/^\/courses\/(\d+)$/);
  if (match && init.method === 'GET') {
    const pace = Number(url.searchParams.get('targetPaceSecPerKm'));
    const id = Number(match[1]);
    return respond(200, {
      ...detail(id),
      ...(pace
        ? {
            estimatedDurationSec: Math.round(
              ((id === 7 ? 5000 : 6200.5) / 1000) * pace,
            ),
          }
        : {}),
    });
  }
  return undefined;
};

const calls = () =>
  fetchMock.mock.calls.map(([address, init]) => ({
    method: init.method as string,
    url: new URL(address),
    body: init.body ? JSON.parse(init.body) : undefined,
  }));

function api(usualPace: number | null = 400) {
  const mock = createMockRepositories({ latencyMs: 0 }).courses;
  return {
    mock,
    courses: createCoursesApi({
      mock,
      usualPace: async () => usualPace,
      regions: createRegions(),
    }),
  };
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('C09 saved courses get a region name, my alias, a shape and the time at my pace', async () => {
  serve(common);
  const { courses } = api(400);

  const saved = await courses.getSaved();

  const details = calls().filter(call =>
    /\/courses\/\d+$/.test(call.url.pathname),
  );
  expect(
    details.map(call => call.url.searchParams.get('targetPaceSecPerKm')),
  ).toEqual(['400', '400']);
  expect(saved).toHaveLength(2);
  expect(saved[0]).toMatchObject({
    id: '7',
    name: '부산 수영구 코스',
    myAlias: '내 아침 코스',
    distanceM: 5000,
    // 5km at 6′40″ = 33:20.
    expectedMinutes: 33,
  });
  expect(saved[0].shape).toHaveLength(4);
  for (const [x, y] of saved[0].shape) {
    expect(x).toBeGreaterThanOrEqual(0.1);
    expect(x).toBeLessThanOrEqual(0.9);
    expect(y).toBeGreaterThanOrEqual(0.1);
    expect(y).toBeLessThanOrEqual(0.9);
  }
  // No region: the course is named by its distance.
  expect(saved[1]).toMatchObject({
    id: '9',
    name: '6.2km 코스',
    myAlias: null,
  });
});

test('without a running profile the expected time uses 6′00″', async () => {
  serve(common);
  const { courses } = api(null);

  const saved = await courses.getSaved();

  expect(saved[0].expectedMinutes).toBe(30);
});

const search: CourseSearch = {
  origin: { name: '광안리해수욕장', position: [129.118, 35.153] },
  targetDistanceM: 5000,
  goalInputType: 'TIME',
  targetDurationSec: 1800,
  targetPaceSecPerKm: 360,
  environmentTypes: ['PARK', 'BEACH'],
};

// C01 answer (courses.md 코스 생성 후속): generated routes with Route's words and 100m grades.
const generatedAnswer = {
  courses: [
    {
      index: 0,
      distanceM: 5020,
      route: { type: 'LineString', coordinates: loop },
      elevationProfile: [
        { startDistanceM: 0, endDistanceM: 100, gradePercent: 10 },
        { startDistanceM: 100, endDistanceM: 200, gradePercent: 5 },
        { startDistanceM: 200, endDistanceM: 300, gradePercent: -15 },
      ],
      summary: '강변을 많이 지나는 코스예요.',
      reasons: ['강변 구간이 40%예요'],
      caveats: ['계단이 1곳 있어요'],
      score: 1.42,
      scoreTerms: [],
    },
    {
      index: 1,
      distanceM: 4800,
      route: { type: 'LineString', coordinates: oneWay },
      elevationProfile: [],
      summary: '<b>평지</b> 위주예요',
      reasons: [],
      caveats: [],
      score: 0.8,
      scoreTerms: [],
    },
  ],
  notices: ['이 주변은 공원 정보가 일부만 있어요'],
  nextSeed: 25,
};

test('C01 sends km, loop, preference flags and seed and shows the routes as they came', async () => {
  serve((url, init) =>
    url.pathname.endsWith('/courses/recommendations')
      ? respond(200, generatedAnswer)
      : common(url, init),
  );
  const { courses } = api();

  const found = await courses.recommend({
    ...search,
    environmentTypes: ['PARK', 'RIVERSIDE', 'URBAN', 'TRACK'],
  });

  const post = calls().find(call => call.method === 'POST')!;
  expect(post.url.toString()).toBe(
    `${appConfig.apiBaseUrl}/courses/recommendations`,
  );
  // 도심·트랙 have no Route preference and are left out; no pace, goal, limit or old fields.
  expect(post.body).toEqual({
    latitude: 35.153,
    longitude: 129.118,
    distanceKm: 5,
    shape: 'loop',
    filters: { park: true, river: true },
    seed: 1,
  });
  // Cards come from the answer itself: no C03 per card and no C09 lookup.
  expect(calls().filter(call => call.method === 'GET')).toEqual([]);
  expect(found.nextSeed).toBe(25);
  expect(found.notices).toEqual(['이 주변은 공원 정보가 일부만 있어요']);
  expect(found.courses[0]).toMatchObject({
    name: '5.0km 코스',
    distanceM: 5020,
    // 30:00 for 5km is 6′00″/km.
    estimatedDurationSec: 1807,
    shapeKind: '순환',
    environmentLabels: [],
    // Heights 0 → 10 → 15 → 0: 15m of climb.
    elevationGainM: 15,
    elevationProfile: [0, 0, 67, 67, 67, 100, 100, 100, 0, 0],
    reason:
      '강변을 많이 지나는 코스예요.\n· 강변 구간이 40%예요\n주의: 계단이 1곳 있어요',
    route: loop,
    saved: false,
    generated: true,
  });
  // An index is not a course id: the card id is not numeric, so C03/C07 never use it.
  expect(found.courses[0].id).not.toMatch(/^\d+$/);
  expect(found.courses[0].id).not.toBe(found.courses[1].id);
  expect(found.courses[1]).toMatchObject({
    shapeKind: '편도',
    elevationGainM: null,
    elevationProfile: [],
    // Plain text, not markup.
    reason: '<b>평지</b> 위주예요',
  });
});

test('C01 sends the seed asked for and stops 다른 코스 past the seed range', async () => {
  serve((url, init) =>
    url.pathname.endsWith('/courses/recommendations')
      ? respond(200, { courses: [], notices: [], nextSeed: 10_000_001 })
      : common(url, init),
  );
  const { courses } = api();

  const found = await courses.recommend({ ...search, seed: 9_999_977 });

  expect(found).toEqual({ courses: [], notices: [], nextSeed: null });
  const post = calls().find(call => call.method === 'POST')!;
  expect(post.body.seed).toBe(9_999_977);
});

test('C01 waits past the usual 15s for routes the backend takes up to 20s to make', async () => {
  jest.useFakeTimers();
  try {
    // The answer comes after 20s unless the request is aborted first.
    fetchMock.mockImplementation(
      (_address: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(respond(200, generatedAnswer)),
            20_000,
          );
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );
    const { courses } = api();

    const pending = courses.recommend({ ...search, targetDurationSec: 1800 });
    await jest.advanceTimersByTimeAsync(20_000);

    await expect(pending).resolves.toMatchObject({ nextSeed: 25 });
  } finally {
    jest.useRealTimers();
  }
});

test('C01 gives up after 30s', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(
      (_address: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const { courses } = api();

    const outcome = courses.recommend(search).catch(error => error);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(await outcome).toMatchObject({ code: 'NETWORK_ERROR' });
  } finally {
    jest.useRealTimers();
  }
});

test('C01 failures keep details.reason for the screen', async () => {
  serve(url =>
    url.pathname.endsWith('/courses/recommendations')
      ? respond(422, {
          code: 'INVALID_SEARCH',
          message: '출발 위치가 서비스 지역(부산) 밖입니다.',
          details: { reason: 'OUT_OF_AREA' },
        })
      : undefined,
  );
  const { courses } = api();

  await expect(courses.recommend(search)).rejects.toMatchObject({
    status: 422,
    details: { reason: 'OUT_OF_AREA' },
  });
});

test('C07 and C08 save and unsave server courses', async () => {
  serve(url =>
    url.pathname.endsWith('/bookmark')
      ? respond(200, { bookmarked: true })
      : undefined,
  );
  const { courses } = api();

  await courses.save('7');
  await courses.unsave('7');

  expect(
    calls().map(
      call => `${call.method} ${call.url.pathname.replace(/^.*\/api\/v1/, '')}`,
    ),
  ).toEqual(['PUT /courses/7/bookmark', 'DELETE /courses/7/bookmark']);
  // No body, so an alias set earlier stays.
  expect(calls()[0].body).toBeUndefined();
});

test('a course only the mock knows is saved on the mock', async () => {
  const { courses, mock } = api();
  const save = jest.spyOn(mock, 'save');

  await courses.save('course-run-1');

  expect(save).toHaveBeenCalledWith('course-run-1');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('C08 failures reach the screen', async () => {
  serve(() =>
    respond(404, { code: 'COURSE_NOT_FOUND', message: '', details: {} }),
  );
  const { courses } = api();
  await expect(courses.unsave('7')).rejects.toMatchObject({ code: 'UNKNOWN' });
});

test('2.0 plans a chosen server course with its name, route and distance', async () => {
  serve(common);
  const { courses } = api(400);

  // Picked on 3.1c, so the list named it already; C03 has no region.
  await courses.getSaved();
  await courses.choose('7');
  const plan = await courses.getTodayPlan();

  expect(plan).toMatchObject({
    courseId: '7',
    name: '부산 수영구 코스',
    distanceM: 5000,
    route: loop,
    expectedDurationSec: 2000,
  });
  expect(plan.segmentPacesSecPerKm).toHaveLength(5);
});

test('2.0 names a course it never listed by its distance', async () => {
  serve(common);
  const { courses } = api(400);

  await courses.choose('9');

  expect((await courses.getTodayPlan()).name).toBe('6.2km 코스');
});

test.each(['loop', 'out_and_back', 'point_to_point'] as const)(
  'C01은 선택한 %s 형태와 9개 조건을 전달한다',
  async shape => {
    serve((url, init) =>
      url.pathname.endsWith('/courses/recommendations')
        ? respond(200, generatedAnswer)
        : common(url, init),
    );
    const filters = defaultCoursePreferences().filters;
    filters.trail = true;
    filters.avoid_tunnel = true;
    const found = await api().courses.recommend({
      ...search,
      shape,
      filters,
      destination: { name: '도착', position: [129.12, 35.16] },
    });
    const body = calls().find(call => call.method === 'POST')!.body;
    expect(body).toMatchObject({
      shape,
      filters: {
        river: false,
        beach: false,
        park: false,
        trail: true,
        pedestrian: false,
        flat: false,
        avoidMajorRoad: false,
        avoidSteps: false,
        avoidTunnel: true,
      },
    });
    expect(body.filters).not.toHaveProperty('avoid_tunnel');
    expect(found.courses[0].shapeKind).toBe(
      shape === 'loop' ? '순환' : shape === 'out_and_back' ? '왕복' : '편도',
    );
    expect(Object.keys(body.filters)).toHaveLength(9);
    if (shape === 'point_to_point')
      expect(body).toMatchObject({ endLongitude: 129.12, endLatitude: 35.16 });
    else {
      expect(body).not.toHaveProperty('endLatitude');
      expect(body).not.toHaveProperty('endLongitude');
    }
    expect(calls().some(call => call.method === 'PUT')).toBe(false);
  },
);

test('편도 도착지가 없으면 추천 요청을 보내지 않는다', async () => {
  await expect(
    api().courses.recommend({ ...search, shape: 'point_to_point' }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(fetchMock).not.toHaveBeenCalled();
});
