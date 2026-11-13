import React from 'react';
import { Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import { MyCrewsPage } from '../src/screens/group/GroupScreen';
import { CrewRecruitPage } from '../src/screens/group/CrewRecruitScreen';

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
  // M01·M02 joinPolicy (S15P31E105-570); APPROVAL when a seed leaves it out.
  joinPolicy?: 'APPROVAL' | 'INSTANT';
  members: Person[];
  pending: Person[];
  // F02 path of the crew photo (M01·M02·M10 imageUrl, S15P31E105-636).
  imageUrl?: string;
};

// profileImageUrl: M05·M07 photo path (S15P31E105-636).
type Person = { userId: number; nickname: string; profileImageUrl?: string };

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
  joinPolicy: crew.joinPolicy ?? 'APPROVAL',
  memberCount: crew.members.length,
  myMembershipStatus: statusOf(crew),
  imageUrl: crew.imageUrl ?? null,
});

function people(count: number, from: number) {
  return Array.from({ length: count }, (_, index) => ({
    userId: from + index,
    nickname: `러너${index + 1}`,
  }));
}

const crewImageId = '550e8400-e29b-41d4-a716-446655440000';

// What the phone's photo picker answers next (react-native-image-picker is mocked in jest.setup.js).
function pickNext(asset: Record<string, unknown>) {
  (
    require('react-native-image-picker').launchImageLibrary as jest.Mock
  ).mockResolvedValueOnce({ assets: [asset] });
}

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/places/search') {
        return respond(200, {
          items: [
            {
              name: '광안리해수욕장 입구',
              address: '부산광역시 수영구 광안해변로',
              position: [129.118, 35.153],
              distanceM: null,
            },
          ],
        });
      }
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
      // 6.0 also lists each crew's group runs (G02); none are planned here.
      if (path === '/group-runs') {
        return respond(200, { items: [] });
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
              imageUrl: crew.imageUrl ?? null,
            })),
        });
      }
      // F01 for 6.3 대표 사진 (S15P31E105-531).
      if (path === '/images' && init.method === 'POST') {
        return respond(201, { imageId: crewImageId, url: null });
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
          joinPolicy: body.joinPolicy ?? 'APPROVAL',
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
      if (match && init.method === 'DELETE') {
        crews = crews.filter(crew => crew.id !== Number(match![1]));
        return respond(200, { id: Number(match[1]), status: 'INACTIVE' });
      }
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
        if (init.body) crew.ownerId = JSON.parse(init.body).successorUserId;
        crew.members = crew.members.filter(member => member.userId !== meId);
        return respond(200, { status: 'LEFT', leftAt: '2026-11-02T01:00:00Z' });
      }
      match = path.match(/^\/crews\/(\d+)\/members\/(\d+)$/);
      if (match && init.method === 'DELETE') {
        const crew = find(match[1]);
        crew.members = crew.members.filter(
          member => member.userId !== Number(match![2]),
        );
        return respond(200, { status: 'LEFT', leftAt: '2026-11-06T00:00:00Z' });
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

// A Text's whole line, nested Texts included (NumText draws the digits in their own Text, S15P31E105-594).
function lineOf(children: unknown): string {
  return [children]
    .flat(Infinity as 1)
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : child && typeof child === 'object' && 'props' in child
        ? lineOf((child as { props: { children?: unknown } }).props.children)
        : '',
    )
    .join('');
}

function texts(screen: Screen) {
  const nodes = screen.root.findAllByType(Text);
  return [
    ...nodes
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string' || typeof child === 'number'),
    // Lines split into nested Texts, read whole too.
    ...nodes
      .filter(node =>
        [node.props.children]
          .flat()
          .some(child => child && typeof child === 'object'),
      )
      .map(node => lineOf(node.props.children)),
  ].join(' ');
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
  // 크루 모집 sits beside it in the same pager and lists every crew, so read the 내 크루 page only.
  const page = screen.root
    .findByType(MyCrewsPage)
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');
  expect(page).toContain('광안리 새벽 크루');
  expect(page).toContain('민락 야경 러너스');
  expect(page).not.toContain('수영강 아침 크루');
  await act(async () => screen.unmount());
});

