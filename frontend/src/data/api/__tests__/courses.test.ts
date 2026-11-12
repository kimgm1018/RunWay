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
) =>
  | ReturnType<typeof respond>
  | Promise<ReturnType<typeof respond>>
  | undefined;

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

// S15P31E105-612: C03 brings the map image for the card, its relative address made whole; an unreadable one and
// an older server's missing field are null.
test('C09 saved courses carry the C03 basemap, null when C03 has none', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/7' && init.method === 'GET') {
      return respond(200, {
        ...detail(7),
        basemap: {
          imageUrl: '/api/v1/courses/7/basemap.png',
          osmDataTimestamp: '2026-11-01T00:00:00Z',
        },
      });
    }
    return common(url, init);
  });
  const { courses } = api(400);

  const saved = await courses.getSaved();

  expect(saved[0].basemap).toEqual({
    imageUrl: 'https://k15e105.p.ssafy.io/api/v1/courses/7/basemap.png',
    osmDataTimestamp: '2026-11-01T00:00:00Z',
  });
  expect(saved[1].basemap).toBeNull();
});

test('C09 saved courses drop a basemap whose image cannot be loaded', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/7' && init.method === 'GET') {
      return respond(200, {
        ...detail(7),
        basemap: { imageUrl: '', osmDataTimestamp: null },
      });
    }
    return common(url, init);
  });
  const { courses } = api(400);

  const saved = await courses.getSaved();

  expect(saved[0].basemap).toBeNull();
});

test('without a running profile the expected time uses 6′00″', async () => {
  serve(common);
  const { courses } = api(null);

  const saved = await courses.getSaved();

  expect(saved[0].expectedMinutes).toBe(30);
});

test('getSaved keeps the other courses when one C03 detail fails', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/9' && init.method === 'GET') {
      return respond(500, { code: 'INTERNAL_ERROR', message: 'detail failed' });
    }
    return common(url, init);
  });
  const { courses } = api(400);

  const saved = await courses.getSaved();

  expect(saved.map(item => item.id)).toEqual(['7']);
  expect(saved[0]).toMatchObject({
    status: 'ACTIVE',
    mergedIntoCourseId: null,
  });
});

test('getSaved keeps MERGED and BLOCKED with status, not as plain ACTIVE runs', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/users/me/bookmarked-courses') {
      return respond(200, {
        items: [
          {
            id: 7,
            regionCode: '26500',
            status: 'MERGED',
            mergedIntoCourseId: 11,
            myAlias: '옛 코스',
            distanceM: 5000,
          },
          {
            id: 9,
            regionCode: null,
            status: 'BLOCKED',
            mergedIntoCourseId: null,
            myAlias: null,
            distanceM: 6200.5,
          },
        ],
      });
    }
    const match = path.match(/^\/courses\/(\d+)$/);
    if (match && init.method === 'GET') {
      const id = Number(match[1]);
      return respond(200, {
        ...detail(id, {
          status: id === 7 ? 'MERGED' : 'BLOCKED',
          mergedIntoCourseId: id === 7 ? 11 : null,
        }),
      });
    }
    return common(url, init);
  });
  const { courses } = api(400);

  const saved = await courses.getSaved();

  expect(saved).toEqual([
    expect.objectContaining({
      id: '7',
      status: 'MERGED',
      mergedIntoCourseId: '11',
    }),
    expect.objectContaining({
      id: '9',
      status: 'BLOCKED',
      mergedIntoCourseId: null,
    }),
  ]);
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
      candidateToken: 'v1.1762311600.token-0',
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
      candidateToken: 'v1.1762311600.token-1',
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
  await expect(courses.unsave('7')).rejects.toMatchObject({
    code: 'COURSE_NOT_FOUND',
  });
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
    // C12 has no plan here (the test server does not answer it): nothing from the mock plan stands in
    // (S15P31E105-635), and the course still shows (S15P31E105-733).
    segmentPacesSecPerKm: [],
    strategy: null,
    targetPaceSecPerKm: null,
    caution: null,
  });
});

