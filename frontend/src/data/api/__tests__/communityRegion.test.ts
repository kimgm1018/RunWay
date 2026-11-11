import { appConfig } from '../../../config';
import type { Repositories, RunRecordDetail } from '../../types';
import { createCommunityApi } from '../community';
import { createRegions } from '../regions';
import { tokenStore } from '../tokenStore';

// 7.1 지역 고르기 (S15P31E105-687): CMT02 by regionCode, CMT12 grouped by 시·도, and the region of a shared course
// start, shown on 7.3 and sent with CMT01 only when the course is shared.

const fetchMock = jest.fn();
const base = appConfig.apiBaseUrl;

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const regionList = {
  items: [
    { regionCode: '26000', sidoName: '부산광역시', sigunguName: '' },
    { regionCode: '26350', sidoName: '부산광역시', sigunguName: '해운대구' },
    { regionCode: '26500', sidoName: '부산광역시', sigunguName: '수영구' },
    { regionCode: '36110', sidoName: '세종특별자치시', sigunguName: '' },
    { regionCode: '41000', sidoName: '경기도', sigunguName: '' },
    { regionCode: '41110', sidoName: '경기도', sigunguName: '수원시' },
    { regionCode: '41111', sidoName: '경기도', sigunguName: '수원시 장안구' },
    { regionCode: '12000', sidoName: '전남광주통합특별시', sigunguName: '' },
    {
      regionCode: '12330',
      sidoName: '전남광주통합특별시',
      sigunguName: '광산구',
    },
    // A sido without a row of its own cannot be picked as a whole.
    { regionCode: '99110', sidoName: '없는도', sigunguName: '어느시' },
  ],
};

// Answers /regions with the list and every other call with the given body.
function server(other: unknown = { id: 103 }) {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/regions') ? respond(200, regionList) : respond(201, other),
  );
}

function postCall() {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === `${base}/posts` && init.method === 'POST',
  );
  return call ? JSON.parse(call[1].body) : undefined;
}

const detail = (patch: Partial<RunRecordDetail>) =>
  ({ route: null, routeParts: null, ...patch } as RunRecordDetail);

function records(getDetail: () => Promise<RunRecordDetail>) {
  return { getDetail } as unknown as Repositories['records'];
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'header.eyJzdWIiOiI3In0.signature',
    refreshToken: 'refresh-1',
  });
});

afterEach(() => {
  jest.useRealTimers();
});