// S15P31E105-636: crew photos on 6.0·6.1·6.2, member photos on 6.2·6.2a, the first letter without one.
test('crew and member photos show, and a broken photo falls back to the letter', async () => {
  const photo = (id: string) => `/api/v1/images/${id}`;
  const memberImageId = '11111111-1111-4111-8111-111111111111';
  const applicantImageId = '22222222-2222-4222-8222-222222222222';
  crews[1].imageUrl = photo(crewImageId);
  crews[1].members[1].profileImageUrl = photo(memberImageId);
  crews[1].pending[0].profileImageUrl = photo(applicantImageId);
  const photos = (screen: Screen) =>
    screen.root
      .findAllByType(Image)
      .map(node => (node.props.source as { uri?: string })?.uri ?? '');
  const shows = (screen: Screen, id: string) =>
    photos(screen).filter(
      uri => /^https?:\/\//.test(uri) && uri.endsWith(photo(id)),
    );
  const letter = (screen: Screen, text: string) =>
    screen.root.findAllByType(Text).some(node => node.props.children === text);

  const screen = await openGroup();
  const crewPhotos = (view: Screen) =>
    view.root.findAll(
      node => node.type === Image && node.props.testID === 'crew-photo',
    );
  // 6.0 내 크루: only the crew with a photo shows one.
  expect(shows(screen, crewImageId).length).toBeGreaterThan(0);
  await press(screen, '크루 모집');
  // 6.1: the card of the crew with a photo; the other crews draw none.
  expect(
    crewPhotos(screen).filter(node =>
      node.props.source?.uri?.endsWith(photo(crewImageId)),
    ).length,
  ).toBeGreaterThan(0);
  await press(screen, '민락 야경 러너스, 모집 중 2/30명');
  // 6.2 head: the crew photo by the name; when it fails, nothing is drawn in its place.
  const hero = crewPhotos(screen).filter(node =>
    node.props.source?.uri?.endsWith(photo(crewImageId)),
  );
  expect(hero.length).toBeGreaterThan(0);
  await act(async () => hero[hero.length - 1].props.onError());
  expect(
    crewPhotos(screen).filter(node =>
      node.props.source?.uri?.endsWith(photo(crewImageId)),
    ).length,
  ).toBeLessThan(hero.length);
  // 6.2: the crew photo by the name and 도윤's photo; 민준 has none, so the letter stays.
  expect(shows(screen, memberImageId)).toHaveLength(1);
  expect(letter(screen, '민')).toBe(true);
  expect(letter(screen, '도')).toBe(false);
  const memberPhoto = screen.root
    .findAllByType(Image)
    .find(node => node.props.source?.uri?.endsWith(photo(memberImageId)))!;
  await act(async () => memberPhoto.props.onError());
  expect(shows(screen, memberImageId)).toHaveLength(0);
  expect(letter(screen, '도')).toBe(true);

  // The leader's 6.2 lists the waiting request with its photo (S15P31E105-678); 6.2a opens on top of it, so
  // the applicant's photo is drawn once there and once more by the 6.2 underneath.
  expect(shows(screen, applicantImageId)).toHaveLength(1);
  await press(screen, '가입 신청 1건');
  expect(shows(screen, applicantImageId)).toHaveLength(2);
  await act(async () => screen.unmount());
});

test('6.1 → 6.2 sends a join request, and a full crew shows the full sheet', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');

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

// S15P31E105-774: the recruit page and my crews both load again after a dissolve, so the crew is gone from both.
test('a dissolved crew drops out of 크루 모집 and 내 크루 without leaving the tab', async () => {
  const screen = await openGroup();
  const pageText = (page: typeof CrewRecruitPage | typeof MyCrewsPage) =>
    screen.root
      .findByType(page)
      .findAllByType(Text)
      .flatMap(node => [node.props.children].flat())
      .filter(child => typeof child === 'string')
      .join(' ');
  try {
    await press(screen, '크루 모집');
    expect(pageText(CrewRecruitPage)).toContain('민락 야경 러너스');
    expect(pageText(MyCrewsPage)).toContain('민락 야경 러너스');
    await press(screen, '민락 야경 러너스, 모집 중 2/30명');
    await press(screen, '크루 해산');
    await press(screen, '해산');
    expect(sent('DELETE')).toEqual(['/crews/42']);
    await settle(100);
    expect(pageText(MyCrewsPage)).not.toContain('민락 야경 러너스');
    await press(screen, '크루 모집');
    expect(pageText(CrewRecruitPage)).not.toContain('민락 야경 러너스');
    expect(pageText(CrewRecruitPage)).toContain('광안리 새벽 크루');
  } finally {
    await act(async () => screen.unmount());
  }
});

// S15P31E105-774: M04 answers 404 CREW_NOT_FOUND for a crew dissolved after its page opened.
test('a join request to a dissolved crew says it is already dissolved', async () => {
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '수영강 아침 크루, 모집 중 5/20명');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((address, init) => {
      if (
        init.method === 'POST' &&
        address.endsWith('/crews/44/join-requests')
      ) {
        crews = crews.filter(crew => crew.id !== 44);
        return Promise.resolve(
          respond(404, { code: 'CREW_NOT_FOUND', message: '', details: {} }),
        );
      }
      return original(address, init);
    });
    await press(screen, '가입 신청');
    await settle(100);
    const page = texts(screen);
    expect(page).toContain('이미 해산된 크루입니다');
    expect(page).not.toContain('가입 신청을 보내지 못했어요');
    expect(
      screen.root
        .findByType(CrewRecruitPage)
        .findAll(
          node =>
            node.props.accessibilityLabel ===
            '수영강 아침 크루, 모집 중 5/20명',
        ),
    ).toHaveLength(0);
  } finally {
    await act(async () => screen.unmount());
  }
});

