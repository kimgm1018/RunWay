import { appConfig } from '../../../config';
import { getRunningProfile, saveRunningProfile } from '../profile';
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

const saved = {
  selfReportedLevel: 'BEGINNER',
  baselineDistanceM: 5000,
  baselineDurationSec: 1800,
  usualPaceSecPerKm: 360,
  onboardingCompleted: true,
  updatedAt: '2026-11-02T03:00:00Z',
};

const url = `${appConfig.apiBaseUrl}/users/me/running-profile`;

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('U06 returns the saved profile with the token', async () => {
  fetchMock.mockResolvedValue(respond(200, saved));

  await expect(getRunningProfile()).resolves.toEqual({
    selfReportedLevel: 'BEGINNER',
    baselineDistanceM: 5000,
    baselineDurationSec: 1800,
    usualPaceSecPerKm: 360,
    onboardingCompleted: true,
  });
  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(url);
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer access-1');
});

test('U06 without a profile resolves to null', async () => {
  fetchMock.mockResolvedValue(
    respond(404, { code: 'PROFILE_NOT_SET', message: '', details: {} }),
  );
  await expect(getRunningProfile()).resolves.toBeNull();
});

test('U06 passes other failures on', async () => {
  fetchMock.mockResolvedValue(
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
  );
  await expect(getRunningProfile()).rejects.toMatchObject({
    code: 'SERVER_ERROR',
  });
});

test('U07 sends the level and a distance·time entry flat in one PATCH', async () => {
  fetchMock.mockResolvedValue(respond(200, saved));

  await saveRunningProfile({
    selfReportedLevel: 'BEGINNER',
    pace: {
      inputType: 'DISTANCE_TIME',
      baselineDistanceM: 5000,
      baselineDurationSec: 1800,
      usualPaceSecPerKm: 360,
    },
  });

  expect(fetchMock.mock.calls[0][0]).toBe(url);
  expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  expect(sentBody()).toEqual({
    selfReportedLevel: 'BEGINNER',
    inputType: 'DISTANCE_TIME',
    baselineDistanceM: 5000,
    baselineDurationSec: 1800,
    usualPaceSecPerKm: 360,
  });
});

test('U07 with a typed pace leaves distance and time out', async () => {
  fetchMock.mockResolvedValue(
    respond(200, {
      ...saved,
      baselineDistanceM: null,
      baselineDurationSec: null,
      usualPaceSecPerKm: 400,
    }),
  );

  const profile = await saveRunningProfile({
    selfReportedLevel: 'ADVANCED',
    pace: { inputType: 'PACE', usualPaceSecPerKm: 400 },
  });

  expect(sentBody()).toEqual({
    selfReportedLevel: 'ADVANCED',
    inputType: 'PACE',
    usualPaceSecPerKm: 400,
  });
  expect(profile.baselineDistanceM).toBeNull();
});

test('U07 with the level alone sends only the level', async () => {
  fetchMock.mockResolvedValue(respond(200, saved));
  await saveRunningProfile({ selfReportedLevel: 'INTERMEDIATE' });
  expect(sentBody()).toEqual({ selfReportedLevel: 'INTERMEDIATE' });
});
