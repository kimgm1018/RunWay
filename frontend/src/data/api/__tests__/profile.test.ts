import { appConfig } from '../../../config';
import {
  changePhoto,
  getDetail,
  getMe,
  getRunningProfile,
  saveRunningProfile,
  updateBasic,
} from '../profile';
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

const me = {
  id: 101,
  nickname: '새벽러너',
  gender: 'FEMALE',
  birthDate: '1998-04-12',
  loginId: 'runner01',
  status: 'ACTIVE',
  profileImageUrl: '/api/v1/images/550e8400-e29b-41d4-a716-446655440000',
  onboardingCompleted: true,
};

const meUrl = `${appConfig.apiBaseUrl}/users/me`;

test('U04 gives my id, nickname and the full photo address', async () => {
  fetchMock.mockResolvedValue(respond(200, me));

  await expect(getMe()).resolves.toEqual({
    id: '101',
    nickname: '새벽러너',
    profileImageUrl:
      'https://k15e105.p.ssafy.io/api/v1/images/550e8400-e29b-41d4-a716-446655440000',
  });
  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(meUrl);
  expect(init.method).toBe('GET');
});

test('U04 without a photo leaves it null for the initial', async () => {
  fetchMock.mockResolvedValue(respond(200, { ...me, profileImageUrl: null }));
  await expect(getMe()).resolves.toMatchObject({ profileImageUrl: null });
});

test('8.2 takes the account part from U04 and the level and pace from U06', async () => {
  fetchMock.mockImplementation(async (requested: string) =>
    respond(200, requested === url ? saved : me),
  );

  await expect(getDetail()).resolves.toEqual({
    nickname: '새벽러너',
    gender: 'FEMALE',
    birthDate: '1998-04-12',
    runningLevel: 'BEGINNER',
    baseline: {
      baselineDistanceM: 5000,
      baselineDurationSec: 1800,
      usualPaceSecPerKm: 360,
    },
  });
});

test('U05 sends the nickname, gender and birth date in one PATCH', async () => {
  fetchMock.mockResolvedValue(respond(200, me));

  await updateBasic({
    nickname: '새벽러너',
    gender: 'FEMALE',
    birthDate: '1998-04-12',
  });

  const [requested, init] = fetchMock.mock.calls[0];
  expect(requested).toBe(meUrl);
  expect(init.method).toBe('PATCH');
  expect(sentBody()).toEqual({
    nickname: '새벽러너',
    gender: 'FEMALE',
    birthDate: '1998-04-12',
  });
});

test('U05 passes a taken nickname on as its code', async () => {
  fetchMock.mockResolvedValue(
    respond(409, { code: 'NICKNAME_DUPLICATED', message: '', details: {} }),
  );
  await expect(
    updateBasic({ nickname: '민준', gender: 'MALE', birthDate: '1995-01-01' }),
  ).rejects.toMatchObject({ code: 'NICKNAME_DUPLICATED' });
});

test('8.2 사진: F01 upload with PROFILE, then U05 with the image id', async () => {
  fetchMock
    .mockResolvedValueOnce(
      respond(201, {
        imageId: '550e8400-e29b-41d4-a716-446655440000',
        url: null,
      }),
    )
    .mockResolvedValueOnce(respond(200, me));

  await expect(
    changePhoto({
      uri: 'file:///cache/picked.jpg',
      type: 'image/jpeg',
      name: 'picked.jpg',
    }),
  ).resolves.toBe(
    'https://k15e105.p.ssafy.io/api/v1/images/550e8400-e29b-41d4-a716-446655440000',
  );
  const [[uploadUrl, uploadInit], [patchUrl, patchInit]] = fetchMock.mock.calls;
  expect(uploadUrl).toBe(`${appConfig.apiBaseUrl}/images`);
  expect(uploadInit.method).toBe('POST');
  expect(patchUrl).toBe(meUrl);
  expect(JSON.parse(patchInit.body)).toEqual({
    profileImageId: '550e8400-e29b-41d4-a716-446655440000',
  });
});
