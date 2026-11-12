import { createRecordsApi, shareTitleOf } from '../records';
import { sharedRunsApi } from '../sharedRuns';
import { tokenStore } from '../tokenStore';

// S15P31E105-704: H08 makes my run's link; H09 reads a shared run without signing in.

const fetchMock = jest.fn();
const response = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});
const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'access-test',
    refreshToken: 'refresh-test',
  });
});

test('H09 reads a shared run without the access token and keeps its parts', async () => {
  fetchMock.mockResolvedValue(
    response(200, {
      title: '자유 러닝',
      startedAt: '2026-11-11T22:01:02Z',
      distanceM: 5021.4,
      durationSec: 1712,
      averagePaceSecPerKm: 341.4,
      cadence: 172,
      runner: { nickname: '러너', profileImageUrl: '/api/v1/images/abc' },
      segments: [
        { coordinates: [[127.0, 37.5], [127.001, 37.501]] },
        { coordinates: [] },
      ],
    }),
  );
  const run = await sharedRunsApi.get(token);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(new RegExp(`/api/v1/shared-runs/${token}$`));
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBeUndefined();
  expect(run).toEqual({
    title: '자유 러닝',
    startedAt: '2026-11-11T22:01:02Z',
    distanceM: 5021.4,
    durationSec: 1712,
    averagePaceSecPerKm: 341,
    cadence: 172,
    runner: {
      nickname: '러너',
      profileImageUrl: 'https://k15e105.p.ssafy.io/api/v1/images/abc',
    },
    parts: [[[127.0, 37.5], [127.001, 37.501]]],
  });
});

test('H09 404 is SHARED_RUN_NOT_FOUND', async () => {
  fetchMock.mockResolvedValue(
    response(404, { code: 'SHARED_RUN_NOT_FOUND', message: '없음' }),
  );
  await expect(sharedRunsApi.get(token)).rejects.toMatchObject({
    code: 'SHARED_RUN_NOT_FOUND',
    status: 404,
  });
});

test('H08 posts the title and returns the link', async () => {
  fetchMock.mockResolvedValue(
    response(200, { token, url: `https://k15e105.p.ssafy.io/r/${token}` }),
  );
  const { records } = createRecordsApi();
  await expect(records.shareLink('101', '자유 러닝')).resolves.toBe(
    `https://k15e105.p.ssafy.io/r/${token}`,
  );
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/running-records\/101\/share-link$/);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ title: '자유 러닝' });
  expect(init.headers.Authorization).toBe('Bearer access-test');
});

test('H08 titles fit the 1–40 limit without control characters or split characters', () => {
  const course = '한강 반포 잠수교 왕복 코스 '.repeat(4);
  expect(shareTitleOf(course).length).toBeLessThanOrEqual(40);
  expect(course.startsWith(shareTitleOf(course))).toBe(true);
  expect(shareTitleOf('아침\u0000 러닝\u202E\u200B')).toBe('아침 러닝');
  // An emoji is two UTF-16 units: one that would cross the limit is left out whole.
  const emoji = `${'a'.repeat(39)}🏃`;
  expect(shareTitleOf(emoji)).toBe('a'.repeat(39));
  expect(shareTitleOf('  \u200B ')).toBe('러닝');
});
