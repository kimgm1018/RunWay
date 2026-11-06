import { appConfig } from '../../../config';
import { consentsApi } from '../consents';
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

const url = `${appConfig.apiBaseUrl}/consents`;

const status = (health: boolean) => ({
  items: [
    { consentType: 'TERMS_OF_SERVICE', granted: true },
    { consentType: 'PERSONAL_INFO', granted: true },
    { consentType: 'LOCATION_DATA', granted: true },
    { consentType: 'HEALTH_DATA', granted: health },
  ],
});

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('W05 picks HEALTH_DATA out of the four consents', async () => {
  fetchMock.mockResolvedValue(respond(200, status(false)));

  await expect(consentsApi.getHealth()).resolves.toBe(false);
  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(url);
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

test('W05 without a HEALTH_DATA item is an error, not a guess', async () => {
  fetchMock.mockResolvedValue(respond(200, { items: [] }));

  await expect(consentsApi.getHealth()).rejects.toBeDefined();
});

test('W04 sends HEALTH_DATA with granted and resolves to the applied value', async () => {
  fetchMock.mockResolvedValue(
    respond(200, { consentType: 'HEALTH_DATA', granted: false }),
  );

  await expect(consentsApi.setHealth(false)).resolves.toBe(false);
  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(url);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    consentType: 'HEALTH_DATA',
    granted: false,
  });
});

test('W04 503 rejects so 8.1 can ask W05 again', async () => {
  fetchMock.mockResolvedValue(
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '잠시 후 다시 시도' }),
  );

  await expect(consentsApi.setHealth(true)).rejects.toBeDefined();
});
