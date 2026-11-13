import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import { refreshWatchHealthConsent } from '../src/health/watchHealth';

// 1.2 로그인 against the server (dataSource 'api'): U01 is the only API here, the rest stays on mock data.

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

function loginResponse(onboardingCompleted: boolean) {
  return respond(200, {
    user: { id: 101, loginId: 'minjun01' },
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresInSec: 600,
    refreshExpiresAt: '2026-12-02T01:00:00Z',
    onboardingCompleted,
  });
}

// Home asks the server for my runs (H01·H06); a new account has none.
function serveHome(onboardingCompleted: boolean) {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/auth/login')
      ? loginResponse(onboardingCompleted)
      : url.includes('/running-records/statistics')
      ? respond(200, {
          runCount: 0,
          totalDistanceM: 0,
          totalDurationSec: 0,
          averagePaceSecPerKm: null,
          breakdown: [],
          heartRateZones: [],
          previousPeriod: null,
        })
      : respond(200, { items: [] }),
  );
}

const loginCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'));

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function last(screen: Screen, label: string, prop: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label} with ${prop}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    last(screen, label, 'onPress').props.onPress();
  });
  await settle();
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    last(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function launch() {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={createApiRepositories({ latencyMs: 0 })} />,
    );
  });
  await settle();
  return screen!;
}

async function login(screen: Screen, password = 'runway123') {
  await press(screen, '시작하기'); // 1.1 시작하기 opens 1.2 로그인
  await type(screen, '아이디', 'minjun01');
  await type(screen, '비밀번호', password);
  await press(screen, '로그인');
}

beforeEach(async () => {
  jest.mocked(refreshWatchHealthConsent).mockClear();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

test('a completed account enters home and stays signed in after a relaunch', async () => {
  serveHome(true);
  const first = await launch();
  // Signed out at launch: the watch only gets a withdrawal whose delivery failed.
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(1);
  await login(first);

  expect(texts(first)).toContain('러닝 시작하기');
  // S15P31E105-313: the login hands the consent to the watch again.
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(2);
  expect(tokenStore.current()).toEqual({
    userId: 101,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    refreshExpiresAt: '2026-12-02T01:00:00Z',
  });
  await act(async () => first.unmount());

  const relaunch = await launch();
  expect(texts(relaunch)).toContain('러닝 시작하기');
  expect(tokenStore.current()?.refreshExpiresAt).toBe('2026-12-02T01:00:00Z');
  // The restored session refreshes the watch consent as well.
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(3);
  // The kept tokens sign in again without another login.
  expect(loginCalls()).toHaveLength(1);
  await act(async () => relaunch.unmount());
});

test('an account without a running profile goes to 1.6 and a relaunch starts signed out', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/auth/login')
      ? loginResponse(false)
      : respond(404, { code: 'PROFILE_NOT_SET', message: '', details: {} }),
  );
  const first = await launch();
  await login(first);

  expect(texts(first)).toContain('평소 어떻게');
  // 1.6 asks U06 for a saved profile with the held token.
  const [, profileRequest] = fetchMock.mock.calls[1];
  expect(profileRequest.headers.Authorization).toBe('Bearer access-1');
  await act(async () => first.unmount());

  const relaunch = await launch();
  expect(texts(relaunch)).toContain('시작하기');
  await act(async () => relaunch.unmount());
});

test.each([
  [
    respond(401, {
      code: 'INVALID_CREDENTIALS',
      message: '아이디 또는 비밀번호가 올바르지 않습니다.',
      details: {},
    }),
    ['아이디 또는 비밀번호가 맞지 않아요.', '5회 실패 시 10분간 제한돼요'],
  ],
  [
    respond(429, { code: 'LOGIN_LOCKED', message: '', details: {} }),
    [
      '로그인을 5회 실패해 10분간 제한돼요.',
      '잠시 후 다시 시도하거나 비밀번호를 찾아 주세요.',
    ],
  ],
  [
    respond(400, { code: 'VALIDATION_ERROR', message: '', details: {} }),
    [
      '아이디 또는 비밀번호가 맞지 않아요.',
      '아이디는 영문·숫자 4~16자, 비밀번호는 공백 없이 8~20자예요.',
    ],
  ],
  [
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
    [
      '로그인하지 못했어요.',
      '서버에 잠시 문제가 있어요. 잠시 후 다시 시도해 주세요.',
    ],
  ],
])('server errors show their own message (%#)', async (response, lines) => {
  fetchMock.mockResolvedValue(response);
  const screen = await launch();
  await login(screen, 'wrong-pass1');

  for (const line of lines) {
    expect(texts(screen)).toContain(line);
  }
  expect(tokenStore.current()).toBeNull();
  await act(async () => screen.unmount());
});

// S15P31E105-773: 로그인 아이디 칸은 쓸 수 없는 문자를 지우고 알린다. 비밀번호는 773 이전 계정을 위해 그대로 보낸다.
test('the login ID drops characters it does not take; the password is sent as typed', async () => {
  serveHome(true);
  const screen = await launch();
  await press(screen, '시작하기');
  await type(screen, '아이디', '민준minjun01');
  expect(last(screen, '아이디', 'onChangeText').props.value).toBe('minjun01');
  expect(texts(screen)).toContain('영문·숫자만 입력할 수 있어요');
  await type(screen, '비밀번호', 'runway123비번');
  expect(texts(screen)).not.toContain('영문·숫자·특수문자만 입력할 수 있어요');
  await press(screen, '로그인');
  const body = JSON.parse(
    fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))![1]
      .body,
  );
  expect(body).toEqual({ loginId: 'minjun01', password: 'runway123비번' });
  await act(async () => screen.unmount());
});

test('no connection asks to check the network', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const screen = await launch();
  await login(screen);

  expect(texts(screen)).toContain('로그인하지 못했어요.');
  expect(texts(screen)).toContain(
    '네트워크 연결을 확인하고 다시 시도해 주세요.',
  );
  await act(async () => screen.unmount());
});
