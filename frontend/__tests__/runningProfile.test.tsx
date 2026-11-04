import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';

// 1.6 러닝 프로필 and the level on 8.2 against the server (dataSource 'api'): U06 loads, one U07 PATCH saves.

jest.mock('../src/health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
  refreshWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));
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

const notSet = respond(404, {
  code: 'PROFILE_NOT_SET',
  message: '',
  details: {},
});

function profileResponse(fields: Record<string, unknown> = {}) {
  return respond(200, {
    selfReportedLevel: 'INTERMEDIATE',
    baselineDistanceM: 5000,
    baselineDurationSec: 1800,
    usualPaceSecPerKm: 360,
    onboardingCompleted: true,
    updatedAt: '2026-11-02T03:00:00Z',
    ...fields,
  });
}

const me = {
  id: 101,
  nickname: '민준',
  gender: 'MALE',
  birthDate: '1995-03-14',
  loginId: 'minjun01',
  status: 'ACTIVE',
  profileImageUrl: null,
  onboardingCompleted: true,
};

// U01 for an account that has not finished setup, U06 with `saved`, U07 with `onSave` (default: success).
function serve(
  saved: ReturnType<typeof respond>,
  onSave: ReturnType<typeof respond> = profileResponse(),
) {
  fetchMock.mockImplementation(
    async (url: string, init: { method: string }) => {
      if (url.endsWith('/auth/login')) {
        return respond(200, {
          user: { id: 101, loginId: 'minjun01' },
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresInSec: 600,
          refreshExpiresAt: '2026-12-02T01:00:00Z',
          onboardingCompleted: false,
        });
      }
      if (url.endsWith('/users/me/running-profile')) {
        return init.method === 'PATCH' ? onSave : saved;
      }
      // U04·U05 for 8.1 and 8.2 (S15P31E105-321).
      if (url.endsWith('/users/me')) {
        return respond(200, me);
      }
      throw new Error(`unexpected request ${url}`);
    },
  );
}

function patchBodies() {
  return fetchMock.mock.calls
    .filter(([, init]) => init.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body));
}

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function all(screen: Screen, label: string, prop: string) {
  return screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
}

function last(screen: Screen, label: string, prop: string) {
  const matches = all(screen, label, prop);
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label} with ${prop}`);
  }
  return matches[matches.length - 1];
}

function fieldValue(screen: Screen, label: string) {
  const inputs = screen.root
    .findAllByType(TextInput)
    .filter(node => node.props.accessibilityLabel === label);
  return inputs.length ? inputs[inputs.length - 1].props.value : null;
}

function isDisabled(screen: Screen, label: string) {
  return Boolean(
    last(screen, label, 'onPress').props.accessibilityState?.disabled,
  );
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    last(screen, label, 'onPress').props.onPress();
  });
  await settle();
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    last(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function launch(signedIn = false) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App
        repositories={createApiRepositories({ latencyMs: 0 })}
        initialSignedIn={signedIn}
      />,
    );
  });
  await settle();
  return screen!;
}

// 1.2 로그인 with an account that still needs setup lands on 1.6.
async function openRunningProfile() {
  const screen = await launch();
  await press(screen, '로그인');
  await type(screen, '아이디', 'minjun01');
  await type(screen, '비밀번호', 'runway123');
  await press(screen, '로그인');
  expect(texts(screen)).toContain('평소 어떻게');
  return screen;
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

test('distance and finish time save as DISTANCE_TIME in one PATCH', async () => {
  serve(notSet);
  const screen = await openRunningProfile();
  expect(isDisabled(screen, '저장')).toBe(true);

  await press(screen, '중급, 5–10km 주 2–3회');
  await type(screen, '거리', '5');
  await type(screen, '완주 시간', '30:00');
  expect(texts(screen)).toContain('6′00″/km');
  await press(screen, '저장');

  expect(patchBodies()).toEqual([
    {
      selfReportedLevel: 'INTERMEDIATE',
      inputType: 'DISTANCE_TIME',
      baselineDistanceM: 5000,
      baselineDurationSec: 1800,
      usualPaceSecPerKm: 360,
    },
  ]);
  expect(texts(screen)).toContain('함께 쓰나요?');
  await act(async () => screen.unmount());
});

test('the pace tab takes the pace alone and saves it as PACE', async () => {
  serve(notSet);
  const screen = await openRunningProfile();

  await press(screen, '상급, 하프 이상 주 4회+');
  await press(screen, '페이스');
  expect(fieldValue(screen, '거리')).toBeNull();
  expect(texts(screen)).not.toContain('자동 계산');
  await type(screen, '페이스 (분:초/km)', '6:40');
  await press(screen, '저장');

  expect(patchBodies()).toEqual([
    {
      selfReportedLevel: 'ADVANCED',
      inputType: 'PACE',
      usualPaceSecPerKm: 400,
    },
  ]);
  await act(async () => screen.unmount());
});

test('a profile saved with distance and time fills the 완주 시간 tab', async () => {
  serve(profileResponse({ selfReportedLevel: 'BEGINNER' }));
  const screen = await openRunningProfile();

  expect(fieldValue(screen, '거리')).toBe('5');
  expect(fieldValue(screen, '완주 시간')).toBe('30:00');
  expect(isDisabled(screen, '저장')).toBe(false);
  await press(screen, '저장');

  expect(patchBodies()[0]).toMatchObject({
    selfReportedLevel: 'BEGINNER',
    inputType: 'DISTANCE_TIME',
  });
  await act(async () => screen.unmount());
});

test('a profile saved as a pace fills the 페이스 tab', async () => {
  serve(
    profileResponse({
      baselineDistanceM: null,
      baselineDurationSec: null,
      usualPaceSecPerKm: 400,
    }),
  );
  const screen = await openRunningProfile();

  expect(fieldValue(screen, '거리')).toBeNull();
  expect(fieldValue(screen, '페이스 (분:초/km)')).toBe('6:40');
  await act(async () => screen.unmount());
});

test('a rejected pace shows a notice and stays on 1.6', async () => {
  serve(
    notSet,
    respond(422, {
      code: 'INVALID_RUNNING_BASELINE',
      message: '',
      details: {},
    }),
  );
  const screen = await openRunningProfile();
  await press(screen, '초급, 5km 미만 주 1회 이하');
  await press(screen, '페이스');
  await type(screen, '페이스 (분:초/km)', '6:00');
  await press(screen, '저장');

  expect(texts(screen)).toContain('평소 페이스를 확인하지 못했어요.');
  expect(texts(screen)).toContain('평소 어떻게');
  await act(async () => screen.unmount());
});

test('8.2 saves a level change with the level alone', async () => {
  // 8.1 also asks W02 for my watch; none is linked here. U04·U05 answer with my account.
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/devices')
      ? respond(200, { items: [] })
      : url.endsWith('/users/me')
      ? respond(200, me)
      : profileResponse({ selfReportedLevel: 'ADVANCED' }),
  );
  const screen = await launch(true);
  await press(screen, '설정');
  await press(screen, '내 프로필 보기');
  await settle(50);
  await press(screen, '프로필 수정');
  await settle(50);
  await press(screen, '상급');
  await press(screen, '저장');
  await settle(50);

  // U05 with the account part, then U07 with the level alone.
  expect(patchBodies()).toEqual([
    { nickname: '민준', gender: 'MALE', birthDate: '1995-03-14' },
    { selfReportedLevel: 'ADVANCED' },
  ]);
  expect(texts(screen)).toContain('프로필을 저장했어요');
  await act(async () => screen.unmount());
});
