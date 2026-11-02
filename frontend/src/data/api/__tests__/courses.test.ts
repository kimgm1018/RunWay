import { appConfig } from '../../../config';
import { createMockRepositories } from '../../mock/createMockRepositories';
import type { CourseSearch } from '../../types';
import { createCoursesApi } from '../courses';
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
    courses: createCoursesApi({ mock, usualPace: async () => usualPace }),
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
    name: '부산광역시 수영구 코스',
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

test('C01 sends the search and each card is filled from C03', async () => {
  serve((url, init) => {
    if (url.pathname.endsWith('/courses/recommendations')) {
      return respond(200, {
        courses: [
          {
            id: 7,
            regionCode: '26500',
            status: 'ACTIVE',
            distanceM: 5000,
            environmentTags: ['PARK', 'BEACH'],
            estimatedDurationSec: 1800,
          },
          {
            id: 11,
            regionCode: null,
            status: 'ACTIVE',
            distanceM: 4800,
            environmentTags: [],
            estimatedDurationSec: 1728,
          },
        ],
      });
    }
    if (url.pathname.endsWith('/courses/11')) {
      return respond(
        200,
        detail(11, {
          distanceM: 4800,
          elevationGainM: null,
          elevationProfile: null,
          description: '바다를 따라 달려요',
        }),
      );
    }
    return common(url, init);
  });
  const { courses } = api();

  const found = await courses.recommend(search);

  const post = calls().find(call => call.method === 'POST')!;
  expect(post.url.toString()).toBe(
    `${appConfig.apiBaseUrl}/courses/recommendations`,
  );
  // TIME leaves the pace out; the origin goes as latitude and longitude.
  expect(post.body).toEqual({
    latitude: 35.153,
    longitude: 129.118,
    targetDistanceM: 5000,
    goalInputType: 'TIME',
    targetDurationSec: 1800,
    environmentTypes: ['PARK', 'BEACH'],
    limit: 10,
  });
  expect(found[0]).toMatchObject({
    id: '7',
    name: '부산광역시 수영구 코스',
    distanceM: 5000,
    estimatedDurationSec: 1800,
    shapeKind: '순환',
    environmentLabels: ['공원', '해변'],
    elevationGainM: 12,
    elevationProfile: [0, 0, 33, 33, 100, 100, 33, 33, 0, 0],
    reason: '목표 5.0km에 가까운 코스 중 출발점이 가까운 순서예요.',
    route: loop,
    // Course 7 is in my C09 list.
    saved: true,
  });
  expect(found[1]).toMatchObject({
    id: '11',
    name: '4.8km 코스',
    shapeKind: '편도',
    environmentLabels: [],
    elevationGainM: null,
    elevationProfile: [],
    reason: '바다를 따라 달려요',
    saved: false,
  });
});

test('C01 with a pace goal sends the pace instead of the time', async () => {
  serve((url, init) =>
    url.pathname.endsWith('/courses/recommendations')
      ? respond(200, { courses: [] })
      : common(url, init),
  );
  const { courses } = api();

  const found = await courses.recommend({ ...search, goalInputType: 'PACE' });

  expect(found).toEqual([]);
  const post = calls().find(call => call.method === 'POST')!;
  expect(post.body.targetPaceSecPerKm).toBe(360);
  expect(post.body).not.toHaveProperty('targetDurationSec');
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
    name: '부산광역시 수영구 코스',
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
