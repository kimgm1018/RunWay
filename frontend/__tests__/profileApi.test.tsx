import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 2.1, 8.1 and 8.2 against the server (dataSource 'api'): U04·U05 (S15P31E105-321).

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

let me = {
  id: 101,
  nickname: '새벽러너',
  gender: 'FEMALE',
  birthDate: '1998-04-12',
  loginId: 'runner01',
  status: 'ACTIVE',
  profileImageUrl: null as string | null,
  onboardingCompleted: true,
};
let nicknameTaken = false;
// F01's answer for the photo tests: the stored image id, or a failure status.
let upload: { status: number; code?: string } = { status: 201 };
const imageId = '550e8400-e29b-41d4-a716-446655440000';

const savedRunningProfile = {
  selfReportedLevel: 'INTERMEDIATE',
  baselineDistanceM: 5000 as number | null,
  baselineDurationSec: 1800 as number | null,
  usualPaceSecPerKm: 360,
  onboardingCompleted: true,
  updatedAt: '2026-11-02T03:00:00Z',
};
let runningProfile = { ...savedRunningProfile };
// U07's answer for the 8.2b tests: null saves, a code fails with 422.
let runningSaveFailure: string | null = null;

// U04·U05, U06·U07 and W02 for 8.1; the other sections fail on their own and are not under test.
function serve() {
  fetchMock.mockImplementation(
    async (requested: string, init: { method: string; body?: string }) => {
      const path = new URL(requested).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/users/me' && init.method === 'GET') {
        return respond(200, me);
      }
      if (path === '/users/me' && init.method === 'PATCH') {
        if (nicknameTaken) {
          return respond(409, {
            code: 'NICKNAME_DUPLICATED',
            message: '',
            details: {},
          });
        }
        const { profileImageId, ...basic } = JSON.parse(init.body!);
        me = {
          ...me,
          ...basic,
          ...(profileImageId
            ? { profileImageUrl: `/api/v1/images/${profileImageId}` }
            : {}),
        };
        return respond(200, me);
      }
      if (path === '/images' && init.method === 'POST') {
        return upload.status === 201
          ? respond(201, { imageId, url: null })
          : respond(upload.status, {
              code: upload.code,
              message: '',
              details: {},
            });
      }
      if (path === '/users/me/running-profile' && init.method === 'PATCH') {
        if (runningSaveFailure) {
          return respond(422, {
            code: runningSaveFailure,
            message: '',
            details: {},
          });
        }
        // U07 keeps what is left out; PACE clears the saved distance and time.
        const { inputType, ...fields } = JSON.parse(init.body!);
        runningProfile = {
          ...runningProfile,
          ...(inputType === 'PACE'
            ? { baselineDistanceM: null, baselineDurationSec: null }
            : {}),
          ...fields,
        };
        return respond(200, runningProfile);
      }
      if (path === '/users/me/running-profile') {
        return respond(200, runningProfile);
      }
      if (path === '/devices') {
        return respond(200, { items: [] });
      }
      // 7.4b (U21) with my H01 runs and H06 month (S15P31E105-524).
      if (path === `/users/${me.id}/profile`) {
        return respond(200, {
          userId: me.id,
          nickname: me.nickname,
          profileImageUrl: me.profileImageUrl,
          profileAccessible: true,
          followStatus: 'NONE',
          isFollowing: null,
          runningLevel: runningProfile.selfReportedLevel,
          followerCount: 3,
          followingCount: 5,
          posts: [],
        });
      }
      if (path === '/running-records') {
        return respond(200, { items: [] });
      }
      if (path === '/running-records/statistics') {
        return respond(200, {
          runCount: 0,
          totalDistanceM: 0,
          totalDurationSec: 0,
          averagePaceSecPerKm: null,
          breakdown: [],
          heartRateZones: [],
          previousPeriod: null,
        });
      }
      return respond(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: '',
        details: {},
      });
    },
  );
}