// S15P31E105-715: the course map after a tap draws the pause connectors grey, so the plan carries C03's unmeasuredEdges.
test('2.0 carries the C03 unmeasuredEdges into the plan, and an older server gives none', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/7' && init.method === 'GET') {
      return respond(200, { ...detail(7), unmeasuredEdges: [1] });
    }
    return common(url, init);
  });
  const { courses } = api(400);
  await courses.getSaved();
  await courses.choose('7');
  expect((await courses.getTodayPlan())?.unmeasuredEdges).toEqual([1]);

  serve(common);
  const older = api(400);
  await older.courses.getSaved();
  await older.courses.choose('7');
  expect((await older.courses.getTodayPlan())?.unmeasuredEdges).toEqual([]);
});

test('2.0 has no plan before a course is picked, instead of the mock course (S15P31E105-635)', async () => {
  serve(common);
  const { courses } = api(400);

  await expect(courses.getTodayPlan()).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('2.0 names a course it never listed by its distance', async () => {
  serve(common);
  const { courses } = api(400);

  await courses.choose('9');

  expect((await courses.getTodayPlan())?.name).toBe('6.2km 코스');
});

// C01 then C10 (S15P31E105-526): the picked route is stored and runs as course 7.
function serveGenerated(stored: () => ReturnType<typeof respond>) {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/recommendations') {
      return respond(200, generatedAnswer);
    }
    if (path === '/courses/generated' && init.method === 'POST') {
      return stored();
    }
    if (path === '/courses/7/bookmark') {
      return respond(200, { bookmarked: true });
    }
    return common(url, init);
  });
}

const posted = () =>
  calls().filter(call => call.url.pathname.endsWith('/courses/generated'));

test('C10 stores the picked C01 route as it came, and 2.0 runs that course', async () => {
  serveGenerated(() => respond(200, { courseId: 7, reused: false }));
  const { courses } = api(400);
  const found = await courses.recommend(search);

  await courses.choose(found.courses[0].id);
  const plan = await courses.getTodayPlan();

  expect(posted().map(call => call.body)).toEqual([
    {
      candidateToken: 'v1.1762311600.token-0',
      route: { type: 'LineString', coordinates: loop },
      distanceM: 5020,
      elevationProfile: generatedAnswer.courses[0].elevationProfile,
    },
  ]);
  expect(plan).toMatchObject({
    courseId: '7',
    // The card's name, as C03 has no region.
    name: '5.0km 코스',
    distanceM: 5000,
    route: loop,
    expectedDurationSec: 2000,
  });
});

test('saving and picking the same route asks C10 once and saves the stored course with C07', async () => {
  // The same points as a course already stored: C10 hands that one back.
  serveGenerated(() => respond(200, { courseId: 7, reused: true }));
  const { courses } = api();
  const found = await courses.recommend(search);
  const card = found.courses[0].id;

  await Promise.all([courses.save(card), courses.choose(card)]);
  await courses.unsave(card);

  expect(posted()).toHaveLength(1);
  expect(
    calls()
      .filter(call => call.url.pathname.endsWith('/bookmark'))
      .map(call => call.method),
  ).toEqual(['PUT', 'DELETE']);
  expect((await courses.getTodayPlan())?.courseId).toBe('7');
});

test('a route C10 turns down says so, and the next tap asks again', async () => {
  let answer = respond(422, {
    code: 'COURSE_CANDIDATE_INVALID',
    message: '',
    details: {},
  });
  serveGenerated(() => answer);
  const { courses } = api();
  const found = await courses.recommend(search);

  await expect(courses.choose(found.courses[1].id)).rejects.toMatchObject({
    code: 'COURSE_CANDIDATE_INVALID',
  });
  answer = respond(200, { courseId: 7, reused: false });
  await courses.choose(found.courses[1].id);

  expect(posted().map(call => call.body.candidateToken)).toEqual([
    'v1.1762311600.token-1',
    'v1.1762311600.token-1',
  ]);
  expect((await courses.getTodayPlan())?.courseId).toBe('7');
});

test('a completed run is saved as a private course from its server record', async () => {
  serve((url, init) =>
    url.pathname.endsWith('/running-records/701/course') &&
    init.method === 'PUT'
      ? respond(200, { courseId: 52 })
      : common(url, init),
  );
  const { courses } = api();
  await expect(courses.saveFromRun('701')).resolves.toEqual({ courseId: '52' });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/running-records/701/course'),
    expect.objectContaining({ method: 'PUT' }),
  );
});

