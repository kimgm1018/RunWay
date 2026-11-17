import { DataError } from '../../errors';
import { createMockRepositories } from '../../mock/createMockRepositories';
import type { MyCrew, Repositories } from '../../types';
import { createGroupRunsApi } from '../groupRuns';
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

const now = Date.parse('2026-11-02T03:00:00Z');
const hoursFromNow = (hours: number) =>
  new Date(now + hours * 3600 * 1000).toISOString();

// Run 61 is a course run I joined that starts in 3 hours; 62 is a free run next week I have not joined.
function detail(id: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    title: id === 61 ? '월요일, 함께 5km' : '일요일, 함께 40분',
    description: null,
    hostId: id === 61 ? 101 : 7,
    crewId: 41,
    courseId: id === 61 ? 301 : null,
    scheduledAt: id === 61 ? hoursFromNow(3) : hoursFromNow(150),
    meetingPosition: { type: 'Point', coordinates: [129.118, 35.153] },
    participantCount: id === 61 ? 2 : 1,
    status: 'SCHEDULED',
    targetDistanceM: null,
    targetDurationSec: null,
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    goalPaceSecPerKm: null,
    ...fields,
  };
}

const participants = (id: number) => {
  const items =
    id === 61
      ? [
          { userId: 9, nickname: '하린', isHost: false, readyStatus: 'READY' },
          {
            userId: 101,
            nickname: '민준',
            isHost: true,
            readyStatus: 'WAITING',
          },
        ]
      : [{ userId: 7, nickname: '성윤', isHost: true, readyStatus: 'WAITING' }];
  return {
    items,
    participantCount: items.length,
    readyCount: items.filter(item => item.readyStatus === 'READY').length,
  };
};

type Route = (
  path: string,
  init: { method: string; body?: string },
  url: URL,
) => ReturnType<typeof respond> | undefined;

// G02 lists runs 61, 62 and a finished 60 for crew 41; G03·G07·C03 answer for each.
const common: Route = (path, init, url) => {
  if (path === '/group-runs' && init.method === 'GET') {
    return url.searchParams.get('crewId') === '41'
      ? respond(200, {
          items: [
            { id: 60, status: 'COMPLETED' },
            { id: 62, status: 'SCHEDULED' },
            { id: 61, status: 'SCHEDULED' },
          ],
          nextCursor: null,
        })
      : respond(200, { items: [], nextCursor: null });
  }
  let match = path.match(/^\/group-runs\/(\d+)$/);
  if (match && init.method === 'GET') {
    return respond(200, detail(Number(match[1])));
  }
  match = path.match(/^\/group-runs\/(\d+)\/participants$/);
  if (match) {
    return respond(200, participants(Number(match[1])));
  }
  if (path === '/courses/301') {
    return respond(200, {
      myAlias: '민락 아침 코스',
      distanceM: 5000,
      route: {
        coordinates: [
          [129.118, 35.153],
          [129.12, 35.16],
        ],
      },
    });
  }
  return undefined;
};

function serve(route: Route = common) {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      const answer = route(path, init, url) ?? common(path, init, url);
      if (!answer) {
        throw new Error(`unexpected request ${init.method} ${address}`);
      }
      return answer;
    },
  );
}

const sent = (method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => init.method === method)
    .map(([address, init]) => ({
      path: new URL(address).pathname.replace(/^.*\/api\/v1/, ''),
      body: init.body ? JSON.parse(init.body) : undefined,
    }));

const myCrew: MyCrew = {
  id: '41',
  name: '광안리 새벽 크루',
  area: '부산 수영구',
  memberCount: 12,
  membership: 'MEMBER',
};

function api({
  crews = [myCrew],
  usualPace = 380,
}: { crews?: MyCrew[]; usualPace?: number | null } = {}) {
  const mock = createMockRepositories({ latencyMs: 0 });
  const crewsRepo = {
    ...mock.crews,
    get: async () => ({ name: '광안리 새벽 크루', memberCount: 12 }),
    search: async () => [
      {
        id: '41',
        name: 'a',
        description: null,
        area: '부산 수영구',
        capacity: 30,
        memberCount: 12,
        myMembership: null,
      },
      {
        id: '42',
        name: 'b',
        description: null,
        area: '부산 해운대구',
        capacity: 20,
        memberCount: 20,
        myMembership: null,
      },
      {
        id: '43',
        name: 'c',
        description: null,
        area: '부산 수영구',
        capacity: 20,
        memberCount: 3,
        myMembership: null,
      },
    ],
  } as unknown as Repositories['crews'];
  return {
    mock: mock.groupRuns,
    groupRuns: createGroupRunsApi({
      mock: mock.groupRuns,
      crews: crewsRepo,
      myCrews: async () => crews,
      myId: async () => '101',
      usualPace: async () => usualPace,
    }),
  };
}

