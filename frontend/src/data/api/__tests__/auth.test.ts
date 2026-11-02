import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import { login } from '../auth';
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
  await tokenStore.clear();
});

test('U01 posts the credentials without a token and returns the session', async () => {
  // A token left from an earlier session must not ride along with the login.
  tokenStore.hold({ accessToken: 'old', refreshToken: 'old' });
  fetchMock.mockResolvedValue(
    respond(200, {
      user: { id: 101, loginId: 'minjun01' },
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSec: 600,
      refreshExpiresAt: '2026-12-02T01:00:00Z',
      onboardingCompleted: true,
    }),
  );

  const session = await login({ loginId: 'minjun01', password: 'runway123' });

  expect(session).toEqual({
    user: { id: 101, loginId: 'minjun01' },
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    onboardingCompleted: true,
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/auth/login`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    loginId: 'minjun01',
    password: 'runway123',
  });
  expect(init.headers.Authorization).toBeUndefined();
});

test.each([
  [401, 'INVALID_CREDENTIALS'],
  [429, 'LOGIN_LOCKED'],
  [400, 'VALIDATION_ERROR'],
])('a %i %s response rejects with that code', async (status, code) => {
  fetchMock.mockResolvedValue(
    respond(status, { code, message: '', details: {} }),
  );

  await expect(
    login({ loginId: 'minjun01', password: 'wrong-pass1' }),
  ).rejects.toEqual(expect.objectContaining({ code }));
  await expect(
    login({ loginId: 'minjun01', password: 'wrong-pass1' }),
  ).rejects.toBeInstanceOf(DataError);
});