const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init.method === 'PATCH')
    .map(([address, init]) => [
      new URL(address).pathname.replace(/^.*\/api\/v1/, ''),
      JSON.parse(init.body),
    ]);

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    labelled(screen, label).props.onPress();
  });
  await settle();
  await settle();
}

async function type(screen: Screen, label: string, value: string) {
  const inputs = screen.root.findAll(
    node => node.type === TextInput && node.props.accessibilityLabel === label,
  );
  await act(async () => {
    inputs[inputs.length - 1].props.onChangeText(value);
  });
}

async function openProfileEdit() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await settle();
  // 8.1 has no profile card now (runway-settings), so 7.4b is the 프로필 tab.
  await press(screen!, '프로필');
  await press(screen!, '프로필 수정');
  return screen!;
}

beforeEach(async () => {
  me = { ...me, nickname: '새벽러너', profileImageUrl: null };
  nicknameTaken = false;
  runningProfile = { ...savedRunningProfile };
  runningSaveFailure = null;
  upload = { status: 201 };
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  serve();
});

test('2.1 greets me with my U04 nickname and shows the U04 photo', async () => {
  me = {
    ...me,
    profileImageUrl: '/api/v1/images/550e8400-e29b-41d4-a716-446655440000',
  };
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn
      />,
    );
  });
  await settle();
  await settle();

  // 2.1 greets me with the U04 nickname beside the U04 photo (S15P31E105-564).
  expect(texts(screen!)).toContain(`${me.nickname}님`);
  const photo = screen!.root.findAll(
    node =>
      node.props.source?.uri !== undefined && typeof node.type === 'string',
  )[0];
  expect(photo.props.source.uri).toBe(
    'https://k15e105.p.ssafy.io/api/v1/images/550e8400-e29b-41d4-a716-446655440000',
  );
  await act(async () => screen!.unmount());
});

test('8.2 opens with U04 and U06 and saves the nickname with U05', async () => {
  const screen = await openProfileEdit();
  expect(texts(screen)).toContain('5km · 30:00 · 6′00″/km');

  await type(screen, '닉네임', '한강러너');
  await press(screen, '저장');

  expect(patches()).toEqual([
    [
      '/users/me',
      { nickname: '한강러너', gender: 'FEMALE', birthDate: '1998-04-12' },
    ],
    ['/users/me/running-profile', { selfReportedLevel: 'INTERMEDIATE' }],
  ]);
  expect(texts(screen)).toContain('프로필을 저장했어요');
  await act(async () => screen.unmount());
});

test('8.2 marks a nickname U05 finds taken and keeps 저장 off until it changes', async () => {
  nicknameTaken = true;
  const screen = await openProfileEdit();

  await type(screen, '닉네임', '민준');
  await press(screen, '저장');

  expect(texts(screen)).toContain('이미 사용 중인 닉네임이에요');
  expect(labelled(screen, '저장').props.accessibilityState.disabled).toBe(true);
  await type(screen, '닉네임', '민준2');
  expect(labelled(screen, '저장').props.accessibilityState.disabled).toBe(
    false,
  );
  await act(async () => screen.unmount());
});

// What the phone's photo picker answers next (react-native-image-picker is mocked in jest.setup.js).
function pickNext(asset: Record<string, unknown>) {
  (
    require('react-native-image-picker').launchImageLibrary as jest.Mock
  ).mockResolvedValueOnce({ assets: [asset] });
}

const picked = {
  uri: 'file:///cache/picked.jpg',
  type: 'image/jpeg',
  fileName: 'picked.jpg',
  fileSize: 820_000,
};

const uploads = () =>
  fetchMock.mock.calls.filter(
    ([address, init]) =>
      init.method === 'POST' && new URL(address).pathname.endsWith('/images'),
  );

