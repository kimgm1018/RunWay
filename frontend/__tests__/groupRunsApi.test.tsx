import React from 'react';
import { Alert, Image, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 6.0 그룹런 목록, 6.4 상세·참가·수정, 6.5 대기방, 6.8 만들기 against the server (dataSource 'api'): G01–G07·G16.

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

const now = Date.parse('2026-11-02T03:00:00Z');
const meId = 101;

// profileImageUrl: G07 photo path (S15P31E105-636).
type Member = {
  userId: number;
  nickname: string;
  ready: boolean;
  profileImageUrl?: string;
};
type Run = {
  id: number;
  title: string;
  hostId: number;
  courseId: number | null;
  scheduledAt: string;
  meetingPlaceName: string;
  members: Member[];
};

// The server's runs of crew 41: 61 is mine and opens its room now, 62 is 성윤's next week.
let runs: Run[];
let posted: unknown[];
let patched: unknown[];

const runDetail = (run: Run) => ({
  id: run.id,
  title: run.title,
  description: null,
  hostId: run.hostId,
  crewId: 41,
  courseId: run.courseId,
  scheduledAt: run.scheduledAt,
  meetingPosition: { type: 'Point', coordinates: [129.118, 35.153] },
  participantCount: run.members.length,
  status: 'SCHEDULED',
  targetDistanceM: null,
  targetDurationSec: null,
  meetingPlaceName: run.meetingPlaceName,
  meetingAddress: '부산 수영구 광안해변로 219',
  goalPaceSecPerKm: null,
});

// W02의 연결 워치 여부. 테스트마다 기본은 연결됨.
let watchLinked = true;

function serve() {
  fetchMock.mockImplementation(
    async (address: string, init: { method: string; body?: string }) => {
      const url = new URL(address);
      const path = url.pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/places/search') {
        return respond(200, {
          items: url.searchParams.get('query')
            ? [
                {
                  name: '광안리해수욕장 입구',
                  address: '부산 수영구 광안해변로 219',
                  position: [129.118, 35.153],
                  distanceM: null,
                },
              ]
            : [],
        });
      }
      const find = (id: string) => runs.find(run => run.id === Number(id))!;
      const body = init.body ? JSON.parse(init.body) : {};
      if (path === '/users/me') {
        return respond(200, { id: meId, nickname: '민준' });
      }
      if (path === '/users/me/running-profile') {
        return respond(404, {
          code: 'PROFILE_NOT_SET',
          message: '',
          details: {},
        });
      }
      // 6.8 offers my saved courses (C09); none are saved here.
      if (path === '/users/me/bookmarked-courses') {
        return respond(200, { items: [] });
      }
      // W02: 준비 완료(G16) 전에 연결 워치·폰을 확인한다(S15P31E105-420).
      if (path === '/devices' && init.method === 'GET') {
        return respond(200, {
          items: watchLinked
            ? [
                { id: 501, deviceType: 'WATCH' },
                { id: 502, deviceType: 'PHONE' },
              ]
            : [{ id: 502, deviceType: 'PHONE' }],
        });
      }
      if (path === '/regions') {
        return respond(200, { items: [], currentRegionCode: null });
      }
      if (path === '/users/me/crews') {
        return respond(200, {
          items: [
            {
              id: 41,
              name: '광안리 새벽 크루',
              regionCode: null,
              myMembershipStatus: 'APPROVED',
              memberCount: 12,
              isOwner: false,
            },
          ],
        });
      }
      if (path === '/crews/41') {
        return respond(200, {
          id: 41,
          name: '광안리 새벽 크루',
          description: null,
          ownerId: 7,
          memberCount: 12,
          capacity: 30,
          regionCode: null,
          myMembershipStatus: 'APPROVED',
        });
      }
      if (path === '/crews/41/members') {
        return respond(200, { items: [] });
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
      if (path === '/group-runs' && init.method === 'POST') {
        posted.push(body);
        runs.push({
          id: 70,
          title: body.title,
          hostId: meId,
          courseId: body.courseId,
          scheduledAt: body.scheduledAt,
          meetingPlaceName: body.meetingPlaceName,
          members: [{ userId: meId, nickname: '민준', ready: false }],
        });
        return respond(201, { id: 70 });
      }
      if (path === '/group-runs') {
        return respond(200, {
          items: runs.map(run => ({ id: run.id, status: 'SCHEDULED' })),
          nextCursor: null,
        });
      }
      let match = path.match(/^\/group-runs\/(\d+)$/);
      if (match && init.method === 'PATCH') {
        patched.push(body);
        const run = find(match[1]);
        run.scheduledAt = body.scheduledAt;
        run.meetingPlaceName = body.meetingPlaceName;
        return respond(200, { id: run.id });
      }
      if (match) {
        return respond(200, runDetail(find(match[1])));
      }
      match = path.match(/^\/group-runs\/(\d+)\/participants$/);
      if (match) {
        const run = find(match[1]);
        return respond(200, {
          items: run.members.map(member => ({
            userId: member.userId,
            nickname: member.nickname,
            isHost: member.userId === run.hostId,
            readyStatus: member.ready ? 'READY' : 'WAITING',
            profileImageUrl: member.profileImageUrl ?? null,
          })),
        });
      }
      match = path.match(/^\/group-runs\/(\d+)\/join$/);
      if (match) {
        find(match[1]).members.push({
          userId: meId,
          nickname: '민준',
          ready: false,
        });
        return respond(200, { groupRunId: Number(match[1]), userId: meId });
      }
      match = path.match(/^\/group-runs\/(\d+)\/participants\/me$/);
      if (match) {
        const run = find(match[1]);
        run.members = run.members.filter(member => member.userId !== meId);
        return respond(200, {});
      }
      match = path.match(/^\/group-runs\/(\d+)\/participants\/me\/ready$/);
      if (match) {
        const me = find(match[1]).members.find(
          member => member.userId === meId,
        )!;
        me.ready = body.ready;
        return respond(200, {
          participantCount: 2,
          readyStatus: 'READY',
          readyCount: 2,
        });
      }
      throw new Error(`unexpected request ${init.method} ${address}`);
    },
  );
}

const calls = (method: string) =>
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
function labelled(screen: Screen, label: string | RegExp) {
  const matches = screen.root.findAll(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      (typeof label === 'string'
        ? node.props.accessibilityLabel === label
        : label.test(node.props.accessibilityLabel)) &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string | RegExp) {
  await act(async () => {
    labelled(screen, label).props.onPress();
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
  await settle(50);
  return screen!;
}

beforeEach(async () => {
  // Monday 11.02 12:00 in Korea; timers still run so the screens settle.
  jest.useFakeTimers({ now, advanceTimers: true });
  runs = [
    {
      id: 61,
      title: '월요일, 함께 5km',
      hostId: meId,
      courseId: 301,
      scheduledAt: new Date(now + 20 * 60 * 1000).toISOString(),
      meetingPlaceName: '광안리해수욕장 입구',
      members: [
        { userId: meId, nickname: '민준', ready: false },
        { userId: 9, nickname: '하린', ready: true },
      ],
    },
    {
      id: 62,
      title: '일요일, 함께 40분',
      hostId: 7,
      courseId: null,
      scheduledAt: new Date(now + 6 * 24 * 3600 * 1000).toISOString(),
      meetingPlaceName: '민락수변공원',
      members: [{ userId: 7, nickname: '성윤', ready: false }],
    },
  ];
  posted = [];
  patched = [];
  watchLinked = true;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    refreshExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  serve();
});

afterEach(() => {
  jest.useRealTimers();
});

test('6.0 pins my run that starts soon and 6.5 marks me ready with G16', async () => {
  const screen = await openGroup();
  const page = texts(screen);
  // 곧 출발 shows the crew name; the run's title is in its label.
  expect(page).toContain('광안리 새벽 크루');
  expect(() => labelled(screen, /^월요일, 함께 5km, /)).not.toThrow();
  expect(page).toContain('일요일, 함께 40분');

  await press(screen, '대기방 입장');
  expect(texts(screen)).toContain('1명 준비 완료');
  await press(screen, '준비 완료');
  await settle(50);

  expect(calls('POST')).toEqual(['/group-runs/61/participants/me/ready']);
  expect(texts(screen)).toContain('2명 준비 완료');
  await act(async () => screen.unmount());
});

test('6.5 does not mark me ready without a linked watch and says so', async () => {
  // G16은 연결 워치·폰으로 세션을 만든다. 워치가 없으면 서버 오류 대신 연결 안내를 보인다(S15P31E105-420).
  watchLinked = false;
  const screen = await openGroup();
  await press(screen, '대기방 입장');
  await press(screen, '준비 완료');
  await settle(50);

  expect(calls('POST')).toEqual([]);
  expect(texts(screen)).toContain(
    '워치를 연결해야 준비할 수 있어요. 설정 › 워치 연결에서 연결해 주세요',
  );
  expect(texts(screen)).toContain('1명 준비 완료');
  await act(async () => screen.unmount());
});

test('6.5 requires a new login before readiness when less than a day remains', async () => {
  await tokenStore.save({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    refreshExpiresAt: new Date(now + 24 * 60 * 60 * 1000 - 1).toISOString(),
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = await openGroup();
  try {
    await press(screen, '대기방 입장');
    await press(screen, '준비 완료');
    await settle(50);

    expect(calls('POST')).toEqual([]);
    expect(texts(screen)).toContain('1명 준비 완료');
    expect(alert).toHaveBeenCalledWith(
      '러닝 전에 다시 로그인해 주세요',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: '다시 로그인' }),
      ]),
    );
  } finally {
    await act(async () => screen.unmount());
    alert.mockRestore();
  }
});

test('6.4 joins and leaves a crewmate’s run', async () => {
  const screen = await openGroup();
  await press(screen, /^일요일, 함께 40분, /);
  expect(texts(screen)).toContain('성윤');

  await press(screen, '참가하기');
  await settle(50);
  expect(calls('POST')).toEqual(['/group-runs/62/join']);
  await press(screen, '참가 취소');
  await settle(50);
  expect(calls('DELETE')).toEqual(['/group-runs/62/participants/me']);
  expect(() => labelled(screen, '참가하기')).not.toThrow();
  await act(async () => screen.unmount());
});

// S15P31E105-636: 6.4 shows a participant's G07 photo in place of the letter.
test('6.4 shows participant photos from G07', async () => {
  const path = '/api/v1/images/33333333-3333-4333-8333-333333333333';
  runs.find(run => run.id === 62)!.members[0].profileImageUrl = path;
  const screen = await openGroup();
  await press(screen, /^일요일, 함께 40분, /);
  const uris = screen.root
    .findAllByType(Image)
    .map(node => (node.props.source as { uri?: string })?.uri ?? '');
  expect(uris.some(uri => /^https?:\/\//.test(uri) && uri.endsWith(path))).toBe(true);
  await act(async () => screen.unmount());
});

test('6.4 opens 6.8 to edit my run and saves it with G04', async () => {
  const screen = await openGroup();
  await press(screen, /^월요일, 함께 5km, /);
  await press(screen, '그룹런 수정');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('그룹런 수정');
  expect(page).toContain('광안리해수욕장 입구');
  expect(page).toContain('민락 아침 코스');

  await press(screen, '저장');
  await settle(50);

  expect(patched).toHaveLength(1);
  expect(patched[0]).toMatchObject({
    courseId: 301,
    meetingPlaceName: '광안리해수욕장 입구',
    scheduledAt: runs[0].scheduledAt,
  });
  page = texts(screen);
  expect(page).toContain('그룹런을 수정했어요');
  await act(async () => screen.unmount());
});

test('6.8 makes a free run with G01 and opens its 6.4', async () => {
  const screen = await openGroup();
  await press(screen, '광안리 새벽 크루 그룹런 만들기');
  await settle(50);
  await press(screen, '자유 러닝');
  await press(screen, '만나는 곳 변경');
  await act(async () => {
    screen.root
      .findAll(
        node =>
          node.props.accessibilityLabel === '장소·주소 검색' &&
          typeof node.props.onChangeText === 'function',
      )
      .pop()!
      .props.onChangeText('광안리');
  });
  await settle(400);
  await press(screen, '광안리해수욕장 입구');
  await press(screen, '이 위치로 정하기');
  await press(screen, '확정');
  await press(screen, '그룹런 만들기');
  await settle(100);

  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    crewId: 41,
    courseId: null,
    title: expect.stringMatching(/요일, 함께 40분$/),
  });
  expect(posted[0]).not.toHaveProperty('targetDurationSec');
  expect(texts(screen)).toContain((posted[0] as { title: string }).title);
  await act(async () => screen.unmount());
});

test('459 host start submits G09 once and waits for device confirmation', async () => {
  const screen = await openGroup();
  try {
    await press(screen, /^월요일, 함께 5km, /);
    await press(screen, '대기방 입장');
    const existing = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((address, init) =>
      String(address).endsWith('/group-runs/61/start')
        ? Promise.resolve(
            respond(200, {
              participants: [
                { sessionId: 900, result: 'PENDING', startedAt: null },
              ],
            }),
          )
        : existing(address, init),
    );
    await press(screen, '그룹런 시작');
    expect(calls('POST')).toContain('/group-runs/61/start');
    expect(texts(screen)).toContain(
      '출발 요청이 승인됐어요. 기기의 실제 시작을 확인하고 있어요.',
    );
    expect(texts(screen)).toContain('출발 준비');
  } finally {
    await act(async () => screen.unmount());
  }
});

test('419 waiting room displays insufficient data instead of a fabricated recommendation', async () => {
  const screen = await openGroup();
  try {
    await press(screen, /^월요일, 함께 5km, /);
    await press(screen, '대기방 입장');
    expect(texts(screen)).toContain('추천 공동 페이스');
    expect(texts(screen)).toContain('추천 정보 부족');
    expect(texts(screen)).not.toContain('참가자 편한 범위');
  } finally {
    await act(async () => screen.unmount());
  }
});
