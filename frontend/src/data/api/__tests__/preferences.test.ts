import { createMockRepositories } from '../../mock/createMockRepositories';
import {
  copyCoursePreferences,
  defaultCoursePreferences,
} from '../../coursePreferences';
import { getCoursePreferences, saveCoursePreferences } from '../preferences';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();
const response = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
});
beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'access-test',
    refreshToken: 'refresh-test',
  });
});

test('U11은 GET으로 서버의 형태·9개 기본값을 그대로 읽는다', async () => {
  const value = defaultCoursePreferences();
  value.shape = 'out_and_back';
  value.filters.avoid_steps = true;
  fetchMock.mockResolvedValue(response(200, value));
  expect(await getCoursePreferences()).toEqual(value);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/users\/me\/preferences$/);
  expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
});

test('U12는 false를 포함한 9개 필드 전체만 저장하고 좌표·거리 등을 섞지 않는다', async () => {
  const value = {
    ...defaultCoursePreferences(),
    origin: { position: [1, 2] },
    distanceKm: 5,
  };
  value.shape = 'point_to_point';
  fetchMock.mockResolvedValue(response(200, copyCoursePreferences(value)));
  await saveCoursePreferences(value);
  const init = fetchMock.mock.calls[0][1];
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body)).toEqual(defaultCoursePreferencesWithPoint());
});
const defaultCoursePreferencesWithPoint = () => ({
  ...defaultCoursePreferences(),
  shape: 'point_to_point',
});

test('기본값 조회 장애를 미설정 응답으로 숨기지 않는다', async () => {
  fetchMock.mockResolvedValue(
    response(503, { code: 'SERVICE_UNAVAILABLE', message: '' }),
  );
  await expect(getCoursePreferences()).rejects.toMatchObject({ status: 503 });
});

test('목업도 명시적으로 저장하기 전에는 기본값이 바뀌지 않는다', async () => {
  const { courses } = createMockRepositories({ latencyMs: 0 });
  const value = await courses.getPreferences();
  expect(value).toEqual(defaultCoursePreferences());
  value.shape = 'out_and_back';
  value.filters.flat = true;
  expect(await courses.getPreferences()).toEqual(defaultCoursePreferences());
  await courses.savePreferences(value);
  expect(await courses.getPreferences()).toEqual(value);
  value.filters.flat = false;
  expect((await courses.getPreferences()).filters.flat).toBe(true);
});
