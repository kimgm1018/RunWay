import { createMockRepositories } from '../../mock/createMockRepositories';
import { createCrewsApi } from '../crews';
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

const regions = {
  items: [
    { regionCode: '26350', sidoName: '부산광역시', sigunguName: '해운대구' },
    { regionCode: '26500', sidoName: '부산광역시', sigunguName: '수영구' },
    { regionCode: '11140', sidoName: '서울특별시', sigunguName: '중구' },
    { regionCode: '26110', sidoName: '부산광역시', sigunguName: '중구' },
  ],
  currentRegionCode: null,
};

const crew = (fields: Record<string, unknown> = {}) => ({
  id: 41,
  name: '광안리 새벽 크루',
  description: '주말 새벽 5km',
  ownerId: 7,
  capacity: 30,
  status: 'ACTIVE',
  regionCode: '26500',
  memberCount: 3,
  myMembershipStatus: 'APPROVED',
  ...fields,
});

type Route = (
  path: string,
  init: { method: string; body?: string },
  url: URL,
) => ReturnType<typeof respond> | undefined;

// U04 says I am user 101; CMT12 names the regions; `route` answers the rest.
function serve(route: Route) {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/users/me') {
        return respond(200, { id: 101, nickname: '민준', loginId: 'minjun01' });
      }
      if (path === '/regions') {
        return respond(200, regions);
      }
      const answer = route(path, init, url);
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

const api = () =>
  createCrewsApi({
    mock: createMockRepositories({ latencyMs: 0 }).crews,
    regions: createRegions(),
  });

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('M01 searches by name and maps membership and region', async () => {
  serve((path, _init, url) =>
    path === '/crews' && url.searchParams.get('q') === '광안리'
      ? respond(200, {
          items: [
            crew(),
            crew({ id: 42, myMembershipStatus: 'PENDING', regionCode: null }),
            crew({ id: 43, myMembershipStatus: 'REJECTED' }),
          ],
        })
      : undefined,
  );

  const found = await api().crews.search({ query: ' 광안리 ', nearby: true });

  expect(found[0]).toEqual({
    id: '41',
    name: '광안리 새벽 크루',
    description: '주말 새벽 5km',
    area: '부산 수영구',
    capacity: 30,
    memberCount: 3,
    myMembership: 'MEMBER',
  });
  expect(found.map(item => [item.area, item.myMembership])).toEqual([
    ['부산 수영구', 'MEMBER'],
    ['지역 미정', 'PENDING'],
    ['부산 수영구', null],
  ]);
});

test('M01 with no words asks for every crew', async () => {
  serve((path, _init, url) =>
    path === '/crews' && !url.searchParams.has('q')
      ? respond(200, { items: [] })
      : undefined,
  );
  await expect(
    api().crews.search({ query: '  ', nearby: false }),
  ).resolves.toEqual([]);
});

test('M02 with M07 marks me, puts the leader first and counts requests for the leader', async () => {
  serve(path => {
    if (path === '/crews/42') {
      return respond(200, crew({ id: 42, ownerId: 101, memberCount: 2 }));
    }
    if (path === '/crews/42/members') {
      return respond(200, {
        items: [
          { userId: 9, status: 'APPROVED', nickname: '하린', isOwner: false },
          { userId: 101, status: 'APPROVED', nickname: '민준', isOwner: true },
          { userId: 12, status: 'APPROVED', nickname: null, isOwner: false },
        ],
      });
    }
    if (path === '/crews/42/join-requests') {
      return respond(200, {
        items: [
          {
            userId: 15,
            status: 'PENDING',
            requestedAt: '2026-11-02T01:00:00Z',
            joinedAt: null,
            nickname: '서윤',
          },
        ],
      });
    }
    return undefined;
  });

  const detail = await api().crews.get('42');

  expect(detail).toMatchObject({
    id: '42',
    amOwner: true,
    joinPolicy: 'APPROVAL',
    pendingRequestCount: 1,
  });
  expect(detail.members).toEqual([
    {
      userId: '101',
      nickname: '민준',
      isOwner: true,
      isMe: true,
      recentPaceSecPerKm: null,
    },
    {
      userId: '9',
      nickname: '하린',
      isOwner: false,
      isMe: false,
      recentPaceSecPerKm: null,
    },
    {
      userId: '12',
      nickname: '알 수 없음',
      isOwner: false,
      isMe: false,
      recentPaceSecPerKm: null,
    },
  ]);
});

test('M02 for a member who does not lead skips the request count', async () => {
  serve(path =>
    path === '/crews/41'
      ? respond(200, crew())
      : path === '/crews/41/members'
      ? respond(200, { items: [] })
      : undefined,
  );

  const detail = await api().crews.get('41');

  expect(detail.amOwner).toBe(false);
  expect(detail.pendingRequestCount).toBeNull();
  expect(sent('GET').map(call => call.path)).not.toContain(
    '/crews/41/join-requests',
  );
});

test('M04 sends a join request and reads its state', async () => {
  serve((path, init) =>
    path === '/crews/44/join-requests' && init.method === 'POST'
      ? respond(200, {
          crewId: 44,
          userId: 101,
          status: 'PENDING',
          requestedAt: '2026-11-02T01:00:00Z',
        })
      : undefined,
  );
  await expect(api().crews.requestJoin('44')).resolves.toBe('PENDING');
});

test('M04 on a full crew passes CREW_CAPACITY_EXCEEDED on', async () => {
  serve(() =>
    respond(409, { code: 'CREW_CAPACITY_EXCEEDED', message: '', details: {} }),
  );
  await expect(api().crews.requestJoin('43')).rejects.toMatchObject({
    code: 'CREW_CAPACITY_EXCEEDED',
  });
});

