import { appConfig } from '../../../config';
import { searchApi } from '../search';
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

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('CMT13 asks for both kinds and turns ids into strings', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      users: [{ userId: 101, nickname: 'seoyun.run' }],
      crews: [{ id: 201, name: '광안 Run Club' }],
      page: 'dTo1fGM6MA',
    }),
  );

  await expect(searchApi.find({ query: 'run', type: 'ALL' })).resolves.toEqual({
    runners: [{ userId: '101', nickname: 'seoyun.run' }],
    crews: [{ crewId: '201', name: '광안 Run Club' }],
    cursor: 'dTo1fGM6MA',
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/search?q=run&limit=20`);
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

test('러너 sends type USER with the cursor, and a left-out kind is empty', async () => {
  fetchMock.mockResolvedValue(
    respond(200, { users: [{ userId: 7, nickname: 'run.haeun' }], page: null }),
  );

  await expect(
    searchApi.find({ query: 'run', type: 'RUNNER', cursor: 'abc' }),
  ).resolves.toEqual({
    runners: [{ userId: '7', nickname: 'run.haeun' }],
    crews: [],
    cursor: null,
  });
  expect(fetchMock.mock.calls[0][0]).toBe(
    `${appConfig.apiBaseUrl}/search?q=run&type=USER&cursor=abc&limit=20`,
  );
});

test('QUERY_TOO_SHORT reaches the screen as its code', async () => {
  fetchMock.mockResolvedValue(
    respond(400, { code: 'QUERY_TOO_SHORT', message: '', details: {} }),
  );

  await expect(
    searchApi.find({ query: 'r', type: 'CREW' }),
  ).rejects.toMatchObject({ code: 'QUERY_TOO_SHORT' });
});
