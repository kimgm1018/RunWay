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
  joinPolicy: 'APPROVAL',
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

test('M01 and M10 missing items stay empty instead of failing the screen', async () => {
  serve(path =>
    path === '/crews' || path === '/users/me/crews'
      ? respond(200, {})
      : undefined,
  );
  await expect(
    api().crews.search({ query: '새벽', nearby: false }),
  ).resolves.toEqual([]);
  await expect(api().listMine()).resolves.toEqual([]);
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

// 바로 가입 (S15P31E105-570): M04 answers APPROVED, so I am a member at once.
test('M04 on a 바로 가입 crew makes me a member at once', async () => {
  serve((path, init) =>
    path === '/crews/45/join-requests' && init.method === 'POST'
      ? respond(200, {
          crewId: 45,
          userId: 101,
          status: 'APPROVED',
          requestedAt: '2026-11-09T01:00:00Z',
        })
      : undefined,
  );
  await expect(api().crews.requestJoin('45')).resolves.toBe('MEMBER');
});

test('a refused join policy change reaches the screen', async () => {
  serve((path, init) =>
    path === '/crews/42' && init.method === 'PATCH'
      ? respond(403, { code: 'NOT_ADMIN', message: '', details: {} })
      : undefined,
  );
  await expect(
    api().crews.setJoinPolicy('42', 'INSTANT'),
  ).rejects.toMatchObject({ code: 'NOT_ADMIN' });
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
        crew({
          id: 50,
          ownerId: 101,
          memberCount: 1,
          capacity: 21,
          joinPolicy: 'INSTANT',
        }),
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
    photo: null,
  });

  expect(id).toBe('50');
  expect(sent('POST')[0].body).toEqual({
    name: '광안리 주말 러너스',
    description: null,
    capacity: 21,
    regionCode: '26500',
    joinPolicy: 'INSTANT',
  });
  // The join policy shown comes back from M02, not from this phone.
  expect((await crews.get('50')).joinPolicy).toBe('INSTANT');
});

// 6.3 대표 사진 (S15P31E105-531): F01 with purpose CREW, then its stored path as M03 imageKey.
const crewPhotoDraft = {
  name: '광안리 주말 러너스',
  area: '광안리해수욕장 입구',
  address: '부산 수영구 광안해변로 219',
  description: null,
  joinPolicy: 'APPROVAL' as const,
  capacity: 20,
  photo: {
    uri: 'file:///photos/crew.png',
    type: 'image/png' as const,
    name: 'crew.png',
  },
};
const imageId = '550e8400-e29b-41d4-a716-446655440000';

const uploads = () =>
  fetchMock.mock.calls.filter(([address]) =>
    new URL(address).pathname.endsWith('/images'),
  );
const crewPosts = () =>
  fetchMock.mock.calls
    .filter(
      ([address, init]) =>
        init.method === 'POST' && new URL(address).pathname.endsWith('/crews'),
    )
    .map(([, init]) => JSON.parse(init.body));

test('M03 sends the photo F01 stored for the crew as imageKey', async () => {
  serve((path, init) => {
    if (path === '/images' && init.method === 'POST') {
      return respond(201, { imageId, url: null });
    }
    if (path === '/crews' && init.method === 'POST') {
      return respond(201, { id: 50, ownerId: 101 });
    }
    return undefined;
  });
  const { crews } = api();

  await expect(crews.create(crewPhotoDraft)).resolves.toEqual({ id: '50' });

  const [[, upload]] = uploads();
  // The test runtime's FormData can be read back; React Native's type has no get().
  const form = upload.body as { get: (name: string) => unknown };
  expect(form.get('purpose')).toBe('CREW');
  expect(crewPosts()).toEqual([
    {
      name: '광안리 주말 러너스',
      description: null,
      capacity: 20,
      regionCode: '26500',
      joinPolicy: 'APPROVAL',
      imageKey: `images/crew/101/${imageId}.png`,
    },
  ]);
});

