import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';

// 1.3–1.5 회원가입 against the server (dataSource 'api'): U16 and U15 go to the server,
// phone verification has no API and stays on mock data.

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

const created = respond(201, {
  user: { id: 102, loginId: 'newrunner' },
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresInSec: 600,
  refreshExpiresAt: '2026-12-02T01:00:00Z',
  onboardingCompleted: false,
});

// U16 answers from a fixed set of taken IDs; U15 answers with whatever the test queues.
function serve(signUpResponses: ReturnType<typeof respond>[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/auth/login-id/availability')) {
      const loginId = new URL(url).searchParams.get('loginId');
      const available = loginId !== 'runner01';
      return respond(200, {
        loginId,
        available,
        reason: available ? null : 'DUPLICATED',
      });
    }
    if (url.endsWith('/auth/signup')) {
      return signUpResponses.shift() ?? created;
    }
    // 1.6 asks U06 for a saved profile; a fresh account has none.
    if (url.endsWith('/users/me/running-profile')) {
      return respond(404, {
        code: 'PROFILE_NOT_SET',
        message: '',
        details: {},
      });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

function signUpBodies() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/auth/signup'))
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

function isDisabled(screen: Screen, label: string) {
  return Boolean(
    last(screen, label, 'onPress').props.accessibilityState?.disabled,
  );
}

// Prefer a microtask flush over wall-clock sleep so full-suite load does not burn the test budget (S15P31E105-565).
async function settle(ms = 0) {
  if (ms > 0) {
    await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
    return;
  }
  await act(async () => {
    await Promise.resolve();
  });
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

// 1.3 with a free ID and a verified phone, then 1.4 with the three required consents.
async function reachBasicProfile(screen: Screen) {
  await press(screen, '시작하기');
  await press(screen, '회원가입');
  await type(screen, '아이디', 'newrunner');
  await settle(550);
  await type(screen, '비밀번호', 'runway123');
  await type(screen, '비밀번호 확인', 'runway123');
  await type(screen, '전화번호', '010-5555-6666');
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호', fixtures.verificationCode);
  await press(screen, '다음');
  await press(screen, '[필수] 서비스 이용약관');
  await press(screen, '[필수] 개인정보 수집·이용');
  await press(screen, '[필수] 위치 정보 수집·이용');
  await press(screen, '동의하고 가입하기');
}

// 1.5 takes the nickname and gender, then 1.5b the birth date; its 다음 sends U15.
async function fillBasicProfile(screen: Screen, nickname = '러너') {
  await type(screen, '닉네임', nickname);
  await press(screen, '남성');
  await press(screen, '다음');
  await press(screen, '연도 1991년');
  await press(screen, '월 2월');
  await press(screen, '일 28일');
}

// The value a 1.5b wheel rests on, as a screen reader hears it.
function wheel(screen: Screen, label: string) {
  return last(screen, label, 'onAccessibilityAction').props.accessibilityValue
    .text;
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

test('1.3 shows the server answer for the ID', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');

  await type(screen, '아이디', 'runner01');
  await settle(550);
  expect(texts(screen)).toContain('이미 사용 중인 아이디예요');
  await type(screen, '아이디', 'newrunner');
  await settle(550);
  expect(texts(screen)).toContain('사용할 수 있는 아이디예요');
  // Typing pauses are checked once, not on every keystroke.
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount());
});

test('1.3 reads a server format rejection as a format error', async () => {
  fetchMock.mockResolvedValue(
    respond(400, { code: 'VALIDATION_ERROR', message: '', details: {} }),
  );
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');

  await type(screen, '아이디', 'newrunner');
  await settle(550);

  expect(texts(screen)).toContain('영문·숫자 4–16자로 입력해 주세요');
  await act(async () => screen.unmount());
});

test('signing up creates the account, holds the tokens and goes on to 1.6', async () => {
  serve([]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await fillBasicProfile(screen);
  await press(screen, '다음');

  expect(texts(screen)).toContain('평소 어떻게');
  expect(signUpBodies()).toEqual([
    {
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
        { consentType: 'HEALTH_DATA', granted: false },
      ],
    },
  ]);
  // Requests during setup can use the tokens, but a relaunch before 1.7 starts signed out.
  expect(tokenStore.current()?.accessToken).toBe('access-2');
  await act(async () => screen.unmount());
  const relaunch = await launch();
  expect(texts(relaunch)).toContain('시작하기');
  await act(async () => relaunch.unmount());
});

test('a taken nickname shows under the field until it changes', async () => {
  serve([
    respond(409, { code: 'NICKNAME_DUPLICATED', message: '', details: {} }),
  ]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await fillBasicProfile(screen);
  await press(screen, '다음');

  // U15 turns the nickname down on 1.5b, so 1.5 opens again with it marked.
  expect(texts(screen)).toContain('이미 사용 중인 닉네임이에요');
  expect(isDisabled(screen, '다음')).toBe(true);
  await type(screen, '닉네임', '새러너');
  expect(texts(screen)).not.toContain('이미 사용 중인 닉네임이에요');
  await press(screen, '다음');
  // 1.5b still holds the date picked before.
  expect(isDisabled(screen, '다음')).toBe(false);
  await press(screen, '다음');

  expect(texts(screen)).toContain('평소 어떻게');
  expect(signUpBodies().map(body => body.nickname)).toEqual(['러너', '새러너']);
  await act(async () => screen.unmount());
});

test.each([
  [
    respond(409, { code: 'LOGIN_ID_DUPLICATED', message: '', details: {} }),
    '그사이 다른 사람이 이 아이디로 가입했어요. 회원가입에서 아이디를 바꿔 주세요.',
  ],
  [
    respond(422, { code: 'INVALID_PASSWORD_POLICY', message: '', details: {} }),
    '비밀번호가 규칙에 맞지 않아요. 회원가입에서 공백 없이 8~20자로 바꿔 주세요.',
  ],
  [
    respond(400, { code: 'INVALID_PROFILE', message: '', details: {} }),
    '입력한 정보를 확인하지 못했어요. 닉네임·생년월일·전화번호를 다시 확인해 주세요.',
  ],
  [
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
    '가입하지 못했어요. 잠시 후 다시 시도해 주세요.',
  ],
])('U15 errors show a notice on 1.5b (%#)', async (response, message) => {
  serve([response]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await fillBasicProfile(screen);
  await press(screen, '다음');

  expect(texts(screen)).toContain(message);
  expect(texts(screen)).toContain('언제예요?');
  expect(tokenStore.current()).toBeNull();
  await act(async () => screen.unmount());
});

test('1.5b wheels start on 2002-01-01, keep days real, survive going back and reach U15', async () => {
  serve([]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await type(screen, '닉네임', '러너');
  await press(screen, '남성');
  await press(screen, '다음');
  // No typing and no 목록 선택 · 직접 입력 switch: three wheels in 년 · 월 · 일 order.
  expect(texts(screen)).not.toContain('직접 입력');
  expect(wheel(screen, '연도')).toBe('2002년');
  expect(wheel(screen, '월')).toBe('1월');
  expect(wheel(screen, '일')).toBe('1일');
  expect(isDisabled(screen, '다음')).toBe(false);
  // The wheels reach 2026 and stop at 1950.
  await press(screen, '연도 2026년');
  expect(wheel(screen, '연도')).toBe('2026년');
  await press(screen, '연도 1950년');
  expect(wheel(screen, '연도')).toBe('1950년');
  // February 2000 has 29 days, so the 31st rolls back to the 29th.
  await press(screen, '연도 2000년');
  await press(screen, '일 31일');
  await press(screen, '월 2월');
  expect(wheel(screen, '일')).toBe('29일');
  // A screen reader steps the wheel with increment and decrement.
  await act(async () => {
    last(screen, '월', 'onAccessibilityAction').props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    });
  });
  await settle();
  expect(wheel(screen, '월')).toBe('3월');
  // Popping 1.5b and 1.5 keeps the date in the signup draft.
  await press(screen, '뒤로');
  await press(screen, '뒤로');
  await press(screen, '동의하고 가입하기');
  await type(screen, '닉네임', '러너');
  await press(screen, '남성');
  await press(screen, '다음');
  expect(wheel(screen, '연도')).toBe('2000년');
  expect(wheel(screen, '월')).toBe('3월');
  expect(wheel(screen, '일')).toBe('29일');
  await press(screen, '다음');
  expect(signUpBodies()[0].birthDate).toBe('2000-03-29');
  expect(texts(screen)).toContain('평소 어떻게');
  await act(async () => screen.unmount());
});