beforeEach(async () => {
  jest.useFakeTimers({ now, advanceTimers: true });
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('place search in API mode uses the real endpoint instead of mock places', async () => {
  const place = {
    name: '검색된 공원',
    address: '도로 1',
    position: [129.118, 35.153],
    distanceM: null,
  };
  serve(path =>
    path === '/places/search' ? respond(200, { items: [place] }) : undefined,
  );
  expect(await api().groupRuns.searchPlaces('공원')).toEqual([place]);
  expect(
    fetchMock.mock.calls.some(([address]) =>
      new URL(address).pathname.endsWith('/places/search'),
    ),
  ).toBe(true);
});

afterEach(() => {
  jest.useRealTimers();
});

test('6.0 lists open runs of my crews and pins the one I joined that starts soon', async () => {
  serve();

  const mine = await api().groupRuns.listMine();

  const runs = mine.crews[0].groupRuns;
  expect(runs.map(run => run.id)).toEqual(['61', '62']);
  expect(runs[0]).toMatchObject({
    crewId: '41',
    crewName: '광안리 새벽 크루',
    hostNickname: '민준',
    isHost: true,
    joined: true,
    courseId: '301',
    courseName: '민락 아침 코스',
    // No goal on the server: the course gives the distance.
    targetDistanceM: 5000,
    meetingAddress: '부산 수영구 광안해변로 219',
    participantCount: 2,
  });
  expect(runs[1]).toMatchObject({
    isHost: false,
    joined: false,
    courseName: null,
    targetDistanceM: null,
  });
  expect(mine.upcoming?.id).toBe('61');
});

// S15P31E105-823: both runs joined; 61's time and status vary per case.
function serveJoined(fields61: Record<string, unknown>, fields62 = {}) {
  serve((path, init) => {
    if (path === '/group-runs/61' && init.method === 'GET') {
      return respond(200, detail(61, fields61));
    }
    if (path === '/group-runs/62' && init.method === 'GET') {
      return respond(
        200,
        detail(62, { scheduledAt: hoursFromNow(5), ...fields62 }),
      );
    }
    if (path === '/group-runs/62/participants') {
      return respond(200, participants(61));
    }
    return undefined;
  });
}

test('6.0 hides a run whose start passed long ago and never began (S15P31E105-891)', async () => {
  // 61 was due five days ago and never started; 62 starts in 5 hours.
  serveJoined({ scheduledAt: hoursFromNow(-5 * 24) });

  const mine = await api().groupRuns.listMine();

  expect(mine.upcoming?.id).toBe('62');
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['62']);
});

test('6.0 keeps a long-past run that is under way in the list (S15P31E105-891)', async () => {
  serveJoined({ scheduledAt: hoursFromNow(-30), status: 'RUNNING' });

  const mine = await api().groupRuns.listMine();

  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['61', '62']);
});

test('6.0 keeps pinning a run just past its start while the host may still begin', async () => {
  serveJoined({ scheduledAt: hoursFromNow(-0.5) });

  const mine = await api().groupRuns.listMine();

  expect(mine.upcoming?.id).toBe('61');
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['61', '62']);
});

test('6.0 pins a run under way over one still to start', async () => {
  serveJoined(
    { scheduledAt: hoursFromNow(-30), status: 'RUNNING' },
    { scheduledAt: hoursFromNow(-0.2) },
  );

  const mine = await api().groupRuns.listMine();

  expect(mine.upcoming).toMatchObject({ id: '61', status: 'RUNNING' });
});

test('6.0 pins nothing when only stale or far-off runs are joined', async () => {
  serveJoined(
    { scheduledAt: hoursFromNow(-3) },
    { scheduledAt: hoursFromNow(48) },
  );

  const mine = await api().groupRuns.listMine();

  expect(mine.upcoming).toBeNull();
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['62']);
});

test('6.0 skips crews still waiting for approval', async () => {
  serve();
  const mine = await api({
    crews: [myCrew, { ...myCrew, id: '44', membership: 'PENDING' }],
  }).groupRuns.listMine();
  expect(mine.crews[1].groupRuns).toEqual([]);
  expect(sent('GET').filter(call => call.path === '/group-runs')).toHaveLength(
    1,
  );
});

test('6.0b without crews counts open crews and their areas', async () => {
  const mine = await api({ crews: [] }).groupRuns.listMine();
  expect(mine).toEqual({
    upcoming: null,
    crews: [],
    nearbyRecruiting: { count: 2, areas: ['부산 수영구'] },
  });
});