test('8.2 uploads the picked photo with F01 and saves it as U05 profileImageId', async () => {
  const screen = await openProfileEdit();
  pickNext(picked);
  await press(screen, '프로필 사진 바꾸기');
  // Shown at once, sent only with 저장.
  expect(uploads()).toHaveLength(0);

  await press(screen, '저장');

  const [[, init]] = uploads();
  expect(init.body).toBeInstanceOf(FormData);
  expect(patches()[0]).toEqual(['/users/me', { profileImageId: imageId }]);
  expect(texts(screen)).toContain('프로필을 저장했어요');
  await act(async () => screen.unmount());
});

test('8.2 turns down a photo that is not JPG or PNG before uploading', async () => {
  const screen = await openProfileEdit();
  pickNext({ ...picked, type: 'image/heic', fileName: 'picked.heic' });
  await press(screen, '프로필 사진 바꾸기');

  expect(texts(screen)).toContain('JPG나 PNG 사진만 쓸 수 있어요');
  await press(screen, '저장');
  expect(uploads()).toHaveLength(0);
  await act(async () => screen.unmount());
});

test('8.2 says the photo is too large when F01 refuses it and saves nothing else', async () => {
  upload = { status: 413, code: 'FILE_TOO_LARGE' };
  const screen = await openProfileEdit();
  pickNext(picked);
  await press(screen, '프로필 사진 바꾸기');
  await type(screen, '닉네임', '한강러너');

  await press(screen, '저장');

  expect(texts(screen)).toContain(
    '사진이 너무 커요. 5MB 이하의 사진을 골라 주세요',
  );
  expect(patches()).toEqual([]);
  expect(labelled(screen, '저장').props.accessibilityState.disabled).toBe(
    false,
  );
  await act(async () => screen.unmount());
});

// 8.2b 평소 러닝 정보 (S15P31E105-551): U06 fills it, U07 saves the pace part only.

const runningGets = () =>
  fetchMock.mock.calls.filter(
    ([address, init]) =>
      init.method === 'GET' &&
      new URL(address).pathname.endsWith('/users/me/running-profile'),
  );

function inputValue(screen: Screen, label: string) {
  const inputs = screen.root.findAll(
    node => node.type === TextInput && node.props.accessibilityLabel === label,
  );
  return inputs[inputs.length - 1].props.value;
}

const saveDisabled = (screen: Screen) =>
  labelled(screen, '저장').props.accessibilityState.disabled;

async function openBaselineEdit() {
  const screen = await openProfileEdit();
  await press(screen, `기본 목표 · 평소 페이스 5km · 30:00 · 6′00″/km`);
  return screen;
}

test('8.2b opens with the saved distance and time and saves only the pace part with U07', async () => {
  const screen = await openProfileEdit();
  // Unsaved answers on 8.2 stay as typed and are not sent by 8.2b.
  await type(screen, '닉네임', '한강러너');
  await press(screen, `기본 목표 · 평소 페이스 5km · 30:00 · 6′00″/km`);

  expect(inputValue(screen, '거리')).toBe('5');
  expect(inputValue(screen, '완주 시간')).toBe('30:00');
  // Nothing changed yet, so there is nothing to save.
  expect(saveDisabled(screen)).toBe(true);

  await type(screen, '완주 시간', '25:00');
  expect(texts(screen)).toContain('5′00″');
  const readsBefore = runningGets().length;
  await press(screen, '저장');

  expect(patches()).toEqual([
    [
      '/users/me/running-profile',
      {
        inputType: 'DISTANCE_TIME',
        baselineDistanceM: 5000,
        baselineDurationSec: 1500,
        usualPaceSecPerKm: 300,
      },
    ],
  ]);
  // Back on 8.2 the line is read again from U06; the nickname typed earlier is still there, unsaved.
  expect(runningGets().length).toBeGreaterThan(readsBefore);
  expect(texts(screen)).toContain('5km · 25:00 · 5′00″/km');
  expect(texts(screen)).toContain('평소 러닝 정보를 저장했어요');
  expect(inputValue(screen, '닉네임')).toBe('한강러너');
  // Only the profile is touched: no run session or goal call.
  expect(
    fetchMock.mock.calls.filter(([address]) =>
      /\/sessions|\/goals/.test(new URL(address).pathname),
    ),
  ).toEqual([]);

  // 8.2 저장 then still sends the level alone, so the new pace stays.
  await press(screen, '저장');
  expect(patches()[2]).toEqual([
    '/users/me/running-profile',
    { selfReportedLevel: 'INTERMEDIATE' },
  ]);
  expect(runningProfile.usualPaceSecPerKm).toBe(300);
  await act(async () => screen.unmount());
});

