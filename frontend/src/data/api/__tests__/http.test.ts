import { appConfig } from '../../../config';
import { DataError } from '../../errors';
import { apiRequest, onUnauthorized } from '../http';
import { uploadImage } from '../images';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError('empty body');
      }
      return body;
    },
  };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error as DataError;
  }
  throw new Error('expected the request to fail');
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

test('sends JSON to the base URL with the access token', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock.mockResolvedValue(respond(200, { id: 7 }));

  const result = await apiRequest<{ id: number }>('/users/me/settings', {
    method: 'PATCH',
    body: { pushEnabled: false },
    query: { view: 'all', page: undefined },
  });

  expect(result).toEqual({ id: 7 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/users/me/settings?view=all`);
  expect(init.method).toBe('PATCH');
  expect(init.body).toBe('{"pushEnabled":false}');
  expect(init.headers).toMatchObject({
    Authorization: 'Bearer access-1',
    'Content-Type': 'application/json',
  });
});

test('public endpoints go without the access token', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock.mockResolvedValue(respond(200, { available: true }));

  await apiRequest('/auth/login-id/check', { auth: false });

  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

test('a 204 resolves without a body', async () => {
  fetchMock.mockResolvedValue(respond(204));
  await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBe(
    undefined,
  );
});

test('a server code the screens know is kept with its message', async () => {
  fetchMock.mockResolvedValue(
    respond(401, {
      code: 'INVALID_CREDENTIALS',
      message: '아이디 또는 비밀번호가 올바르지 않습니다.',
      details: { failedCount: 2 },
    }),
  );

  const error = await failure(
    apiRequest('/auth/login', { method: 'POST', body: {}, auth: false }),
  );

  expect(error.code).toBe('INVALID_CREDENTIALS');
  expect(error.message).toBe('아이디 또는 비밀번호가 올바르지 않습니다.');
  expect(error.failedCount).toBe(2);
});

test('an expired access token becomes UNAUTHORIZED and signs out', async () => {
  await tokenStore.save({ accessToken: 'old', refreshToken: 'refresh-1' });
  const listener = jest.fn();
  const unsubscribe = onUnauthorized(listener);
  fetchMock.mockResolvedValue(
    respond(401, {
      code: 'UNAUTHORIZED',
      message: '인증이 필요합니다.',
      details: {},
    }),
  );

  const error = await failure(apiRequest('/users/me'));

  expect(error.code).toBe('UNAUTHORIZED');
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test('a wrong password on a public endpoint does not sign out', async () => {
  const listener = jest.fn();
  const unsubscribe = onUnauthorized(listener);
  fetchMock.mockResolvedValue(respond(401, { code: 'INVALID_CREDENTIALS' }));

  await failure(apiRequest('/auth/login', { method: 'POST', auth: false }));

  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('5xx without a domain code becomes SERVER_ERROR', async () => {
  fetchMock.mockResolvedValue(
    respond(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: '일시적으로 처리할 수 없습니다.',
    }),
  );

  const error = await failure(apiRequest('/running-records'));

  expect(error.code).toBe('SERVER_ERROR');
  expect(error.status).toBe(503);
  expect(error.message).toBe('일시적으로 처리할 수 없습니다.');
});

test('an unreadable error body still becomes a DataError', async () => {
  fetchMock.mockResolvedValue(respond(500));
  const error = await failure(apiRequest('/running-records'));
  expect(error.code).toBe('SERVER_ERROR');
});

test('other 4xx codes the app does not know become UNKNOWN', async () => {
  fetchMock.mockResolvedValue(respond(409, { code: 'CREW_NAME_DUPLICATED' }));
  const error = await failure(apiRequest('/crews', { method: 'POST' }));
  expect(error.code).toBe('UNKNOWN');
});

test('no connection becomes NETWORK_ERROR', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const error = await failure(apiRequest('/users/me'));
  expect(error.code).toBe('NETWORK_ERROR');
  expect(error.status).toBeNull();
});

test('a request past the timeout is aborted as NETWORK_ERROR', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new Error('Aborted')),
        ),
      ),
  );

  const pending = failure(apiRequest('/users/me', { timeoutMs: 1000 }));
  jest.advanceTimersByTime(1000);
  const error = await pending;

  expect(error.code).toBe('NETWORK_ERROR');
  jest.useRealTimers();
});

test('F01 uploads the image as multipart and returns its imageId', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock.mockResolvedValue(
    respond(201, {
      imageId: '550e8400-e29b-41d4-a716-446655440000',
      url: null,
    }),
  );

  const image = await uploadImage(
    { uri: 'file:///photo.jpg', type: 'image/jpeg', name: 'photo.jpg' },
    'PROFILE',
  );

  expect(image).toEqual({
    imageId: '550e8400-e29b-41d4-a716-446655440000',
    url: null,
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${appConfig.apiBaseUrl}/images`);
  expect(init.body).toBeInstanceOf(FormData);
  // fetch sets the multipart boundary itself.
  expect(init.headers['Content-Type']).toBeUndefined();
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

// S15P31E105-256: 409 ACTIVE_SESSION_EXISTS의 details.sessionId로 기존 세션을 복구한다(sessions.md S01).
test('the error details are kept for recovery', async () => {
  fetchMock.mockResolvedValue(
    respond(409, {
      code: 'ACTIVE_SESSION_EXISTS',
      message: '진행 중인 러닝 세션이 있습니다.',
      details: { sessionId: 201 },
    }),
  );

  const error = await failure(
    apiRequest('/running-sessions', { method: 'POST', body: {} }),
  );

  expect(error.code).toBe('ACTIVE_SESSION_EXISTS');
  expect(error.details).toEqual({ sessionId: 201 });
});

const rotated = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresInSec: 599,
  refreshExpiresAt: '2026-12-01T00:00:00Z',
};

test('refreshes a rejected member request once and persists both rotated tokens before replay', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock
    .mockResolvedValueOnce(respond(401, { code: 'UNAUTHORIZED' }))
    .mockResolvedValueOnce(respond(200, rotated))
    .mockResolvedValueOnce(respond(200, { id: 7 }));
  await expect(apiRequest('/users/me')).resolves.toEqual({ id: 7 });
  expect(fetchMock.mock.calls[1][0]).toBe(
    `${appConfig.apiBaseUrl}/auth/refresh`,
  );
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    refreshToken: 'refresh-1',
  });
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
    'Bearer access-2',
  );
  expect(tokenStore.current()?.refreshToken).toBe('refresh-2');
  await expect(tokenStore.load()).resolves.toMatchObject({
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
  });
});