test('6.0b without crews stays empty when nearby recruiting search fails', async () => {
  const mock = createMockRepositories({ latencyMs: 0 });
  const groupRuns = createGroupRunsApi({
    mock: mock.groupRuns,
    crews: {
      ...mock.crews,
      search: async () => {
        throw new DataError('NETWORK_ERROR', '크루 검색 실패');
      },
    } as unknown as Repositories['crews'],
    myCrews: async () => [],
    myId: async () => '101',
    usualPace: async () => 380,
  });

  await expect(groupRuns.listMine()).resolves.toEqual({
    upcoming: null,
    crews: [],
    nearbyRecruiting: { count: 0, areas: [] },
  });
});

test('6.0 keeps other runs when one G03 detail fails', async () => {
  serve((path, init) => {
    if (path === '/group-runs/62' && init.method === 'GET') {
      return respond(503, {
        code: 'SERVER_ERROR',
        message: '잠시 후 다시 시도해 주세요',
      });
    }
    return undefined;
  });

  const mine = await api().groupRuns.listMine();
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['61']);
  expect(mine.upcoming?.id).toBe('61');
});

test('6.0 keeps other crews when one crew G02 list fails', async () => {
  const other: MyCrew = {
    ...myCrew,
    id: '42',
    name: '해운대 저녁 크루',
  };
  serve((path, init, url) => {
    if (path === '/group-runs' && init.method === 'GET') {
      if (url.searchParams.get('crewId') === '42') {
        return respond(503, {
          code: 'SERVER_ERROR',
          message: '잠시 후 다시 시도해 주세요',
        });
      }
      return undefined;
    }
    return undefined;
  });

  const mine = await api({ crews: [myCrew, other] }).groupRuns.listMine();
  expect(mine.crews.map(item => item.crew.id)).toEqual(['41', '42']);
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['61', '62']);
  expect(mine.crews[1].groupRuns).toEqual([]);
  expect(mine.upcoming?.id).toBe('61');
});

test('6.0 follows G02 nextCursor until the crew list is exhausted', async () => {
  serve((path, init, url) => {
    if (path === '/group-runs' && init.method === 'GET') {
      if (url.searchParams.get('crewId') !== '41') {
        return respond(200, { items: [], nextCursor: null });
      }
      if (!url.searchParams.get('cursor')) {
        return respond(200, {
          items: [
            { id: 60, status: 'COMPLETED' },
            { id: 61, status: 'SCHEDULED' },
          ],
          nextCursor: '61',
        });
      }
      if (url.searchParams.get('cursor') === '61') {
        return respond(200, {
          items: [{ id: 62, status: 'SCHEDULED' }],
          nextCursor: null,
        });
      }
      return respond(200, { items: [], nextCursor: null });
    }
    return undefined;
  });

  const mine = await api().groupRuns.listMine();
  expect(mine.crews[0].groupRuns.map(run => run.id)).toEqual(['61', '62']);
  const listCalls = fetchMock.mock.calls
    .map(([address, init]) => ({
      path: new URL(address).pathname.replace(/^.*\/api\/v1/, ''),
      method: init.method,
      cursor: new URL(address).searchParams.get('cursor'),
    }))
    .filter(call => call.path === '/group-runs' && call.method === 'GET');
  expect(listCalls).toEqual([
    { path: '/group-runs', method: 'GET', cursor: null },
    { path: '/group-runs', method: 'GET', cursor: '61' },
  ]);
});

test('6.4 fills the run from G03, G07, the crew and the course', async () => {
  serve();

  const run = await api().groupRuns.get('61');

  expect(run).toMatchObject({
    route: [
      [129.118, 35.153],
      [129.12, 35.16],
    ],
    meetingPosition: [129.118, 35.153],
    // G03 has no pace without a goal, so my usual pace stands in.
    goalPaceSecPerKm: 380,
    crewMemberCount: 12,
    myFit: null,
    cancellation: null,
  });
  expect(
    run.participants.map(member => [
      member.nickname,
      member.isHost,
      member.isMe,
      member.readyStatus,
    ]),
  ).toEqual([
    ['민준', true, true, 'WAITING'],
    ['하린', false, false, 'READY'],
  ]);
});

test('G01 sends place and time with a made-up title and no goals', async () => {
  serve((path, init) =>
    path === '/group-runs' && init.method === 'POST'
      ? respond(201, { id: 70 })
      : undefined,
  );
  const { groupRuns } = api();

  const { id } = await groupRuns.create({
    crewId: '41',
    courseId: null,
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    meetingPosition: [129.118, 35.153],
    meetingNote: '편의점 앞',
    scheduledAt: '2026-11-08T07:00:00+09:00',
    targetDistanceM: null,
    targetDurationSec: 2400,
  });

  expect(id).toBe('70');
  expect(sent('POST')[0].body).toEqual({
    crewId: 41,
    courseId: null,
    title: '일요일, 함께 40분',
    scheduledAt: '2026-11-07T22:00:00.000Z',
    meetingPosition: { type: 'Point', coordinates: [129.118, 35.153] },
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    description: '편의점 앞',
  });
});

