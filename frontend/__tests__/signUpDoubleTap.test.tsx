import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';

// S15P31E105-796 (TEAM QA T02): 회원가입 buttons tapped fast. The first tap locks at once, so the request goes out
// and the next screen opens once, not two or three times.

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

// U16 answers from a fixed set of taken IDs; U28 and U15 answer with whatever the test queues.
function serve(
  signUpResponses: ReturnType<typeof respond>[],
  codeResponses: ReturnType<typeof respond>[] = [],
) {
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
    // U28 sends the SMS; U29 accepts the fixture code and returns the proof U15 must carry.
    if (url.endsWith('/auth/phone-verifications')) {
      return (
        codeResponses.shift() ??
        respond(200, { expiresInSec: 180, resendAvailableInSec: 60 })
      );
    }
    if (url.endsWith('/auth/phone-verifications/confirm')) {
      return respond(200, { verificationToken: 'proof-1', expiresInSec: 600 });
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

function hasField(screen: Screen, label: string) {
  return (
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onChangeText === 'function',
    ).length > 0
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
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
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

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

// Several taps inside one frame: the second and third arrive before React re-renders a `disabled` button.
async function tap(screen: Screen, label: string, times = 3) {
  await act(async () => {
    const onPress = last(screen, label, 'onPress').props.onPress;
    for (let count = 0; count < times; count += 1) {
      onPress();
    }
  });
  await settle();
  await settle();
}

const phoneCodeCalls = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/auth/phone-verifications'),
  );

test('3 taps on 인증번호 받기 send one SMS', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');
  await type(screen, '전화번호', '010-5555-6666');
  await tap(screen, '인증번호 받기');

  expect(phoneCodeCalls()).toHaveLength(1);
  await act(async () => screen.unmount());
});

test('3 taps on 다음 of 1.5b send U15 once and open 1.6 once', async () => {
  serve([]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await fillBasicProfile(screen);
  await tap(screen, '다음');

  expect(signUpBodies()).toHaveLength(1);
  expect(texts(screen)).toContain('평소 어떻게');
  await act(async () => screen.unmount());
});

test('3 taps on 동의하고 가입하기 open the next step once', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');
  await type(screen, '아이디', 'newrunner');
  await settle(550);
  await type(screen, '비밀번호', 'runway123');
  await type(screen, '비밀번호 확인', 'runway123');
  await type(screen, '전화번호', '010-5555-6666');
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  await tap(screen, '다음');
  await press(screen, '[필수] 서비스 이용약관');
  await press(screen, '[필수] 개인정보 수집·이용');
  await press(screen, '[필수] 위치 정보 수집·이용');
  await tap(screen, '동의하고 가입하기');
  expect(hasField(screen, '닉네임')).toBe(true);
  await act(async () => screen.unmount());
});
