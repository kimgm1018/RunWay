import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 6.0 내 크루, 6.1 크루 모집, 6.2 크루 상세·나가기, 6.2a 가입 신청, 6.3 크루 만들기 against the server (dataSource 'api').

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

const meId = 101;

type ServerCrew = {
  id: number;
  name: string;
  ownerId: number;
  capacity: number;
  regionCode: string | null;
  members: { userId: number; nickname: string }[];
  pending: { userId: number; nickname: string }[];
};

// The server's crews; requests and leaving change them.
let crews: ServerCrew[];
let created: unknown[];

const statusOf = (crew: ServerCrew) =>
  crew.members.some(member => member.userId === meId)
    ? 'APPROVED'
    : crew.pending.some(member => member.userId === meId)
    ? 'PENDING'
    : null;

const summary = (crew: ServerCrew) => ({
  id: crew.id,
  name: crew.name,
  description: null,
  ownerId: crew.ownerId,
  capacity: crew.capacity,
  status: 'ACTIVE',
  regionCode: crew.regionCode,
  memberCount: crew.members.length,
  myMembershipStatus: statusOf(crew),
});

function people(count: number, from: number) {
  return Array.from({ length: count }, (_, index) => ({
    userId: from + index,
    nickname: `러너${index + 1}`,
  }));
}

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      const find = (id: string) => crews.find(crew => crew.id === Number(id))!;
      if (path === '/users/me') {
        return respond(200, {
          id: meId,
          nickname: '민준',
          loginId: 'minjun01',
        });
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
      if (path === '/users/me/crews') {
        return respond(200, {
          items: crews
            .filter(crew => statusOf(crew))
            .map(crew => ({
              id: crew.id,
              name: crew.name,
              regionCode: crew.regionCode,
              myMembershipStatus: statusOf(crew),
              memberCount: crew.members.length,
              isOwner: crew.ownerId === meId,
            })),
        });
      }
      if (path === '/crews' && init.method === 'POST') {
        const body = JSON.parse(init.body!);
        created.push(body);
        crews.push({
          id: 50,
          name: body.name,
          ownerId: meId,
          capacity: body.capacity,
          regionCode: body.regionCode ?? null,
          members: [{ userId: meId, nickname: '민준' }],
          pending: [],
        });
        return respond(201, {
          id: 50,
          ownerId: meId,
          name: body.name,
          createdAt: '2026-11-02T01:00:00Z',
        });
      }
      if (path === '/crews') {
        return respond(200, { items: crews.map(summary) });
      }
      let match = path.match(/^\/crews\/(\d+)$/);
      if (match) {
        return respond(200, summary(find(match[1])));
      }
      match = path.match(/^\/crews\/(\d+)\/members$/);
      if (match) {
        const crew = find(match[1]);
        return respond(200, {
          items: crew.members.map(member => ({
            ...member,
            status: 'APPROVED',
            joinedAt: '2026-10-01T00:00:00Z',
            isOwner: member.userId === crew.ownerId,
          })),
        });
      }
      match = path.match(/^\/crews\/(\d+)\/members\/me$/);
      if (match && init.method === 'DELETE') {
        const crew = find(match[1]);
        crew.members = crew.members.filter(member => member.userId !== meId);
        return respond(200, { status: 'LEFT', leftAt: '2026-11-02T01:00:00Z' });
      }
      match = path.match(/^\/crews\/(\d+)\/join-requests$/);
      if (match && init.method === 'POST') {
        const crew = find(match[1]);
        if (crew.members.length >= crew.capacity) {
          return respond(409, {
            code: 'CREW_CAPACITY_EXCEEDED',
            message: '',
            details: {},
          });
        }
        crew.pending.push({ userId: meId, nickname: '민준' });
        return respond(200, {
          crewId: crew.id,
          userId: meId,
          status: 'PENDING',
          requestedAt: '2026-11-02T01:00:00Z',
        });
      }
      if (match) {
        return respond(200, {
          items: find(match[1]).pending.map(member => ({
            ...member,
            status: 'PENDING',
            requestedAt: '2026-11-02T02:00:00Z',
            joinedAt: null,
          })),
        });
      }
      match = path.match(/^\/crews\/(\d+)\/join-requests\/(\d+)$/);
      if (match && init.method === 'PATCH') {
        const crew = find(match[1]);
        const person = crew.pending.find(
          item => item.userId === Number(match![2]),
        )!;
        crew.pending = crew.pending.filter(item => item !== person);
        if (JSON.parse(init.body!).status === 'APPROVED') {
          crew.members.push(person);
        }
        return respond(200, {
          crewId: crew.id,
          userId: person.userId,
          status: 'APPROVED',
        });
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
function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

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

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
  await settle();
}

async function openGroup() {
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
  await press(screen!, '그룹');
  await settle();
  return screen!;
}

beforeEach(async () => {
  crews = [
    {
      id: 41,
      name: '광안리 새벽 크루',
      ownerId: 7,
      capacity: 30,
      regionCode: '26500',
      members: [
        { userId: 7, nickname: '성윤' },
        { userId: meId, nickname: '민준' },
        { userId: 9, nickname: '하린' },
      ],
      pending: [],
    },
    {
      id: 42,
      name: '민락 야경 러너스',
      ownerId: meId,
      capacity: 30,
      regionCode: '26500',
      members: [
        { userId: meId, nickname: '민준' },
        { userId: 12, nickname: '도윤' },
      ],
      pending: [{ userId: 15, nickname: '서윤' }],
    },
    {
      id: 43,
      name: '해운대 하프 크루',
      ownerId: 8,
      capacity: 3,
      regionCode: null,
      members: people(3, 200),
      pending: [],
    },
    {
      id: 44,
      name: '수영강 아침 크루',
      ownerId: 8,
      capacity: 20,
      regionCode: null,
      members: people(5, 300),
      pending: [],
    },
  ];
  created = [];
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  serve();
});

test('6.0 lists my crews from M10', async () => {
  const screen = await openGroup();
  const page = texts(screen);
  expect(page).toContain('광안리 새벽 크루');
  expect(page).toContain('민락 야경 러너스');
  expect(page).not.toContain('수영강 아침 크루');
  await act(async () => screen.unmount());
});

test('6.1 → 6.2 sends a join request, and a full crew shows the full sheet', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  expect(texts(screen)).toContain('부산 수영구');

  await press(screen, '수영강 아침 크루, 모집 중 5/20명');
  await press(screen, '가입 신청');
  expect(sent('POST')).toEqual(['/crews/44/join-requests']);
  expect(texts(screen)).toContain('가입 신청을 보냈어요');
  await press(screen, '내 크루로');
  expect(texts(screen)).toContain('수영강 아침 크루');

  await press(screen, '크루 모집');
  await press(screen, '해운대 하프 크루, 정원 마감 3/3명');
  await press(screen, '가입 신청 · 정원 마감');
  expect(texts(screen)).toContain('정원이 가득 찼어요');
  await act(async () => screen.unmount());
});