test('6.2 lets a member leave with M08', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '광안리 새벽 크루, 모집 중 3/30명');
  // The area from the regions lookup shows on 6.2 (6.0 and 6.1 list names only).
  expect(texts(screen)).toContain('부산 수영구');
  expect(texts(screen)).toContain('민준 (나)');

  await press(screen, '크루 나가기');
  expect(texts(screen)).toContain('크루에서 나갈까요?');
  await press(screen, '나가기');
  await settle(50);

  expect(sent('DELETE')).toEqual(['/crews/41/members/me']);
  expect(texts(screen)).toContain('‘광안리 새벽 크루’에서 나왔어요');
  await act(async () => screen.unmount());
});

test('6.2 leader approves a request and can choose a successor', async () => {
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
  expect(texts(screen)).toContain('크루장을 넘기고 나갈까요?');
  expect(sent('DELETE')).toEqual([]);
  await act(async () => screen.unmount());
});

test('6.3 creates a crew in the picked place’s region', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '크루 만들기');
  await type(screen, '크루 이름', '광안리 주말 러너스');
  await type(screen, '지역 검색', '광안리');
  await settle(350);
  await press(screen, '광안리해수욕장 입구');
  await press(screen, '크루 만들기');
  await settle(100);

  expect(created).toEqual([
    {
      name: '광안리 주말 러너스',
      description: null,
      capacity: 20,
      regionCode: '26500',
      joinPolicy: 'APPROVAL',
    },
  ]);
  expect(texts(screen)).toContain('광안리 주말 러너스');
  await act(async () => screen.unmount());
});

test('6.3 picks a 대표 사진, takes it out or changes it, and sends it with the crew', async () => {
  const screen = await openGroup();
  await press(screen, '크루 모집');
  await press(screen, '크루 만들기');

  // A photo F01 would turn down is not taken.
  pickNext({ uri: 'file:///cache/run.gif', type: 'image/gif', fileSize: 1000 });
  await press(screen, '대표 사진 추가');
  expect(texts(screen)).toContain('JPG나 PNG 사진만 쓸 수 있어요');

  // S15P31E105-796: a 6MB photo is told at once too, and a picker error is not read as 취소.
  pickNext({
    uri: 'file:///cache/big.jpg',
    type: 'image/jpeg',
    fileSize: 6 * 1024 * 1024,
  });
  await press(screen, '대표 사진 추가');
  expect(texts(screen)).toContain('5MB 이하의 사진을 골라 주세요');
  (
    require('react-native-image-picker').launchImageLibrary as jest.Mock
  ).mockResolvedValueOnce({ errorCode: 'others' });
  await press(screen, '대표 사진 추가');
  expect(texts(screen)).toContain('사진을 불러오지 못했어요');

  pickNext({
    uri: 'file:///cache/crew.jpg',
    type: 'image/jpeg',
    fileName: 'crew.jpg',
    fileSize: 820_000,
  });
  await press(screen, '대표 사진 추가');
  await press(screen, '대표 사진 빼기');
  expect(
    screen.root.findAll(
      node => node.props.accessibilityLabel === '대표 사진 추가',
    ).length,
  ).toBeGreaterThan(0);

  pickNext({
    uri: 'file:///cache/crew.jpg',
    type: 'image/jpeg',
    fileName: 'crew.jpg',
    fileSize: 820_000,
  });
  await press(screen, '대표 사진 추가');
  expect(
    screen.root.findAll(
      node => node.props.source?.uri === 'file:///cache/crew.jpg',
    ).length,
  ).toBeGreaterThan(0);
  await type(screen, '크루 이름', '광안리 주말 러너스');
  await type(screen, '지역 검색', '광안리');
  await settle(350);
  await press(screen, '광안리해수욕장 입구');
  await press(screen, '크루 만들기');
  await settle(100);

  expect(created).toEqual([
    {
      name: '광안리 주말 러너스',
      description: null,
      capacity: 20,
      regionCode: '26500',
      joinPolicy: 'APPROVAL',
      imageKey: `images/crew/${meId}/${crewImageId}.jpg`,
    },
  ]);
  await act(async () => screen.unmount());
});

