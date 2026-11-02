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