test('a route this search never made cannot be stored and sends nothing', async () => {
  const { courses } = api();
  await expect(courses.save('generated:1:9')).rejects.toMatchObject({
    code: 'COURSE_CANDIDATE_INVALID',
  });
  expect(fetchMock).not.toHaveBeenCalled();
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

// S15P31E105-655: seed/index identify a slot, not a candidate across C01 answers.
const relocatedSearch: CourseSearch = {
  ...search,
  origin: { name: '다른 출발점', position: oneWay[0] },
};
const relocatedAnswer = {
  ...generatedAnswer,
  courses: [
    {
      ...generatedAnswer.courses[0],
      route: { type: 'LineString', coordinates: oneWay },
      candidateToken: 'v1.1762311600.relocated',
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const responseFor = (body: { longitude: number }) =>
  body.longitude === search.origin.position[0]
    ? generatedAnswer
    : relocatedAnswer;

function relocatedRoute(url: URL, init: { method: string; body?: string }) {
  if (url.pathname.endsWith('/courses/recommendations')) {
    return respond(200, responseFor(JSON.parse(init.body!)));
  }
  if (url.pathname.endsWith('/courses/generated')) {
    const { candidateToken } = JSON.parse(init.body!);
    return respond(200, {
      courseId:
        candidateToken === relocatedAnswer.courses[0].candidateToken ? 9 : 7,
      reused: false,
    });
  }
  if (url.pathname.endsWith('/bookmark')) {
    return respond(200, { bookmarked: true });
  }
  return common(url, init);
}

test.each(['choose', 'save'] as const)(
  'a new location with the same seed/index gets its own C10 route after %s',
  async action => {
    serve(relocatedRoute);
    const { courses } = api();
    const first = (await courses.recommend(search)).courses[0];
    await courses[action](first.id);
    const second = (await courses.recommend(relocatedSearch)).courses[0];
    await courses.save(second.id);
    await courses.choose(second.id);

    expect(second.id).not.toBe(first.id);
    expect(second.route).toEqual(oneWay);
    expect(posted().map(call => call.body)).toEqual([
      {
        candidateToken: generatedAnswer.courses[0].candidateToken,
        route: generatedAnswer.courses[0].route,
        distanceM: generatedAnswer.courses[0].distanceM,
        elevationProfile: generatedAnswer.courses[0].elevationProfile,
      },
      {
        candidateToken: relocatedAnswer.courses[0].candidateToken,
        route: relocatedAnswer.courses[0].route,
        distanceM: relocatedAnswer.courses[0].distanceM,
        elevationProfile: relocatedAnswer.courses[0].elevationProfile,
      },
    ]);
    expect(
      calls()
        .filter(call => call.url.pathname.endsWith('/bookmark'))
        .pop()?.url.pathname,
    ).toMatch(/\/courses\/9\/bookmark$/);
    expect(await courses.getTodayPlan()).toMatchObject({
      courseId: '9',
      route: oneWay,
    });
  },
);

test('a late C01 answer cannot replace a newer card candidate', async () => {
  const late = deferred<ReturnType<typeof respond>>();
  const started = deferred<void>();
  serve((url, init) => {
    if (
      url.pathname.endsWith('/courses/recommendations') &&
      JSON.parse(init.body!).longitude === search.origin.position[0]
    ) {
      started.resolve();
      return late.promise;
    }
    return relocatedRoute(url, init);
  });
  const { courses } = api();
  const pending = courses.recommend(search);
  await started.promise;
  const second = (await courses.recommend(relocatedSearch)).courses[0];
  late.resolve(respond(200, generatedAnswer));
  const first = (await pending).courses[0];
  await courses.choose(second.id);
  await courses.save(first.id);

  expect(first.id).not.toBe(second.id);
  expect(posted().map(call => call.body.route.coordinates)).toEqual([
    oneWay,
    loop,
  ]);
  expect(await courses.getTodayPlan()).toMatchObject({
    courseId: '9',
    route: oneWay,
  });
});

test('a late C10 for an older card keeps its own mapping and the new card stays deduplicated', async () => {
  const late = deferred<ReturnType<typeof respond>>();
  const started = deferred<void>();
  serve((url, init) => {
    if (
      url.pathname.endsWith('/courses/generated') &&
      JSON.parse(init.body!).candidateToken ===
        generatedAnswer.courses[0].candidateToken
    ) {
      started.resolve();
      return late.promise;
    }
    return relocatedRoute(url, init);
  });
  const { courses } = api();
  const first = (await courses.recommend(search)).courses[0];
  const pending = courses.save(first.id);
  await started.promise;
  const second = (await courses.recommend(relocatedSearch)).courses[0];
  try {
    expect(second.id).not.toBe(first.id);
    // B must finish while A is still pending; do not depend on microtask order.
    await Promise.all([courses.choose(second.id), courses.save(second.id)]);
  } finally {
    late.resolve(respond(200, { courseId: 7, reused: false }));
    await pending;
  }
  await courses.save(second.id);

  expect(posted().map(call => call.body.route.coordinates)).toEqual([
    loop,
    oneWay,
  ]);
  expect(
    calls()
      .filter(call => call.url.pathname.endsWith('/bookmark'))
      .map(call => call.url.pathname.match(/courses\/(\d+)\//)?.[1]),
  ).toEqual(['9', '7', '9']);
  expect(await courses.getTodayPlan()).toMatchObject({
    courseId: '9',
    route: oneWay,
  });
});

// S15P31E105-733: 2.0 fills its km paces from C12, the same pre-run plan S01 would store.
const pacePlan = (personalized: boolean) => ({
  courseId: 7,
  recommendedPaceSecPerKm: 400,
  segments: [0, 1, 2, 3, 4].map(index => ({
    sequence: index + 1,
    startDistanceM: index * 1000,
    endDistanceM: (index + 1) * 1000,
    recommendedPaceSecPerKm: [410, 405, 400, 395, 390][index],
  })),
  personalized,
});

test('2.0 shows the km paces and the source of C12 pre-run plan', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/7/pace-plan' && init.method === 'GET') {
      return respond(200, pacePlan(true));
    }
    return common(url, init);
  });
  const { courses } = api(400);
  await courses.getSaved();
  await courses.choose('7');

  expect(await courses.getTodayPlan({ pacePlan: true })).toMatchObject({
    segmentPacesSecPerKm: [410, 405, 400, 395, 390],
    // The plan pace does not become the run's goal (S01 keeps storing the same AI plan without a goal).
    targetPaceSecPerKm: null,
    expectedDurationSec: 2000,
    strategy: '초반 안정 → 후반 가속',
    planSource: 'PERSONAL',
  });
});

test('2.0 keeps the course without km paces when C12 fails, so the run can still start', async () => {
  serve((url, init) => {
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/courses/7/pace-plan') {
      return respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} });
    }
    return common(url, init);
  });
  const { courses } = api(400);
  await courses.getSaved();
  await courses.choose('7');

  expect(await courses.getTodayPlan({ pacePlan: true })).toMatchObject({
    courseId: '7',
    distanceM: 5000,
    segmentPacesSecPerKm: [],
    planSource: null,
    strategy: null,
    targetPaceSecPerKm: null,
  });
});

test('C12 maps an average plan and an even plan', () => {
  const { planFromServer } = require('../courses');
  expect(planFromServer(pacePlan(false))?.planSource).toBe('AVERAGE');
  const even = { ...pacePlan(false), segments: pacePlan(false).segments.map(
    (segment: { recommendedPaceSecPerKm: number }) => ({ ...segment, recommendedPaceSecPerKm: 400 }),
  ) };
  expect(planFromServer(even)?.strategy).toBe('고른 페이스');
  expect(planFromServer({ ...even, segments: [] })).toBeNull();
});

test('callers that do not ask for the pace plan (group create) make no C12 call', async () => {
  serve(common);
  const { courses } = api(400);
  await courses.getSaved();
  await courses.choose('7');
  await courses.getTodayPlan();
  const paths = fetchMock.mock.calls.map(([address]) => new URL(address).pathname);
  expect(paths.some(path => path.endsWith('/pace-plan'))).toBe(false);
});