test('concurrent and delayed 401 responses share one rotation and each replay once', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  let late!: (response: ReturnType<typeof respond>) => void;
  fetchMock.mockImplementation(
    async (url: string, init: { headers: Record<string, string> }) => {
      if (url.endsWith('/auth/refresh')) return respond(200, rotated);
      if (init.headers.Authorization === 'Bearer access-2')
        return respond(200, { ok: true });
      if (url.endsWith('/late'))
        return new Promise(resolve => {
          late = resolve;
        });
      return respond(401, { code: 'UNAUTHORIZED' });
    },
  );
  const delayed = apiRequest('/late');
  await expect(
    Promise.all([apiRequest('/one'), apiRequest('/two')]),
  ).resolves.toEqual([{ ok: true }, { ok: true }]);
  late(respond(401, { code: 'UNAUTHORIZED' }));
  await expect(delayed).resolves.toEqual({ ok: true });
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh')),
  ).toHaveLength(1);
  expect(fetchMock.mock.calls).toHaveLength(7);
});

test.each([401, 503])(
  'a failed refresh (%i) expires once without replay or exposing its body',
  async status => {
    await tokenStore.save({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    const expired = jest.fn();
    const unsubscribe = onUnauthorized(expired);
    try {
      fetchMock
        .mockResolvedValueOnce(respond(401, { code: 'UNAUTHORIZED' }))
        .mockResolvedValueOnce(
          respond(status, {
            message: 'secret-refresh-value',
            details: { token: 'secret' },
          }),
        );
      const error = await failure(apiRequest('/users/me'));
      expect(error.code).toBe('UNAUTHORIZED');
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(expired).toHaveBeenCalledTimes(1);
      expect(tokenStore.current()).toBeNull();
    } finally {
      unsubscribe();
    }
  },
);

test('a replay rejected again expires without a second refresh', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockResolvedValueOnce(respond(200, rotated))
    .mockResolvedValueOnce(respond(401));
  expect((await failure(apiRequest('/users/me'))).code).toBe('UNAUTHORIZED');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(tokenStore.current()).toBeNull();
});

test('logout and a new login discard an old refresh response without replaying into the new account', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  let finish!: (response: ReturnType<typeof respond>) => void;
  fetchMock.mockResolvedValueOnce(respond(401)).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = failure(apiRequest('/users/me'));
  await new Promise<void>(resolve => setImmediate(resolve));
  await tokenStore.clear();
  await tokenStore.save({
    accessToken: 'other-access',
    refreshToken: 'other-refresh',
  });
  finish(respond(200, rotated));
  await pending;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()?.accessToken).toBe('other-access');
  await expect(tokenStore.load()).resolves.toMatchObject({
    refreshToken: 'other-refresh',
  });
});

test('403 and public 401 never attempt token rotation', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock
    .mockResolvedValueOnce(respond(403))
    .mockResolvedValueOnce(respond(401));
  await failure(apiRequest('/users/me'));
  await failure(apiRequest('/auth/login', { auth: false }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()?.accessToken).toBe('access-1');
});

test('a lost refresh response is not resent and clears the session', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockRejectedValueOnce(new Error('secret transport body'));
  const error = await failure(apiRequest('/users/me'));
  expect(error.code).toBe('UNAUTHORIZED');
  expect(error.message).not.toContain('secret');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()).toBeNull();
});

test('a keystore rotation failure ends the session without replay', async () => {
  const keychain = require('react-native-keychain');
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  keychain.setGenericPassword.mockRejectedValueOnce(
    new Error('storage locked'),
  );
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockResolvedValueOnce(respond(200, rotated));
  await failure(apiRequest('/users/me'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()).toBeNull();
  await expect(tokenStore.load()).resolves.toBeNull();
});

test('rotating held onboarding credentials does not persist an unfinished login', async () => {
  tokenStore.hold({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  });
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockResolvedValueOnce(respond(200, rotated))
    .mockResolvedValueOnce(respond(200, {}));
  await apiRequest('/users/me/running-profile');
  expect(tokenStore.current()).toMatchObject({
    accessToken: 'access-2',
  });
  await expect(tokenStore.load()).resolves.toBeNull();
});

test('a malformed successful refresh response fails closed', async () => {
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockResolvedValueOnce(respond(200, { ...rotated, refreshToken: '' }));
  expect((await failure(apiRequest('/users/me'))).code).toBe('UNAUTHORIZED');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()).toBeNull();
});

test('a keystore false result cannot be mistaken for persisted rotated tokens', async () => {
  const keychain = require('react-native-keychain');
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  keychain.setGenericPassword.mockResolvedValueOnce(false);
  fetchMock
    .mockResolvedValueOnce(respond(401))
    .mockResolvedValueOnce(respond(200, rotated))
    .mockResolvedValueOnce(respond(200, {}));
  expect((await failure(apiRequest('/users/me'))).code).toBe('UNAUTHORIZED');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()).toBeNull();
});
