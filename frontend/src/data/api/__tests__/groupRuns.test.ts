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

const participants = (id: number) => ({
  items:
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
      : [{ userId: 7, nickname: '성윤', isHost: true, readyStatus: 'WAITING' }],
});

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
      scheduledAt: '2026-11-07T23:30:00.000Z',
      meetingPosition: { type: 'Point', coordinates: [129.13, 35.157] },
      meetingPlaceName: '민락수변공원',
      meetingAddress: '부산 수영구 민락수변로 7',
    },
  });
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
    comfortRange: [360, 400],
    // 5km of course at 6′20″.
    expectedDurationSec: 1900,
    appliedCount: 2,
  });
});

test('start, live, cancel and results wait for their API on server runs', async () => {
  const { groupRuns } = api();
  const onStart = jest.fn();

  groupRuns.watchStart('61', onStart)();
  groupRuns.watchLive('61', jest.fn())();
  await expect(groupRuns.cancel('61', 'WEATHER')).rejects.toBeTruthy();
  await expect(groupRuns.getResult('61')).rejects.toBeTruthy();
  await expect(groupRuns.forceFinish('61')).rejects.toBeTruthy();

  expect(onStart).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
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