test('G04 sends the edit and keeps the saved note when none is typed', async () => {
  serve((path, init) =>
    path === '/group-runs/61' && init.method === 'PATCH'
      ? respond(200, { id: 61 })
      : undefined,
  );

  await api().groupRuns.update('61', {
    courseId: '301',
    meetingPlaceName: '민락수변공원',
    meetingAddress: '부산 수영구 민락수변로 7',
    meetingPosition: [129.13, 35.157],
    meetingNote: null,
    scheduledAt: '2026-11-08T08:30:00+09:00',
    targetDistanceM: 5000,
    targetDurationSec: null,
  });

  expect(sent('PATCH')[0]).toEqual({
    path: '/group-runs/61',
    body: {
      courseId: 301,
      title: '일요일, 함께 5km',
      scheduledAt: '2026-11-07T23:30:00.000Z',
      meetingPosition: { type: 'Point', coordinates: [129.13, 35.157] },
      meetingPlaceName: '민락수변공원',
      meetingAddress: '부산 수영구 민락수변로 7',
    },
  });
});

test('G04 refresh free-run title minutes without sending a duration-only goal', async () => {
  serve((path, init) =>
    path === '/group-runs/61' && init.method === 'PATCH'
      ? respond(200, { id: 61 })
      : undefined,
  );

  await api().groupRuns.update('61', {
    courseId: null,
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    meetingPosition: [129.118, 35.153],
    meetingNote: null,
    scheduledAt: '2026-11-08T07:00:00+09:00',
    targetDistanceM: null,
    targetDurationSec: 2700,
  });

  expect(sent('PATCH')[0].body).toEqual({
    courseId: null,
    title: '일요일, 함께 45분',
    scheduledAt: '2026-11-07T22:00:00.000Z',
    meetingPosition: { type: 'Point', coordinates: [129.118, 35.153] },
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
  });
});

const place = {
  meetingPlaceName: '광안리해수욕장 입구',
  meetingAddress: '부산 수영구 광안해변로 219',
  meetingPosition: [129.118, 35.153] as [number, number],
  meetingNote: null,
  scheduledAt: '2026-11-08T07:00:00+09:00',
};
const goalFields = [
  'goalInputType',
  'targetDistanceM',
  'targetDurationSec',
  'targetPaceSecPerKm',
];

test('G01 sends a course run TIME goal with the course distance', async () => {
  serve((path, init) =>
    path === '/group-runs' && init.method === 'POST'
      ? respond(201, { id: 71 })
      : undefined,
  );

  await api().groupRuns.create({
    ...place,
    crewId: '41',
    courseId: '301',
    targetDistanceM: 5000.4,
    targetDurationSec: 2400,
  });

  const { body } = sent('POST')[0];
  expect(body).toMatchObject({
    courseId: 301,
    title: '일요일, 함께 5km',
    goalInputType: 'TIME',
    targetDistanceM: 5000,
    targetDurationSec: 2400,
  });
  expect(body).not.toHaveProperty('targetPaceSecPerKm');
});

test('G01 sends no goal fields for a free run', async () => {
  serve((path, init) =>
    path === '/group-runs' && init.method === 'POST'
      ? respond(201, { id: 72 })
      : undefined,
  );

  await api().groupRuns.create({
    ...place,
    crewId: '41',
    courseId: null,
    targetDistanceM: null,
    targetDurationSec: 1800,
  });

  const { body } = sent('POST')[0];
  expect(body.title).toBe('일요일, 함께 30분');
  goalFields.forEach(field => expect(body).not.toHaveProperty(field));
});

test('G04 sends the new course distance with the TIME goal', async () => {
  serve((path, init) =>
    path === '/group-runs/61' && init.method === 'PATCH'
      ? respond(200, { id: 61 })
      : undefined,
  );

  await api().groupRuns.update('61', {
    ...place,
    courseId: '302',
    targetDistanceM: 7200,
    targetDurationSec: 3000,
  });

  expect(sent('PATCH')[0].body).toMatchObject({
    courseId: 302,
    goalInputType: 'TIME',
    targetDistanceM: 7200,
    targetDurationSec: 3000,
  });
});

