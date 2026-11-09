import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import {
  checkLoginId,
  login,
  logout,
  requestPhoneCode,
  resetPassword,
  signUp,
  verifyPhoneCode,
} from '../auth';
import { onUnauthorized } from '../http';
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
    refreshExpiresAt: '2026-12-02T01:00:00Z',
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
  ['AGREE', true],
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
      refreshExpiresAt: '2026-12-02T01:00:00Z',
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

test('U03 posts the refresh token without the access token and settles on 204', async () => {
  // An expired access token must not ride along or stop the logout.
  tokenStore.hold({ accessToken: 'expired', refreshToken: 'refresh-1' });
  const unauthorized = jest.fn();
  const stop = onUnauthorized(unauthorized);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    text: async () => '',
    json: async () => undefined,
  });

  await expect(logout('refresh-1')).resolves.toBeUndefined();

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/auth/logout`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-1' });
  expect(init.headers.Authorization).toBeUndefined();
  expect(unauthorized).not.toHaveBeenCalled();
  stop();
});

test('a 503 from U03 rejects without the refresh token in the error', async () => {
  fetchMock.mockResolvedValue(
    respond(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: '잠시 후 다시 시도해 주세요.',
    }),
  );
  const error = await logout('refresh-secret').catch(caught => caught);
  expect(error).toBeInstanceOf(DataError);
  expect(error.status).toBe(503);
  expect(JSON.stringify({ ...error, message: error.message })).not.toContain(
    'refresh-secret',
  );
});

// U28~U30 휴대전화 인증·비밀번호 재설정 (users.md, S15P31E105-560).
test('U28 asks for a code without a token and returns its lifetime', async () => {
  tokenStore.hold({ accessToken: 'old', refreshToken: 'old' });
  fetchMock.mockResolvedValue(
    respond(200, { expiresInSec: 180, resendAvailableInSec: 60 }),
  );

  await expect(
    requestPhoneCode({ phoneNumber: '01055556666', purpose: 'SIGN_UP' }),
  ).resolves.toEqual({ expiresInSec: 180 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/auth/phone-verifications`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    phoneNumber: '01055556666',
    purpose: 'SIGN_UP',
  });
  expect(init.headers.Authorization).toBeUndefined();
});

test.each([
  [429, 'VERIFICATION_RESEND_TOO_SOON'],
  [429, 'VERIFICATION_SEND_LIMIT_EXCEEDED'],
  [503, 'SMS_UNAVAILABLE'],
])('U28 %i %s keeps its code and is sent once', async (status, code) => {
  fetchMock.mockResolvedValue(
    respond(status, { code, message: '', details: { retryAfterSec: 30 } }),
  );

  const error = await requestPhoneCode({
    phoneNumber: '01055556666',
    purpose: 'PASSWORD_RESET',
  }).catch(caught => caught);
  expect(error).toBeInstanceOf(DataError);
  expect(error.code).toBe(code);
  // A lost or failed answer may already have sent the SMS, so the app never repeats it on its own.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('U29 confirms the code and returns the proof', async () => {
  fetchMock.mockResolvedValue(
    respond(200, { verificationToken: 'proof-1', expiresInSec: 600 }),
  );

  await expect(
    verifyPhoneCode({
      phoneNumber: '01055556666',
      purpose: 'SIGN_UP',
      code: '123456',
    }),
  ).resolves.toEqual({ verificationToken: 'proof-1' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/auth/phone-verifications/confirm`);
  expect(JSON.parse(init.body)).toEqual({
    phoneNumber: '01055556666',
    purpose: 'SIGN_UP',
    code: '123456',
  });
  expect(init.headers.Authorization).toBeUndefined();
});

// After a correct code U29 tells whether the number can go on (review R-1); no proof comes back.
test.each([
  [409, 'PHONE_ALREADY_REGISTERED', 'SIGN_UP'],
  [404, 'PHONE_NOT_REGISTERED', 'PASSWORD_RESET'],
  [409, 'PHONE_ACCOUNT_AMBIGUOUS', 'PASSWORD_RESET'],
] as const)('U29 %i %s comes back as that error', async (status, code, purpose) => {
  fetchMock.mockResolvedValue(respond(status, { code, message: '' }));

  const error = await verifyPhoneCode({
    phoneNumber: '01055556666',
    purpose,
    code: '123456',
  }).catch(caught => caught);
  expect(error).toBeInstanceOf(DataError);
  expect(error.code).toBe(code);
});

test('U29 reports how many attempts failed', async () => {
  fetchMock.mockResolvedValue(
    respond(400, {
      code: 'VERIFICATION_CODE_MISMATCH',
      message: '',
      details: { failedCount: 2, maxAttempts: 5 },
    }),
  );

  const error = await verifyPhoneCode({
    phoneNumber: '01055556666',
    purpose: 'SIGN_UP',
    code: '000000',
  }).catch(caught => caught);
  expect(error.code).toBe('VERIFICATION_CODE_MISMATCH');
  expect(error.failedCount).toBe(2);
});

test('U30 posts the proof and new password without a token and settles on 204', async () => {
  tokenStore.hold({ accessToken: 'old', refreshToken: 'old' });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 204,
    text: async () => '',
    json: async () => undefined,
  });

  await expect(
    resetPassword({ verificationToken: 'proof-2', newPassword: 'NewRunner9!' }),
  ).resolves.toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/auth/password-reset`);
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    verificationToken: 'proof-2',
    newPassword: 'NewRunner9!',
  });
  expect(init.headers.Authorization).toBeUndefined();
});

test('U15 sends the phone proof with the sign-up', async () => {
  fetchMock.mockResolvedValue(
    respond(201, {
      user: { id: 103, loginId: 'newrunner' },
      accessToken: 'access-3',
      refreshToken: 'refresh-3',
      expiresInSec: 600,
      refreshExpiresAt: '2026-12-02T01:00:00Z',
      onboardingCompleted: false,
    }),
  );

  await signUp({
    loginId: 'newrunner',
    password: 'runway123',
    nickname: '러너',
    birthDate: '1991-02-28',
    gender: 'MALE',
    phoneNumber: '01055556666',
    healthDataAccess: 'DISAGREE',
    phoneVerificationToken: 'proof-3',
  });
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body).phoneVerificationToken).toBe('proof-3');
});
