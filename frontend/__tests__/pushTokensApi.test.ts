import { tokenStore } from '../src/data';
import { notificationsApi } from '../src/data/api/notifications';

// S15P31E105-815: N03/N04 requests (docs/design/api/notifications.md).

const fetchMock = jest.fn();

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    text: async () => '',
    json: async () => undefined,
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({
    accessToken: 'header.e30.signature',
    refreshToken: 'refresh-1',
  });
});

afterEach(async () => {
  await tokenStore.clear();
});

const request = () => {
  const [url, init] = fetchMock.mock.calls[0];
  return {
    url: String(url),
    method: init.method,
    body: JSON.parse(init.body),
    authorization: new Headers(init.headers).get('Authorization') ??
      init.headers?.Authorization,
  };
};

it('N03 registers this phone as ANDROID with the access token', async () => {
  await notificationsApi.registerPushToken('fcm:token-1');
  const sent = request();
  expect(sent.url).toMatch(/\/api\/v1\/notifications\/push-tokens$/);
  expect(sent.method).toBe('PUT');
  expect(sent.body).toEqual({ token: 'fcm:token-1', platform: 'ANDROID' });
  expect(sent.authorization).toBe('Bearer header.e30.signature');
});

it('N04 removes this phone with the token in the body', async () => {
  await notificationsApi.unregisterPushToken('fcm:token-1');
  const sent = request();
  expect(sent.url).toMatch(/\/api\/v1\/notifications\/push-tokens$/);
  expect(sent.method).toBe('DELETE');
  expect(sent.body).toEqual({ token: 'fcm:token-1' });
});