// G04 rejects null goal fields (부분 목표 해제 미지원), so a run made free omits them instead.
test('G04 to a free run clears the course and omits goal fields', async () => {
  serve((path, init) =>
    path === '/group-runs/61' && init.method === 'PATCH'
      ? respond(200, { id: 61 })
      : undefined,
  );

  await api().groupRuns.update('61', {
    ...place,
    courseId: null,
    targetDistanceM: null,
    targetDurationSec: 2400,
  });

  const { body } = sent('PATCH')[0];
  expect(body.courseId).toBeNull();
  goalFields.forEach(field => expect(body).not.toHaveProperty(field));
});

test('G05 joins, G06 leaves and errors reach the screen', async () => {
  serve((path, init) => {
    if (path === '/group-runs/62/join') {
      return respond(200, { groupRunId: 62, userId: 101 });
    }
    if (path === '/group-runs/62/participants/me' && init.method === 'DELETE') {
      return respond(200, {});
    }
    if (path === '/group-runs/63/join') {
      return respond(409, {
        code: 'FULL_OR_ALREADY_JOINED',
        message: '',
        details: {},
      });
    }
    return undefined;
  });
  const { groupRuns } = api();

  await groupRuns.join('62');
  await groupRuns.leave('62');
  await expect(groupRuns.join('63')).rejects.toMatchObject({
    code: 'FULL_OR_ALREADY_JOINED',
  });

  expect(sent('POST').map(call => call.path)).toEqual([
    '/group-runs/62/join',
    '/group-runs/63/join',
  ]);
  expect(sent('DELETE').map(call => call.path)).toEqual([
    '/group-runs/62/participants/me',
  ]);
});

test('6.5 reads the room from G07 and G16 marks me ready', async () => {
  serve((path, init) =>
    path === '/group-runs/61/participants/me/ready' && init.method === 'POST'
      ? respond(200, {
          participantCount: 2,
          readyStatus: 'READY',
          readyCount: 2,
        })
      : undefined,
  );
  const { groupRuns } = api();

  const room = await groupRuns.setReady('61', true);

  expect(sent('POST')[0].body).toEqual({ ready: true });
  expect(room).toMatchObject({
    groupRunId: '61',
    goalPaceSecPerKm: 380,
    comfortRange: null,
    recommendedPaceSecPerKm: null,
    // 5km of course at 6′20″.
    expectedDurationSec: 1900,
    appliedCount: 2,
    participantCount: 2,
    readyCount: 1,
  });
});

test('889 G16 sends the chosen recording device only when getting ready', async () => {
  serve((path, init) =>
    path === '/group-runs/61/participants/me/ready' && init.method === 'POST'
      ? respond(200, {
          participantCount: 2,
          readyStatus: 'READY',
          readyCount: 2,
        })
      : undefined,
  );
  const { groupRuns } = api();

  await groupRuns.setReady('61', true, 'PHONE');
  await groupRuns.setReady('61', false, 'PHONE');

  expect(sent('POST').map(call => call.body)).toEqual([
    { ready: true, recordingDevice: 'PHONE' },
    { ready: false },
  ]);
});

test('889 G18 joins a started group run with the chosen device and returns my session', async () => {
  serve((path, init) =>
    path === '/group-runs/61/participants/me/start' && init.method === 'POST'
      ? respond(200, {
          sessionId: 905,
          commandId: 7001,
          result: 'PENDING',
          expectedVersion: 1,
          startedAt: null,
        })
      : undefined,
  );
  const { groupRuns } = api();

  const joined = await groupRuns.joinNow!('61', 'PHONE');

  expect(joined).toEqual({ sessionId: '905' });
  expect(sent('POST')[0].body).toEqual({ recordingDevice: 'PHONE' });
});

test('511 waiting room uses G07 participantCount and readyCount', async () => {
  serve(path =>
    path.endsWith('/participants')
      ? respond(200, {
          items: [
            {
              userId: 101,
              nickname: '민준',
              isHost: true,
              readyStatus: 'WAITING',
            },
            {
              userId: 9,
              nickname: '하린',
              isHost: false,
              readyStatus: 'READY',
            },
            {
              userId: 8,
              nickname: '서연',
              isHost: false,
              readyStatus: 'READY',
            },
          ],
          // items보다 큰 집계(목록 일부만 온 경우에도 서버 집계를 씀).
          participantCount: 5,
          readyCount: 3,
        })
      : undefined,
  );
  const room = await api().groupRuns.getWaitingRoom('61');
  expect(room).toMatchObject({
    appliedCount: 5,
    participantCount: 5,
    readyCount: 3,
  });
  expect(room.participants).toHaveLength(3);
});

test('G09 sends no body; G13 and G12 use the actual endpoints', async () => {
  serve((path, init) =>
    init.method === 'POST' && /\/(start|cancel|force-finish)$/.test(path)
      ? respond(200, {})
      : undefined,
  );
  const { groupRuns } = api();
  await groupRuns.start('61');
  await groupRuns.cancel('61', 'WEATHER');
  await groupRuns.forceFinish('61');
  expect(sent('POST')).toEqual([
    { path: '/group-runs/61/start', body: undefined },
    { path: '/group-runs/61/cancel', body: { cancelReason: 'WEATHER' } },
    { path: '/group-runs/61/force-finish', body: {} },
  ]);
});