test('M05 requests keep only the nickname and the time', async () => {
  serve(path =>
    path === '/crews/42/join-requests'
      ? respond(200, {
          items: [
            {
              userId: 15,
              status: 'PENDING',
              requestedAt: '2026-11-02T01:00:00Z',
              joinedAt: null,
              nickname: '서윤',
            },
          ],
        })
      : undefined,
  );

  await expect(api().crews.listJoinRequests('42')).resolves.toEqual([
    {
      userId: '15',
      nickname: '서윤',
      loginId: null,
      level: null,
      recent5kPaceSecPerKm: null,
      firstCrew: false,
      requestedAt: '2026-11-02T01:00:00Z',
    },
  ]);
});

test('M06 approves or rejects with the status word', async () => {
  serve((path, init) =>
    path === '/crews/42/join-requests/15' && init.method === 'PATCH'
      ? respond(200, { crewId: 42, userId: 15, status: 'APPROVED' })
      : undefined,
  );
  const { crews } = api();

  await crews.decideJoinRequest('42', '15', true);
  await crews.decideJoinRequest('42', '15', false);

  expect(sent('PATCH').map(call => call.body)).toEqual([
    { status: 'APPROVED' },
    { status: 'REJECTED' },
  ]);
});

test('M03 sends the region of the picked place and keeps the join policy here', async () => {
  serve((path, init) => {
    if (path === '/crews' && init.method === 'POST') {
      return respond(201, {
        id: 50,
        ownerId: 101,
        name: '광안리 주말 러너스',
        createdAt: '2026-11-02T01:00:00Z',
      });
    }
    if (path === '/crews/50') {
      return respond(
        200,
        crew({ id: 50, ownerId: 101, memberCount: 1, capacity: 21 }),
      );
    }
    if (path === '/crews/50/members' || path === '/crews/50/join-requests') {
      return respond(200, { items: [] });
    }
    return undefined;
  });
  const { crews } = api();

  const { id } = await crews.create({
    name: '광안리 주말 러너스',
    area: '광안리해수욕장 입구',
    address: '부산 수영구 광안해변로 219',
    description: null,
    joinPolicy: 'INSTANT',
    capacity: 21,
  });

  expect(id).toBe('50');
  expect(sent('POST')[0].body).toEqual({
    name: '광안리 주말 러너스',
    description: null,
    capacity: 21,
    regionCode: '26500',
  });
  expect((await crews.get('50')).joinPolicy).toBe('INSTANT');
});

test('a place in an unknown or ambiguous region is sent without a region', async () => {
  const codeOf = createRegions().codeOf;
  serve(() => undefined);
  // 중구 is in both 서울 and 부산; the short sido decides it.
  await expect(codeOf('부산 중구 중앙대로 1')).resolves.toBe('26110');
  await expect(codeOf('중구 어딘가')).resolves.toBeNull();
  await expect(codeOf('제주 애월읍')).resolves.toBeNull();
  await expect(codeOf(null)).resolves.toBeNull();
});

test('the capacity edit stays on this phone and checks the member count', async () => {
  serve(path =>
    path === '/crews/42'
      ? respond(200, crew({ id: 42, ownerId: 101, memberCount: 24 }))
      : path === '/crews/42/members' || path === '/crews/42/join-requests'
      ? respond(200, { items: [] })
      : undefined,
  );
  const { crews } = api();

  await expect(crews.updateCapacity('42', 20)).rejects.toBeTruthy();
  await crews.updateCapacity('42', 26);

  expect((await crews.get('42')).capacity).toBe(26);
  expect(sent('PATCH')).toEqual([]);
});

test('M08 leaves a crew', async () => {
  serve((path, init) =>
    path === '/crews/41/members/me' && init.method === 'DELETE'
      ? respond(200, { status: 'LEFT', leftAt: '2026-11-02T01:00:00Z' })
      : undefined,
  );
  await api().crews.leave('41');
  expect(sent('DELETE').map(call => call.path)).toEqual([
    '/crews/41/members/me',
  ]);
});

test('M10 lists my crews with members before waiting requests', async () => {
  serve(path =>
    path === '/users/me/crews'
      ? respond(200, {
          items: [
            {
              id: 44,
              name: '수영강 아침 크루',
              regionCode: null,
              myMembershipStatus: 'PENDING',
              memberCount: 5,
              isOwner: false,
            },
            {
              id: 41,
              name: '광안리 새벽 크루',
              regionCode: '26500',
              myMembershipStatus: 'APPROVED',
              memberCount: 3,
              isOwner: false,
            },
          ],
        })
      : undefined,
  );

  await expect(api().listMine()).resolves.toEqual([
    {
      id: '41',
      name: '광안리 새벽 크루',
      area: '부산 수영구',
      memberCount: 3,
      membership: 'MEMBER',
    },
    {
      id: '44',
      name: '수영강 아침 크루',
      area: '지역 미정',
      memberCount: 5,
      membership: 'PENDING',
    },
  ]);
});

test('mock crews from mock group runs stay on the mock', async () => {
  const { crews } = api();
  const detail = await crews.get('crew-gwangalli');
  expect(detail.name).toBe('광안리 새벽 크루');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the mock lets a member leave but not the leader', async () => {
  const { crews } = createMockRepositories({ latencyMs: 0 });
  await crews.leave('crew-gwangalli');
  expect((await crews.get('crew-gwangalli')).myMembership).toBeNull();
  await expect(crews.leave('crew-minrak-night')).rejects.toMatchObject({
    code: 'OWNER_CANNOT_LEAVE',
  });
});
