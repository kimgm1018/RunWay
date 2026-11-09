import { searchPlaces } from '../places';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();
const result = {
  name: '공원 입구',
  address: '도로 1',
  position: [129.118, 35.153],
  distanceM: null,
};

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  });
});

function respond(status: number, body: unknown) {
  return { ok: status === 200, status, text: async () => JSON.stringify(body) };
}

test('encodes a keyword and preserves longitude latitude and unknown distance', async () => {
  fetchMock.mockResolvedValue(respond(200, { items: [result] }));
  expect(await searchPlaces(' 공원 & 입구 ', [129, 35])).toEqual([result]);
  const [address, options] = fetchMock.mock.calls[0];
  const url = new URL(address);
  expect(url.pathname).toBe('/api/v1/places/search');
  expect(url.searchParams.get('query')).toBe('공원 & 입구');
  expect(url.searchParams.get('longitude')).toBe('129');
  expect(url.searchParams.get('latitude')).toBe('35');
  expect(options.headers.Authorization).toBe('Bearer synthetic-access');
});

test('omits unknown reference coordinates and keeps an empty result', async () => {
  fetchMock.mockResolvedValue(respond(200, { items: [] }));
  expect(await searchPlaces('도로 1')).toEqual([]);
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('latitude')).toBe(
    false,
  );
});

test('provider failure is propagated instead of becoming an empty list', async () => {
  fetchMock.mockResolvedValue(
    respond(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: '일시적으로 처리할 수 없습니다.',
    }),
  );
  await expect(searchPlaces('공원')).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