test('G13 sends the trimmed cancelMessage and leaves a blank one out', async () => {
  serve((path, init) =>
    init.method === 'POST' && path.endsWith('/cancel')
      ? respond(200, {})
      : undefined,
  );
  const { groupRuns } = api();
  await groupRuns.cancel('61', 'WEATHER', '  비가 많이 와요  ');
  await groupRuns.cancel('62', 'PERSONAL', '   ');
  await groupRuns.cancel('63', 'OTHER', null);
  expect(sent('POST')).toEqual([
    {
      path: '/group-runs/61/cancel',
      body: { cancelReason: 'WEATHER', cancelMessage: '비가 많이 와요' },
    },
    { path: '/group-runs/62/cancel', body: { cancelReason: 'PERSONAL' } },
    { path: '/group-runs/63/cancel', body: { cancelReason: 'OTHER' } },
  ]);
});

test('G09 approval does not imply a start; watchStart waits for my confirmed session', async () => {
  let started = false;
  serve(path => {
    if (path === '/group-runs/61')
      return respond(200, detail(61, { status: 'RUNNING' }));
    if (path === '/group-runs/61/participants')
      return respond(200, {
        items: [
          {
            userId: 101,
            nickname: '나',
            isHost: true,
            readyStatus: 'READY',
            sessionId: 900,
          },
        ],
      });
    if (path === '/running-sessions/900')
      return respond(200, {
        state: started ? 'RUNNING' : 'READY',
        startedAt: started ? '2026-11-02T03:00:00Z' : null,
      });
    return undefined;
  });
  const onStart = jest.fn();
  const stop = api().groupRuns.watchStart('61', onStart);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onStart).not.toHaveBeenCalled();
    started = true;
    await jest.advanceTimersByTimeAsync(3100);
    expect(onStart).toHaveBeenCalledWith('2026-11-02T03:00:00Z');
    await jest.advanceTimersByTimeAsync(6000);
    expect(onStart).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test('watchStart reports cancel and finish with separate 409 messages', async () => {
  for (const [status, phrase] of [
    ['CANCELLED', '취소되었어요'],
    ['COMPLETED', '종료되었어요'],
  ] as const) {
    serve(path =>
      path === '/group-runs/61'
        ? respond(200, detail(61, { status }))
        : undefined,
    );
    const onError = jest.fn();
    const stop = api().groupRuns.watchStart('61', jest.fn(), onError);
    try {
      await jest.advanceTimersByTimeAsync(20);
      expect(onError).toHaveBeenCalled();
      const error = onError.mock.calls[0][0] as DataError;
      expect(error).toBeInstanceOf(DataError);
      expect(error.status).toBe(409);
      expect(error.message).toContain(phrase);
      expect(error.message).not.toContain('취소되었거나 종료');
    } finally {
      stop();
    }
  }
});

test('an unready participant never enters a running group as started', async () => {
  serve(path =>
    path === '/group-runs/61'
      ? respond(200, detail(61, { status: 'RUNNING' }))
      : undefined,
  );
  const onStart = jest.fn();
  const stop = api().groupRuns.watchStart('61', onStart);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onStart).not.toHaveBeenCalled();
    expect(
      sent('GET').some(item => item.path.startsWith('/running-sessions/')),
    ).toBe(false);
  } finally {
    stop();
  }
});

const liveResponse = {
  status: 'RUNNING',
  groupGuidePaceSecPerKm: 375,
  participants: [
    {
      userId: 9,
      rank: 1,
      progressM: 1125,
      stale: false,
      gapToAheadM: null,
      gapToBehindM: 125,
    },
    {
      userId: 101,
      rank: 2,
      progressM: 1000,
      stale: false,
      gapToAheadM: 125,
      gapToBehindM: null,
    },
    {
      userId: 8,
      rank: null,
      progressM: null,
      stale: true,
      gapToAheadM: null,
      gapToBehindM: null,
    },
  ],
};

test('G10 preserves measured ranks, gaps and missing data without inventing GPS or pace', async () => {
  serve(path =>
    path.endsWith('/live') ? respond(200, liveResponse) : undefined,
  );
  const onUpdate = jest.fn();
  const stop = api().groupRuns.watchLive('61', onUpdate);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadM: null,
        inRange: null,
        guidePaceSecPerKm: 375,
        locationsAvailable: false,
        members: expect.arrayContaining([
          expect.objectContaining({
            userId: '9',
            rank: 1,
            gapM: 125,
            paceSecPerKm: null,
          }),
          expect.objectContaining({ userId: '8', stale: true, gapM: null }),
        ]),
      }),
    );
    stop();
    const count = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  } finally {
    stop();
  }
});