test('a crew retried after M03 fails keeps the photo it uploaded, and a refused photo reaches the screen', async () => {
  let crewAnswer = respond(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: '',
    details: {},
  });
  let uploadAnswer = respond(201, { imageId, url: null });
  serve((path, init) => {
    if (path === '/images' && init.method === 'POST') {
      return uploadAnswer;
    }
    if (path === '/crews' && init.method === 'POST') {
      return crewAnswer;
    }
    return undefined;
  });
  const { crews } = api();

  await expect(crews.create(crewPhotoDraft)).rejects.toMatchObject({
    code: 'SERVER_ERROR',
  });
  crewAnswer = respond(201, { id: 51, ownerId: 101 });
  await expect(crews.create(crewPhotoDraft)).resolves.toEqual({ id: '51' });
  expect(uploads()).toHaveLength(1);

  // A new photo that F01 turns down stops before M03.
  uploadAnswer = respond(413, {
    code: 'FILE_TOO_LARGE',
    message: '',
    details: {},
  });
  await expect(
    crews.create({
      ...crewPhotoDraft,
      photo: { ...crewPhotoDraft.photo, uri: 'file:///photos/big.png' },
    }),
  ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  expect(crewPosts()).toHaveLength(2);
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

// 6.2m · 6.2a (S15P31E105-570): M12 saves the capacity and the join policy, and a new api (an app restart)
// reads them back from the server.
test('M12 saves the capacity and the join policy on the server', async () => {
  let saved = crew({ id: 42, ownerId: 101, memberCount: 24 });
  serve((path, init) => {
    if (path === '/crews/42' && init.method === 'PATCH') {
      saved = { ...saved, ...JSON.parse(init.body ?? '{}') };
      return respond(200, saved);
    }
    if (path === '/crews/42') return respond(200, saved);
    if (path === '/crews/42/members' || path === '/crews/42/join-requests') {
      return respond(200, { items: [] });
    }
    return undefined;
  });

  await api().crews.updateCapacity('42', 26);
  await api().crews.setJoinPolicy('42', 'INSTANT');

  expect(sent('PATCH')).toEqual([
    { path: '/crews/42', body: { capacity: 26 } },
    { path: '/crews/42', body: { joinPolicy: 'INSTANT' } },
  ]);
  const restarted = await api().crews.get('42');
  expect(restarted.capacity).toBe(26);
  expect(restarted.joinPolicy).toBe('INSTANT');
});

test('a refused M12 change reaches the screen and is not kept on this phone', async () => {
  serve((path, init) =>
    path === '/crews/42' && init.method === 'PATCH'
      ? respond(409, {
          code: 'CREW_CAPACITY_BELOW_MEMBERS',
          message: '정원은 현재 멤버 수보다 작게 정할 수 없습니다.',
        })
      : path === '/crews/42'
      ? respond(200, crew({ id: 42, ownerId: 101, memberCount: 24 }))
      : path === '/crews/42/members' || path === '/crews/42/join-requests'
      ? respond(200, { items: [] })
      : undefined,
  );
  const { crews } = api();

  await expect(crews.updateCapacity('42', 20)).rejects.toMatchObject({
    code: 'CREW_CAPACITY_BELOW_MEMBERS',
  });
  expect((await crews.get('42')).capacity).toBe(30);
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

test('M09는 본문 없이 해당 멤버에게 DELETE 요청을 보낸다', async () => {
  serve((path, init) =>
    path === '/crews/41/members/9' && init.method === 'DELETE'
      ? respond(200, { status: 'LEFT', leftAt: '2026-11-06T00:00:00Z' })
      : undefined,
  );
  await api().crews.removeMember('41', '9');
  expect(sent('DELETE')).toEqual([
    { path: '/crews/41/members/9', body: undefined },
  ]);
});

test.each([
  [403, 'NOT_ADMIN'],
  [409, 'CANNOT_REMOVE_OWNER'],
  [404, 'MEMBER_NOT_FOUND'],
] as const)('M09 %s 오류 코드를 화면에 전달한다', async (status, code) => {
  serve(() => respond(status, { code, message: '', details: {} }));
  await expect(api().crews.removeMember('41', '9')).rejects.toMatchObject({
    code,
    status,
  });
});

test('목업도 크루장만 내보낼 수 있고 재조회 후 구성원과 인원이 유지된다', async () => {
  const { crews } = createMockRepositories({ latencyMs: 0 });
  const ownerCrew = await crews.get('crew-minrak-night');
  const target = ownerCrew.members.find(
    member => !member.isOwner && !member.isMe,
  )!;
  await crews.removeMember(ownerCrew.id, target.userId);
  const after = await crews.get(ownerCrew.id);
  expect(after.memberCount).toBe(ownerCrew.memberCount - 1);
  expect(after.members).toHaveLength(ownerCrew.members.length - 1);
  expect(after.members.some(member => member.userId === target.userId)).toBe(
    false,
  );
  await expect(
    crews.removeMember(ownerCrew.id, target.userId),
  ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  await expect(
    crews.removeMember(ownerCrew.id, after.members[0].userId),
  ).rejects.toMatchObject({ code: 'CANNOT_REMOVE_OWNER' });
  const regularCrew = await crews.get('crew-gwangalli');
  await expect(
    crews.removeMember(regularCrew.id, regularCrew.members[1].userId),
  ).rejects.toMatchObject({ code: 'NOT_ADMIN' });
});

test('M08 크루장 이양 탈퇴는 선택한 후임 ID만 본문에 보낸다', async () => {
  serve((path, init) =>
    path === '/crews/41/members/me' && init.method === 'DELETE'
      ? respond(200, { status: 'LEFT' })
      : undefined,
  );
  await api().crews.leave('41', '9');
  expect(sent('DELETE')).toEqual([
    { path: '/crews/41/members/me', body: { successorUserId: 9 } },
  ]);
});

test('M11 해산은 본문 없이 크루 DELETE를 호출한다', async () => {
  serve((path, init) =>
    path === '/crews/41' && init.method === 'DELETE'
      ? respond(200, { id: 41, status: 'INACTIVE' })
      : undefined,
  );
  await api().crews.dissolve('41');
  expect(sent('DELETE')).toEqual([{ path: '/crews/41', body: undefined }]);
});

test('M08 후임 부적합 코드를 전달한다', async () => {
  serve(() =>
    respond(422, { code: 'INVALID_SUCCESSOR', message: '', details: {} }),
  );
  await expect(api().crews.leave('41', '9')).rejects.toMatchObject({
    code: 'INVALID_SUCCESSOR',
    status: 422,
  });
});

test('목업 이양 탈퇴는 후임만 크루장으로 바꾸고 본인만 목록에서 제외한다', async () => {
  const { crews } = createMockRepositories({ latencyMs: 0 });
  const before = await crews.get('crew-minrak-night');
  const successor = before.members.find(member => !member.isMe)!;
  await expect(crews.leave(before.id, 'missing')).rejects.toMatchObject({
    code: 'INVALID_SUCCESSOR',
  });
  expect((await crews.get(before.id)).memberCount).toBe(before.memberCount);
  await crews.leave(before.id, successor.userId);
  const after = await crews.get(before.id);
  expect(after.myMembership).toBeNull();
  expect(after.amOwner).toBe(false);
  expect(after.memberCount).toBe(before.memberCount - 1);
  expect(after.members.some(member => member.isMe)).toBe(false);
  expect(
    after.members.filter(member => member.isOwner).map(member => member.userId),
  ).toEqual([successor.userId]);
});

test('목업 해산은 비소유자를 거부하고 소유자 해산 후 검색에서 제외한다', async () => {
  const { crews } = createMockRepositories({ latencyMs: 0 });
  await expect(crews.dissolve('crew-gwangalli')).rejects.toMatchObject({
    code: 'NOT_ADMIN',
  });
  const { id } = await crews.create({
    name: '혼자 크루',
    description: null,
    area: '부산',
    address: '부산',
    capacity: 20,
    joinPolicy: 'APPROVAL',
    photo: null,
  });
  await expect(crews.leave(id)).rejects.toMatchObject({
    code: 'OWNER_CANNOT_LEAVE',
  });
  await crews.dissolve(id);
  await crews.dissolve(id);
  expect(
    (await crews.search({ query: '', nearby: false })).some(
      item => item.id === id,
    ),
  ).toBe(false);
  await expect(async () => crews.get(id)).rejects.toMatchObject({
    code: 'CREW_NOT_FOUND',
  });
});