test('CMT02 sends the picked region code, and none for 전국', async () => {
  server({ items: [] });
  const api = createCommunityApi({
    records: records(async () => detail({})),
    regions: createRegions(),
  });

  await api.listFeed('ALL', null, '26350');
  await api.listFeed('FOLLOWING', 'c-1', '26000');
  await api.listFeed('ALL', null, null);
  await api.listFeed('ALL');

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${base}/posts?scope=ALL&regionCode=26350&limit=20`,
    `${base}/posts?scope=FOLLOWING&regionCode=26000&limit=20&cursor=c-1`,
    `${base}/posts?scope=ALL&limit=20`,
    `${base}/posts?scope=ALL&limit=20`,
  ]);
});

test('CMT12 groups every 시·도 with its 시·군·구 under short names', async () => {
  server();
  const api = createCommunityApi({
    records: records(async () => detail({})),
    regions: createRegions(),
  });

  await expect(api.listRegions()).resolves.toEqual([
    {
      code: '26000',
      name: '부산',
      areas: [
        { code: '26350', name: '해운대구' },
        { code: '26500', name: '수영구' },
      ],
    },
    { code: '36110', name: '세종', areas: [] },
    {
      code: '41000',
      name: '경기',
      areas: [
        { code: '41110', name: '수원시' },
        { code: '41111', name: '수원시 장안구' },
      ],
    },
    {
      code: '12000',
      name: '전남광주',
      areas: [{ code: '12330', name: '광산구' }],
    },
  ]);
});

test('without the region list only 전국 is offered', async () => {
  const api = createCommunityApi({ records: records(async () => detail({})) });
  await expect(api.listRegions()).resolves.toEqual([]);
});

test('the region an address names: 시·군·구 by its words, else the 시·도, old sido names too', async () => {
  server();
  const regions = createRegions();

  const cases: [string | null, string | null][] = [
    ['부산광역시 해운대구 우동 1408', '26350'],
    ['대한민국 부산광역시 수영구 광안해변로 219', '26500'],
    // 해운대구 is not 해운대 (no partial word match), and an unknown 시·군·구 falls back to its 시·도.
    ['부산광역시 해운대 어딘가', '26000'],
    ['경기도 수원시 장안구 정자동', '41111'],
    ['경기도 수원시 팔달구 인계동', '41110'],
    ['세종특별자치시 한누리대로 2130', '36110'],
    ['광주광역시 광산구 첨단동', '12330'],
    ['서울특별시 중구 세종대로', null],
    ['', null],
    [null, null],
  ];
  for (const [address, code] of cases) {
    expect([address, await regions.codeAt(address)]).toEqual([address, code]);
  }
});

test('CMT01 sends the region 7.3 showed only with a shared course, and never asks the geocoder', async () => {
  server();
  const addressOf = jest.fn(async () => '부산광역시 수영구 광안해변로');
  const api = createCommunityApi({
    records: records(async () => detail({})),
    regions: createRegions(),
    addressOf,
  });

  await api.create('55', {
    body: '코스 공유',
    courseShared: true,
    regionCode: '26500',
  });
  expect(postCall()).toEqual({
    sessionId: 55,
    body: '코스 공유',
    courseShared: true,
    regionCode: '26500',
  });

  // 사용자 결정 1번: a post that keeps its course (or a free run) goes without a region, whatever the draft holds.
  fetchMock.mockClear();
  await api.create('56', {
    body: '경로 숨김',
    courseShared: false,
    regionCode: '26500',
  });
  expect(postCall()).toEqual({
    sessionId: 56,
    body: '경로 숨김',
    courseShared: false,
  });

  // No region found on 7.3: none is sent.
  fetchMock.mockClear();
  await api.create('57', { body: null, courseShared: true, regionCode: null });
  expect(postCall()).toEqual({
    sessionId: 57,
    body: null,
    courseShared: true,
  });
  expect(addressOf).not.toHaveBeenCalled();
});

test('7.3 지역 is the course start through the geocoder, with its short label', async () => {
  server();
  const addressOf = jest.fn(async () => '부산광역시 수영구 광안해변로 219');
  const api = createCommunityApi({
    records: records(async () => detail({})),
    regions: createRegions(),
    addressOf,
  });

  await expect(api.regionAt([129.118, 35.153])).resolves.toEqual({
    code: '26500',
    label: '부산 수영구',
  });
  expect(addressOf).toHaveBeenCalledWith([129.118, 35.153]);
});

test('7.3 지역 is none when the phone finds nothing, fails or has no region list', async () => {
  server();
  const at = (addressOf: () => Promise<string | null>, withRegions = true) =>
    createCommunityApi({
      records: records(async () => detail({})),
      regions: withRegions ? createRegions() : undefined,
      addressOf,
    }).regionAt([129.1, 35.1]);

  await expect(at(async () => null)).resolves.toBeNull();
  await expect(at(async () => '서울특별시 중구 세종대로')).resolves.toBeNull();
  await expect(
    at(async () => {
      throw new Error('geocoder');
    }),
  ).resolves.toBeNull();
  await expect(at(async () => '부산광역시 수영구', false)).resolves.toBeNull();
});

test('7.3 지역 does not wait more than 3 s', async () => {
  jest.useFakeTimers();
  server();
  const api = createCommunityApi({
    records: records(async () => detail({})),
    regions: createRegions(),
    // A geocoder that never answers.
    addressOf: () => new Promise<string | null>(() => undefined),
  });

  const found = api.regionAt([129.16, 35.16]);
  await jest.advanceTimersByTimeAsync(3000);

  await expect(found).resolves.toBeNull();
});