test('G10 exposes the whole-group spread only when every participant is current', async () => {
  serve(path =>
    path.endsWith('/live')
      ? respond(200, {
          ...liveResponse,
          participants: liveResponse.participants.filter(item => !item.stale),
        })
      : undefined,
  );
  const onUpdate = jest.fn();
  const stop = api().groupRuns.watchLive('61', onUpdate);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ spreadM: 125 }),
    );
  } finally {
    stop();
  }
});

test('G10 reports a 503, retries later and never substitutes mock data', async () => {
  let fail = true;
  serve(path =>
    path.endsWith('/live')
      ? fail
        ? respond(503, { message: '잠시 후 다시 시도해 주세요' })
        : respond(200, liveResponse)
      : undefined,
  );
  const onUpdate = jest.fn();
  const onError = jest.fn();
  const stop = api().groupRuns.watchLive('61', onUpdate, onError);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    fail = false;
    await jest.advanceTimersByTimeAsync(10100);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test('unsubscribing ignores an in-flight response', async () => {
  let release!: (value: ReturnType<typeof respond>) => void;
  serve();
  const previous = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, init) =>
    String(url).includes('/live')
      ? new Promise(resolve => {
          release = resolve;
        })
      : previous(url, init),
  );
  const onUpdate = jest.fn();
  const stop = api().groupRuns.watchLive('61', onUpdate);
  await jest.advanceTimersByTimeAsync(20);
  stop();
  release(respond(200, liveResponse));
  await jest.advanceTimersByTimeAsync(20);
  expect(onUpdate).not.toHaveBeenCalled();
});

test('G14 maps completed, pending and missing records without synthetic group totals', async () => {
  serve(path =>
    path.endsWith('/results')
      ? respond(200, {
          targetDistanceM: 5000,
          analysis: { status: 'PROCESSING' },
          hasUnconfirmedStarts: true,
          participants: [
            {
              userId: 101,
              state: 'COMPLETED',
              startResult: 'APPLIED',
              actualDistanceM: 5000,
              movingDurationSec: 1800,
              averagePaceSecPerKm: 360,
              goalAchieved: true,
            },
            {
              userId: 9,
              state: 'READY',
              startResult: 'PENDING',
              actualDistanceM: null,
              movingDurationSec: null,
              averagePaceSecPerKm: null,
              goalAchieved: null,
            },
          ],
        })
      : undefined,
  );
  const result = await api().groupRuns.getResult('61');
  expect(result).toMatchObject({
    distanceM: null,
    averagePaceSecPerKm: null,
    maxGapM: null,
    analysisStatus: 'PROCESSING',
    hasUnconfirmedStarts: true,
    // G07 본인 항목에 세션이 없으면 공유할 기록을 짐작하지 않는다.
    mySessionId: null,
    participants: [
      { userId: '101', state: 'FINISHED', isMe: true, durationSec: 1800 },
      {
        userId: '9',
        state: 'UNCONFIRMED',
        distanceM: null,
        durationSec: null,
        goalAchieved: null,
      },
    ],
  });
});

test('G14 result carries my session so sharing opens my own group run record', async () => {
  // 실기기 E2E: 그룹원의 기록 공유가 "최근 기록"을 짐작해 불러오다 실패했다(S15P31E105-420).
  serve(path =>
    path === '/group-runs/61/participants'
      ? respond(200, {
          items: [
            { userId: 9, nickname: '하린', isHost: false, readyStatus: 'READY', sessionId: 31 },
            { userId: 101, nickname: '민준', isHost: true, readyStatus: 'READY', sessionId: 900 },
          ],
          participantCount: 2,
          readyCount: 2,
        })
      : path.endsWith('/results')
      ? respond(200, {
          targetDistanceM: null,
          analysis: { status: 'PENDING' },
          hasUnconfirmedStarts: false,
          participants: [],
        })
      : undefined,
  );
  expect((await api().groupRuns.getResult('61')).mySessionId).toBe('900');
});