test('6.2 lets a member leave with M08', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '광안리 새벽 크루, 모집 중 3/30명');
  expect(texts(screen)).toContain('민준 (나)');

  await press(screen, '크루 나가기');
  expect(texts(screen)).toContain('크루에서 나갈까요?');
  await press(screen, '나가기');
  await settle(50);

  expect(sent('DELETE')).toEqual(['/crews/41/members/me']);
  expect(texts(screen)).toContain('‘광안리 새벽 크루’에서 나왔어요');
  await act(async () => screen.unmount());
});

test('6.2 leader approves a request on 6.2a and is asked to stay', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '민락 야경 러너스, 모집 중 2/30명');
  expect(texts(screen)).toContain('가입 신청 1건');

  await press(screen, '가입 신청 1건');
  // M05 shares only the nickname.
  expect(texts(screen)).toContain('서윤');
  expect(texts(screen)).not.toContain('서윤 ·');
  await press(screen, '서윤 승인');
  await settle(50);
  expect(sent('PATCH')).toEqual(['/crews/42/join-requests/15']);
  expect(texts(screen)).toContain('서윤님이 크루 멤버가 됐어요');

  await press(screen, '뒤로');
  await settle(50);
  await press(screen, '크루 나가기');
  expect(texts(screen)).toContain('크루장은 바로 나갈 수 없어요');
  expect(sent('DELETE')).toEqual([]);
  await act(async () => screen.unmount());
});

test('6.3 creates a crew in the picked place’s region', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '크루 만들기');
  await type(screen, '크루 이름', '광안리 주말 러너스');
  await type(screen, '지역 검색', '광안리');
  await press(screen, '광안리해수욕장 입구');
  await press(screen, '크루 만들기');
  await settle(100);

  expect(created).toEqual([
    {
      name: '광안리 주말 러너스',
      description: null,
      capacity: 20,
      regionCode: '26500',
    },
  ]);
  expect(texts(screen)).toContain('광안리 주말 러너스');
  await act(async () => screen.unmount());
});