test('8.2b saves a pace typed on the 페이스 tab as U07 PACE', async () => {
  const screen = await openBaselineEdit();
  await press(screen, '페이스');
  // Loaded values do not follow the tab; the time is cleared as on 1.6b.
  expect(inputValue(screen, '페이스 (분:초/km)')).toBe('');
  await type(screen, '페이스 (분:초/km)', '530');
  await press(screen, '저장');

  expect(patches()).toEqual([
    [
      '/users/me/running-profile',
      { inputType: 'PACE', usualPaceSecPerKm: 330 },
    ],
  ]);
  expect(texts(screen)).toContain('5′30″/km');
  expect(texts(screen)).not.toContain('5km · ');
  await act(async () => screen.unmount());
});

test('8.2b opens a pace saved without distance on the 페이스 tab', async () => {
  runningProfile = {
    ...runningProfile,
    baselineDistanceM: null,
    baselineDurationSec: null,
    usualPaceSecPerKm: 400,
  };
  const screen = await openProfileEdit();
  await press(screen, '기본 목표 · 평소 페이스 6′40″/km');

  expect(inputValue(screen, '페이스 (분:초/km)')).toBe('6:40');
  expect(saveDisabled(screen)).toBe(true);
  await act(async () => screen.unmount());
});

test('8.2b keeps 저장 off for a pace that cannot be right', async () => {
  const screen = await openBaselineEdit();
  // 5km in one minute is 12 seconds a km.
  await type(screen, '완주 시간', '1:00');

  expect(saveDisabled(screen)).toBe(true);
  expect(texts(screen)).toContain(
    '거리는 km, 완주 시간은 30:00처럼 입력해 주세요',
  );
  await press(screen, '저장');
  expect(patches()).toEqual([]);
  await act(async () => screen.unmount());
});

test('8.2b stays open with the typed values when U07 turns the pace down', async () => {
  runningSaveFailure = 'INVALID_RUNNING_BASELINE';
  const screen = await openBaselineEdit();
  await type(screen, '완주 시간', '25:00');
  await press(screen, '저장');

  expect(texts(screen)).toContain(
    '평소 페이스를 확인하지 못했어요. 입력한 값을 다시 확인해 주세요.',
  );
  expect(inputValue(screen, '완주 시간')).toBe('25:00');
  expect(saveDisabled(screen)).toBe(false);
  expect(runningProfile.baselineDurationSec).toBe(1800);
  await act(async () => screen.unmount());
});

test('8.2b sends one U07 for a double tap on 저장', async () => {
  const screen = await openBaselineEdit();
  await type(screen, '완주 시간', '25:00');
  await act(async () => {
    const save = labelled(screen, '저장');
    save.props.onPress();
    save.props.onPress();
  });
  await settle();
  await settle();

  expect(patches()).toHaveLength(1);
  await act(async () => screen.unmount());
});

test('8.2b back leaves without saving and 8.2 shows the saved values', async () => {
  const screen = await openBaselineEdit();
  await type(screen, '완주 시간', '25:00');
  await press(screen, '뒤로');

  expect(patches()).toEqual([]);
  expect(texts(screen)).toContain('5km · 30:00 · 6′00″/km');
  await act(async () => screen.unmount());
});
