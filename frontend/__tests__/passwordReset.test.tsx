import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';

// 1.2q 전화번호로 비밀번호 찾기 against the server (dataSource 'api'): U28·U29 then U30 (S15P31E105-560).
// Review R-3: a failed U30 must leave a way forward instead of a verified screen that cannot be undone.

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

const fetchMock = jest.fn();

function respond(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  };
}

const failure = (status: number, code: string) =>
  respond(status, { code, message: '', details: {} });

// U28 and U29 always succeed; U30 answers with whatever the test queues, then 204.
function serve(resetResponses: (ReturnType<typeof respond> | Error)[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/auth/phone-verifications')) {
      return respond(200, { expiresInSec: 180, resendAvailableInSec: 60 });
    }
    if (url.endsWith('/auth/phone-verifications/confirm')) {
      return respond(200, { verificationToken: 'proof-1', expiresInSec: 600 });
    }
    if (url.endsWith('/auth/password-reset')) {
      const next = resetResponses.shift() ?? respond(204);
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
    throw new Error(`unexpected request ${url}`);
  });
}

function resetCalls() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/auth/password-reset'),
  ).length;
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

async function settle() {
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

// Through 1.2q's number and code steps, then the new password.
async function reachNewPassword(screen: Screen, password = 'newpass123') {
  await press(screen, '시작하기');
  await press(screen, '비밀번호를 잊으셨나요?');
  await type(screen, '전화번호', fixtures.account.phoneNumber);
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('인증 완료');
  await type(screen, '새 비밀번호', password);
  await type(screen, '새 비밀번호 확인', password);
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.clear();
});

test('the new password shows the same rules as sign-up', async () => {
  // S15P31E105-627: 회원가입과 같은 안 글씨·조건별 ✓·일치 안내.
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '비밀번호를 잊으셨나요?');
  await type(screen, '전화번호', fixtures.account.phoneNumber);
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(last(screen, '새 비밀번호', 'onChangeText').props.placeholder).toBe('영문, 숫자 포함 8자 이상');
  expect(texts(screen)).not.toContain('영문 · 숫자 · 8자 이상');
  await type(screen, '새 비밀번호', 'newpass');
  expect(texts(screen)).toContain('✓ 영문 · 숫자 · 8자 이상');
  await type(screen, '새 비밀번호', 'newpass123');
  expect(texts(screen)).toContain('✓ 사용할 수 있는 비밀번호예요');
  await type(screen, '새 비밀번호 확인', 'newpass12');
  expect(texts(screen)).toContain('비밀번호가 일치하지 않아요');
  await type(screen, '새 비밀번호 확인', 'newpass123');
  expect(texts(screen)).toContain('✓ 비밀번호가 일치해요');
  await act(async () => screen.unmount());
});

test.each([
  ['VERIFICATION_EXPIRED', 410],
  ['SERVICE_UNAVAILABLE', 503],
])(
  'a U30 %s sends the user back to verify the number again',
  async (code, status) => {
    serve([failure(status, code)]);
    const screen = await launch();
    await reachNewPassword(screen);
    await press(screen, '변경하고 로그인하기');

    expect(texts(screen)).toContain(
      '비밀번호를 바꾸지 못했어요. 인증번호를 다시 받아 주세요.',
    );
    expect(texts(screen)).not.toContain('인증 완료');
    // The number step works again: a new code can be requested and verified.
    expect(isDisabled(screen, '인증번호 받기')).toBe(false);
    await press(screen, '인증번호 받기');
    expect(texts(screen)).toMatch(/남은 시간\s+(?:03:00|02:5\d)/);
    await type(screen, '인증번호 6자리', fixtures.verificationCode);
    await type(screen, '새 비밀번호', 'newpass123');
    await type(screen, '새 비밀번호 확인', 'newpass123');
    await press(screen, '변경하고 로그인하기');
    expect(resetCalls()).toBe(2);
    await act(async () => screen.unmount());
  },
);

test('a U30 registration answer keeps its own message', async () => {
  serve([failure(404, 'PHONE_NOT_REGISTERED')]);
  const screen = await launch();
  await reachNewPassword(screen);
  await press(screen, '변경하고 로그인하기');

  expect(texts(screen)).toContain('가입되지 않은 전화번호예요');
  expect(texts(screen)).toContain('처음이신가요?');
  expect(texts(screen)).not.toContain('인증 완료');
  await act(async () => screen.unmount());
});

test('a password the server turns down keeps the verification and asks for a new password', async () => {
  serve([failure(422, 'INVALID_PASSWORD_POLICY')]);
  const screen = await launch();
  await reachNewPassword(screen);
  await press(screen, '변경하고 로그인하기');

  expect(texts(screen)).toContain('인증 완료');
  expect(texts(screen)).toContain('공백 없이 8~20자로 입력해 주세요');
  expect(texts(screen)).not.toContain('인증번호를 다시 받아 주세요');
  await type(screen, '새 비밀번호', 'otherpass123');
  expect(texts(screen)).not.toContain('공백 없이 8~20자로 입력해 주세요');
  await type(screen, '새 비밀번호 확인', 'otherpass123');
  await press(screen, '변경하고 로그인하기');
  expect(resetCalls()).toBe(2);
  await act(async () => screen.unmount());
});

test('a lost U30 answer keeps the verification so the change can be sent again', async () => {
  serve([new TypeError('Network request failed')]);
  const screen = await launch();
  await reachNewPassword(screen);
  await press(screen, '변경하고 로그인하기');

  expect(texts(screen)).toContain(
    '비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
  );
  expect(texts(screen)).toContain('인증 완료');
  await press(screen, '변경하고 로그인하기');
  expect(resetCalls()).toBe(2);
  await act(async () => screen.unmount());
});

test('a password over 20 characters or with a space cannot be sent', async () => {
  serve([]);
  const screen = await launch();
  await reachNewPassword(screen, 'abcdefghij1234567890x');
  expect(texts(screen)).toContain('공백 없이 8~20자로 입력해 주세요');
  expect(isDisabled(screen, '변경하고 로그인하기')).toBe(true);
  await type(screen, '새 비밀번호', 'new pass123');
  await type(screen, '새 비밀번호 확인', 'new pass123');
  expect(isDisabled(screen, '변경하고 로그인하기')).toBe(true);
  expect(resetCalls()).toBe(0);
  await act(async () => screen.unmount());
});
