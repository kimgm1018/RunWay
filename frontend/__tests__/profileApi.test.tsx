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

const runningProfile = {
  selfReportedLevel: 'INTERMEDIATE',
  baselineDistanceM: 5000,
  baselineDurationSec: 1800,
  usualPaceSecPerKm: 360,
  onboardingCompleted: true,
  updatedAt: '2026-11-02T03:00:00Z',
};

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
      if (path === '/users/me/running-profile') {
        return respond(200, runningProfile);
      }
      if (path === '/devices') {
        return respond(200, { items: [] });
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
  await press(screen!, '설정');
  await press(screen!, '내 프로필 보기');
  await press(screen!, '프로필 수정');
  return screen!;
}

beforeEach(async () => {
  me = { ...me, nickname: '새벽러너', profileImageUrl: null };
  nicknameTaken = false;
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

  expect(texts(screen!)).toContain('새벽러너님,');
  const avatar = labelled(screen!, '내 프로필');
  const photo = avatar.findAll(node => node.props.source?.uri !== undefined)[0];
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