test('mock runs stay on the mock', async () => {
  const { groupRuns } = api();
  const run = await groupRuns.get('gr-today');
  expect(run.id).toBe('gr-today');
  await groupRuns.update('gr-today', {
    courseId: null,
    meetingPlaceName: '민락수변공원',
    meetingAddress: '부산 수영구 민락수변로 7',
    meetingPosition: [129.13, 35.157],
    meetingNote: null,
    scheduledAt: run.scheduledAt,
    targetDistanceM: null,
    targetDurationSec: 2400,
  });
  expect((await groupRuns.get('gr-today')).meetingPlaceName).toBe(
    '민락수변공원',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test('419 waiting-room recommendation is separate from the host goal', async () => {
  serve(path =>
    path === '/group-runs/61'
      ? respond(
          200,
          detail(61, { goalPaceSecPerKm: 420, groupGuidePaceSecPerKm: 350 }),
        )
      : undefined,
  );
  const { groupRuns } = api();
  expect(await groupRuns.getWaitingRoom('61')).toMatchObject({
    goalPaceSecPerKm: 420,
    recommendedPaceSecPerKm: 350,
    expectedDurationSec: 2100,
    comfortRange: null,
  });
  expect((await groupRuns.get('61')).goalPaceSecPerKm).toBe(420);
});

test('419 missing recommendation never falls back to the host goal or my usual pace', async () => {
  serve(path =>
    path === '/group-runs/61'
      ? respond(
          200,
          detail(61, { goalPaceSecPerKm: 420, groupGuidePaceSecPerKm: null }),
        )
      : undefined,
  );
  expect(
    (await api().groupRuns.getWaitingRoom('61')).recommendedPaceSecPerKm,
  ).toBeNull();
});

test('419 waiting-room polling refreshes the recommendation when participants change', async () => {
  let pace = 350;
  serve(path =>
    path === '/group-runs/61'
      ? respond(200, detail(61, { groupGuidePaceSecPerKm: pace }))
      : undefined,
  );
  const onParticipants = jest.fn();
  const stop = api().groupRuns.watchStart(
    '61',
    jest.fn(),
    undefined,
    onParticipants,
  );
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(onParticipants).toHaveBeenLastCalledWith(
      expect.any(Array),
      350,
      null,
      { participantCount: 2, readyCount: 1 },
    );
    pace = 370;
    await jest.advanceTimersByTimeAsync(3100);
    expect(onParticipants).toHaveBeenLastCalledWith(
      expect.any(Array),
      370,
      null,
      { participantCount: 2, readyCount: 1 },
    );
  } finally {
    stop();
  }
});

test('서버의 준비도·추천 범위·내 적합도·취소 정보를 연결한다', async () => {
  const cancellation = {
    reason: 'OTHER',
    message: null,
    byNickname: '민준',
    byRole: 'HOST',
  };
  const myFit = { recentPaceSecPerKm: 365, readinessScore: null };
  serve(path => {
    if (path === '/group-runs/61')
      return respond(
        200,
        detail(61, {
          comfortRange: { fastSecPerKm: 340, slowSecPerKm: 390 },
          myFit,
          cancellation,
        }),
      );
    if (path.endsWith('/participants'))
      return respond(200, {
        items: participants(61).items.map(item => ({
          ...item,
          readinessScore: item.userId === 101 ? 0 : null,
        })),
      });
    return undefined;
  });
  const { groupRuns } = api();
  const room = await groupRuns.getWaitingRoom('61');
  expect(room.comfortRange).toEqual([340, 390]);
  expect(room.participants.find(item => item.isMe)?.readinessScore).toBe(0);
  expect(await groupRuns.get('61')).toMatchObject({ myFit, cancellation });
});

test('결과 집계는 서버 값을 사용하고 maxGapM도 그대로 연결한다', async () => {
  serve(path =>
    path.endsWith('/results')
      ? respond(200, {
          targetDistanceM: 5000,
          distanceM: 0,
          averagePaceSecPerKm: 367,
          maxGapM: 799.5,
          analysis: { status: 'READY' },
          hasUnconfirmedStarts: false,
          participants: [],
        })
      : undefined,
  );
  expect(await api().groupRuns.getResult('61')).toMatchObject({
    distanceM: 0,
    averagePaceSecPerKm: 367,
    maxGapM: 799.5,
  });
});

test('진행 현황의 페이스와 감속 권고를 연결하고 오래된 페이스는 숨긴다', async () => {
  const loadAlert = { memberCount: 2, nextPaceSecPerKm: 375 };
  serve(path =>
    path.endsWith('/live')
      ? respond(200, {
          ...liveResponse,
          loadAlert,
          participants: liveResponse.participants.map(item => ({
            ...item,
            paceSecPerKm: 350,
          })),
        })
      : undefined,
  );
  const update = jest.fn();
  const stop = api().groupRuns.watchLive('61', update);
  try {
    await jest.advanceTimersByTimeAsync(20);
    expect(update).toHaveBeenCalled();
    const live = update.mock.calls[0][0];
    expect(live.loadAlert).toEqual(loadAlert);
    for (const member of live.members)
      expect(member.paceSecPerKm).toBe(member.stale ? null : 350);
  } finally {
    stop();
  }
});
