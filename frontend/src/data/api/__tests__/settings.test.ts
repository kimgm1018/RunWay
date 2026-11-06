import { appConfig } from '../../../config';
import { settingsApi } from '../settings';
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

const appUrl = `${appConfig.apiBaseUrl}/users/me/settings`;
const privacyUrl = `${appConfig.apiBaseUrl}/users/me/privacy-settings`;

const app = {
  voiceCoachingEnabled: true,
  bpmGuideEnabled: false,
  locationRecordingMode: 'RUNNING_ONLY',
  notifications: { groupRun: true, community: false },
};

// Answers by address and method, since U19 and U13 go out together.
function server(routes: Record<string, () => ReturnType<typeof respond>>) {
  fetchMock.mockImplementation(
    async (url: string, init: { method: string }) => {
      const route = routes[`${init.method} ${url}`];
      if (!route) {
        throw new Error(`unexpected ${init.method} ${url}`);
      }
      return route();
    },
  );
}

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    request: `${init.method} ${url}`,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  }));

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('get joins U19 and U13 into one AppSettings', async () => {
  server({
    [`GET ${appUrl}`]: () => respond(200, app),
    [`GET ${privacyUrl}`]: () => respond(200, { isPrivate: true }),
  });

  await expect(settingsApi.get()).resolves.toEqual({ ...app, isPrivate: true });
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer access-1',
  );
});

test('an app switch sends only that field with U20 and reads 계정 공개 again', async () => {
  server({
    [`PATCH ${appUrl}`]: () => respond(200, { ...app, bpmGuideEnabled: true }),
    [`GET ${privacyUrl}`]: () => respond(200, { isPrivate: false }),
  });

  await expect(settingsApi.update({ bpmGuideEnabled: true })).resolves.toEqual({
    ...app,
    bpmGuideEnabled: true,
    isPrivate: false,
  });
  expect(calls()).toContainEqual({
    request: `PATCH ${appUrl}`,
    body: { bpmGuideEnabled: true },
  });
  expect(calls()).toHaveLength(2);
});

test('a notification switch sends the notifications object as given', async () => {
  const notifications = { groupRun: false, community: false };
  server({
    [`PATCH ${appUrl}`]: () => respond(200, { ...app, notifications }),
    [`GET ${privacyUrl}`]: () => respond(200, { isPrivate: false }),
  });

  await settingsApi.update({ notifications });

  expect(calls()).toContainEqual({
    request: `PATCH ${appUrl}`,
    body: { notifications },
  });
});

test('계정 공개 goes to U14 and drops its updatedAt', async () => {
  server({
    [`GET ${appUrl}`]: () => respond(200, app),
    [`PATCH ${privacyUrl}`]: () =>
      respond(200, { isPrivate: true, updatedAt: '2026-11-06T01:00:00Z' }),
  });

  await expect(settingsApi.update({ isPrivate: true })).resolves.toEqual({
    ...app,
    isPrivate: true,
  });
  expect(calls()).toContainEqual({
    request: `PATCH ${privacyUrl}`,
    body: { isPrivate: true },
  });
  expect(calls().some(c => c.request === `PATCH ${appUrl}`)).toBe(false);
});

test('a failed save rejects so 8.1 can put the switch back', async () => {
  server({
    [`PATCH ${appUrl}`]: () =>
      respond(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: '잠시 후 다시 시도',
      }),
    [`GET ${privacyUrl}`]: () => respond(200, { isPrivate: false }),
  });

  await expect(
    settingsApi.update({ locationRecordingMode: 'OFF' }),
  ).rejects.toBeDefined();
});
