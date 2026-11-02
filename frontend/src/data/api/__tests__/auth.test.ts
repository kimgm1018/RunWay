import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import { checkLoginId, login, signUp } from '../auth';
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

test('U16 asks for the ID as a query without a token', async () => {
  tokenStore.hold({ accessToken: 'old', refreshToken: 'old' });
  fetchMock.mockResolvedValue(
    respond(200, {
      loginId: 'runner01',
      available: false,
      reason: 'DUPLICATED',
    }),
  );

  await expect(checkLoginId('runner01')).resolves.toEqual({
    loginId: 'runner01',
    available: false,
    reason: 'DUPLICATED',
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(
    `${appConfig.apiBaseUrl}/auth/login-id/availability?loginId=runner01`,
  );
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBeUndefined();
});

test.each([
  ['AGREEE', true],
  ['DISAGREE', false],
] as const)(
  'U15 sends the four consents with health data %s',
  async (healthDataAccess, granted) => {
    fetchMock.mockResolvedValue(
      respond(201, {
        user: { id: 102, loginId: 'newrunner' },
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresInSec: 600,
        refreshExpiresAt: '2026-12-02T01:00:00Z',
        onboardingCompleted: false,
      }),
    );

    const session = await signUp({
      loginId: 'newrunner',
      password: 'runway123',
      nickname: '러너',
      birthDate: '1991-02-28',
      gender: 'MALE',
      phoneNumber: '01055556666',
      healthDataAccess,
    });

    expect(session).toEqual({
      user: { id: 102, loginId: 'newrunner' },
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      onboardingCompleted: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${appConfig.apiBaseUrl}/auth/signup`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      loginId: 'newrunner',
      password: 'runway123',
      nickname: '러너',
      birthDate: '1991-02-28',
      gender: 'MALE',
      phoneNumber: '01055556666',
      consents: [
        { consentType: 'TERMS_OF_SERVICE', granted: true },
        { consentType: 'PERSONAL_INFO', granted: true },
        { consentType: 'LOCATION_DATA', granted: true },
        { consentType: 'HEALTH_DATA', granted },
      ],
    });
  },
);