test('일반 멤버에게는 내보내기가 보이지 않는다', async () => {
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '광안리 새벽 크루, 모집 중 3/30명');
    expect(texts(screen)).not.toContain('내보내기');
  } finally {
    await act(async () => screen.unmount());
  }
});

test('크루장 확인 후 한 번만 내보내고 목록과 인원을 갱신한다', async () => {
  const screen = await openGroup();
  let release: (() => void) | undefined;
  try {
    await press(screen, '크루 모집');
    await press(screen, '민락 야경 러너스, 모집 중 2/30명');
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '민준 내보내기',
      ),
    ).toHaveLength(0);
    await press(screen, '도윤 내보내기');
    expect(texts(screen)).toContain('이 멤버를 크루에서 내보낼까요?');
    expect(sent('DELETE')).toEqual([]);
    await press(screen, '취소');
    expect(sent('DELETE')).toEqual([]);
    await press(screen, '도윤 내보내기');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (address, init) => {
      if (init.method === 'DELETE')
        await new Promise<void>(resolve => {
          release = resolve;
        });
      return original(address, init);
    });
    const confirm = labelled(screen, '내보내기');
    await act(async () => {
      confirm.props.onPress();
      confirm.props.onPress();
    });
    expect(sent('DELETE')).toEqual(['/crews/42/members/12']);
    await act(async () => {
      release!();
    });
    await settle();
    expect(crews.find(crew => crew.id === 42)!.members).toHaveLength(1);
    expect(texts(screen)).toContain('1 / 30명');
    expect(texts(screen)).toContain('· 승인제');
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '도윤 내보내기',
      ),
    ).toHaveLength(0);
  } finally {
    release?.();
    await act(async () => screen.unmount());
  }
});

test.each([
  [403, 'NOT_ADMIN', '크루장만 멤버를 내보낼 수 있어요'],
  [409, 'CANNOT_REMOVE_OWNER', '크루장은 내보낼 수 없어요'],
  [404, 'MEMBER_NOT_FOUND', '이미 크루에서 나간 멤버예요'],
  [0, 'NETWORK_ERROR', '멤버를 내보내지 못했어요'],
] as const)(
  '내보내기 실패(%s)는 안내하고 구성원 목록을 유지한다',
  async (status, code, message) => {
    const screen = await openGroup();
    try {
      await press(screen, '크루 모집');
      await press(screen, '민락 야경 러너스, 모집 중 2/30명');
      await press(screen, '도윤 내보내기');
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((address, init) => {
        if (init.method === 'DELETE') {
          if (status === 0) throw new TypeError('Network request failed');
          return Promise.resolve(
            respond(status, { code, message: '', details: {} }),
          );
        }
        return original(address, init);
      });
      await press(screen, '내보내기');
      expect(texts(screen)).toContain(message);
      expect(texts(screen)).toContain('2 / 30명');
      expect(texts(screen)).toContain('· 승인제');
      expect(crews.find(crew => crew.id === 42)!.members).toHaveLength(2);
      expect(labelled(screen, '도윤 내보내기')).toBeTruthy();
    } finally {
      await act(async () => screen.unmount());
    }
  },
);

test('후임을 선택하고 확인하면 이양 탈퇴 후 내 크루로 돌아간다', async () => {
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '민락 야경 러너스, 모집 중 2/30명');
    await press(screen, '크루 나가기');
    expect(labelled(screen, '크루장 넘기고 나가기').props.disabled).toBe(true);
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '민준 후임 선택',
      ),
    ).toHaveLength(0);
    await press(screen, '도윤 후임 선택');
    expect(sent('DELETE')).toEqual([]);
    await press(screen, '크루장 넘기고 나가기');
    const request = fetchMock.mock.calls.find(
      ([, init]) => init.method === 'DELETE',
    );
    expect(JSON.parse(request![1].body)).toEqual({ successorUserId: 12 });
    expect(crews.find(crew => crew.id === 42)!.ownerId).toBe(12);
    expect(
      crews
        .find(crew => crew.id === 42)!
        .members.some(member => member.userId === meId),
    ).toBe(false);
    expect(texts(screen)).toContain('‘민락 야경 러너스’에서 나왔어요');
  } finally {
    await act(async () => screen.unmount());
  }
});

test('혼자인 크루장은 해산 확인 전까지 요청하지 않는다', async () => {
  crews[1].members = [{ userId: meId, nickname: '민준' }];
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '민락 야경 러너스, 모집 중 1/30명');
    await press(screen, '크루 나가기');
    expect(texts(screen)).toContain('크루를 해산할까요?');
    expect(sent('DELETE')).toEqual([]);
    await press(screen, '취소');
    expect(sent('DELETE')).toEqual([]);
    await press(screen, '크루 나가기');
    await press(screen, '해산');
    expect(sent('DELETE')).toEqual(['/crews/42']);
    expect(crews.some(crew => crew.id === 42)).toBe(false);
    expect(texts(screen)).toContain('‘민락 야경 러너스’를 해산했어요');
  } finally {
    await act(async () => screen.unmount());
  }
});

test('일반 멤버에게는 크루 해산이 보이지 않는다', async () => {
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '광안리 새벽 크루, 모집 중 3/30명');
    expect(
      screen.root.findAll(
        node => node.props.accessibilityLabel === '크루 해산',
      ),
    ).toHaveLength(0);
  } finally {
    await act(async () => screen.unmount());
  }
});

test.each([
  [403, 'NOT_ADMIN', '크루장만 해산할 수 있어요'],
  [404, 'CREW_NOT_FOUND', '크루를 찾지 못했어요'],
  [0, 'NETWORK_ERROR', '크루를 해산하지 못했어요'],
] as const)(
  '여러 멤버가 있어도 해산을 확인할 수 있고 실패(%s)하면 화면을 유지한다',
  async (status, code, message) => {
    const screen = await openGroup();
    try {
      await press(screen, '크루 모집');
      await press(screen, '민락 야경 러너스, 모집 중 2/30명');
      await press(screen, '크루 해산');
      expect(sent('DELETE')).toEqual([]);
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((address, init) => {
        if (init.method === 'DELETE') {
          if (status === 0) throw new TypeError('Network request failed');
          return Promise.resolve(
            respond(status, { code, message: '', details: {} }),
          );
        }
        return original(address, init);
      });
      await press(screen, '해산');
      expect(texts(screen)).toContain(message);
      expect(texts(screen)).toContain('크루를 해산할까요?');
      expect(crews.find(crew => crew.id === 42)!.members).toHaveLength(2);
    } finally {
      await act(async () => screen.unmount());
    }
  },
);

test('후임 부적합 응답은 이양 화면과 멤버를 유지한다', async () => {
  const screen = await openGroup();
  try {
    await press(screen, '크루 모집');
    await press(screen, '민락 야경 러너스, 모집 중 2/30명');
    await press(screen, '크루 나가기');
    await press(screen, '도윤 후임 선택');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((address, init) =>
      init.method === 'DELETE'
        ? Promise.resolve(
            respond(422, {
              code: 'INVALID_SUCCESSOR',
              message: '',
              details: {},
            }),
          )
        : original(address, init),
    );
    await press(screen, '크루장 넘기고 나가기');
    expect(texts(screen)).toContain('후임으로 지정할 수 없는 멤버예요');
    expect(texts(screen)).toContain('크루장을 넘기고 나갈까요?');
    expect(crews.find(crew => crew.id === 42)!.ownerId).toBe(meId);
  } finally {
    await act(async () => screen.unmount());
  }
});

test.each(['이양', '해산'] as const)(
  '%s 처리 중 연속 확인은 한 번만 요청한다',
  async action => {
    const screen = await openGroup();
    let release: (() => void) | undefined;
    try {
      await press(screen, '크루 모집');
      await press(screen, '민락 야경 러너스, 모집 중 2/30명');
      if (action === '이양') {
        await press(screen, '크루 나가기');
        await press(screen, '도윤 후임 선택');
      } else {
        await press(screen, '크루 해산');
      }
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (address, init) => {
        if (init.method === 'DELETE')
          await new Promise<void>(resolve => {
            release = resolve;
          });
        return original(address, init);
      });
      const label = action === '이양' ? '크루장 넘기고 나가기' : '해산';
      const confirm = labelled(screen, label);
      await act(async () => {
        confirm.props.onPress();
        confirm.props.onPress();
      });
      expect(sent('DELETE')).toEqual([
        action === '이양' ? '/crews/42/members/me' : '/crews/42',
      ]);
      expect(labelled(screen, label).props.disabled).toBe(true);
      await act(async () => {
        release!();
      });
      await settle();
    } finally {
      release?.();
      await act(async () => screen.unmount());
    }
  },
);
