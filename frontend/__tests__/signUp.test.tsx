import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createApiRepositories, tokenStore } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';

// 1.3–1.5 회원가입 against the server (dataSource 'api'): U16, U28·U29 휴대전화 인증 and U15 go to the server
// (S15P31E105-560).

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

  expect(texts(screen)).toContain('영문/숫자 4~16자로 입력해 주세요');
  await act(async () => screen.unmount());
});

// S15P31E105-773: 쓸 수 없는 문자는 입력하는 즉시 지우고, 아이디와 같은 비밀번호로는 넘어갈 수 없다.
test('1.3 drops characters the ID and password do not take and says why', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');

  await type(screen, '아이디', 'new러너runner 1');
  expect(last(screen, '아이디', 'onChangeText').props.value).toBe(
    'newrunner1',
  );
  expect(texts(screen)).toContain('영문·숫자만 입력할 수 있어요');
  await type(screen, '비밀번호', 'run way비번😀123');
  expect(last(screen, '비밀번호', 'onChangeText').props.value).toBe(
    'runway123',
  );
  expect(texts(screen)).toContain('영문·숫자·특수문자만 입력할 수 있어요');
  await type(screen, '비밀번호', 'runway123!');
  expect(texts(screen)).not.toContain('영문·숫자·특수문자만 입력할 수 있어요');
  await act(async () => screen.unmount());
});

test('1.3 does not take a password that is the ID in any case', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');
  await type(screen, '아이디', 'newrunner1');
  await settle(550);
  await type(screen, '비밀번호', 'NewRunner1');
  await type(screen, '비밀번호 확인', 'NewRunner1');
  await type(screen, '전화번호', '010-5555-6666');
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호 6자리', fixtures.verificationCode);

  expect(texts(screen)).toContain('아이디와 다른 비밀번호를 입력해 주세요');
  expect(isDisabled(screen, '다음')).toBe(true);
  await type(screen, '비밀번호', 'NewRunner12');
  await type(screen, '비밀번호 확인', 'NewRunner12');
  expect(texts(screen)).not.toContain('아이디와 다른 비밀번호를 입력해 주세요');
  expect(isDisabled(screen, '다음')).toBe(false);
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
      // U29's proof from 1.3 rides along with U15 (users.md U15, S15P31E105-560).
      phoneVerificationToken: 'proof-1',
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

// S15P31E105-781: 서버가 받지 않는 번호는 인증 요청 전에 칸 아래에 이유를 보이고 인증번호를 받을 수 없다.
test('1.3 says why a phone number is refused before asking for a code', async () => {
  serve([]);
  const screen = await launch();
  await press(screen, '시작하기');
  await press(screen, '회원가입');

  await type(screen, '전화번호', '011-1234-5678');
  expect(texts(screen)).toContain('010으로 시작하는 휴대폰 번호만 쓸 수 있어요');
  expect(isDisabled(screen, '인증번호 받기')).toBe(true);

  // 자릿수 부족은 칸을 벗어난 뒤에 알린다.
  await type(screen, '전화번호', '010-1234-567');
  expect(texts(screen)).not.toContain('휴대폰 번호 11자리를 입력해 주세요');
  await act(async () => {
    last(screen, '전화번호', 'onBlur').props.onBlur();
  });
  expect(texts(screen)).toContain('휴대폰 번호 11자리를 입력해 주세요');
  expect(isDisabled(screen, '인증번호 받기')).toBe(true);

  // 다시 입력하기 시작하면 칸을 벗어날 때까지 자릿수 안내를 거둔다(781 리뷰 A-5·B-6).
  await type(screen, '전화번호', '010-1234-56');
  expect(texts(screen)).not.toContain('휴대폰 번호 11자리를 입력해 주세요');
  await type(screen, '전화번호', '010-1234-5678');
  expect(texts(screen)).not.toContain('휴대폰 번호 11자리를 입력해 주세요');
  expect(isDisabled(screen, '인증번호 받기')).toBe(false);
  await act(async () => screen.unmount());
});

// S15P31E105-781: 서버가 거절하는 닉네임(공백·이모지 등)은 1.5에서 바로 안내하고 넘어가지 않는다.
test('1.5 says why a nickname is refused and stays', async () => {
  serve([]);
  const screen = await launch();
  await reachBasicProfile(screen);
  await press(screen, '남성');

  await type(screen, '닉네임', '홍 길동');
  expect(texts(screen)).toContain('닉네임에는 공백을 쓸 수 없어요');
  expect(isDisabled(screen, '다음')).toBe(true);

  await type(screen, '닉네임', '😀😀');
  expect(texts(screen)).toContain('한글·영문·숫자만 쓸 수 있어요');
  expect(isDisabled(screen, '다음')).toBe(true);

  await type(screen, '닉네임', '홍길동');
  expect(texts(screen)).not.toContain('한글·영문·숫자만 쓸 수 있어요');
  expect(isDisabled(screen, '다음')).toBe(false);
  await act(async () => screen.unmount());
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
    '비밀번호가 규칙에 맞지 않아요. 회원가입에서 아이디와 다른 영문·숫자·특수문자 8~20자로 바꿔 주세요.',
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

// Review R-2: a failed U28 must not hide a code that can still arrive or still works.
async function openSignUpPhone(screen: Screen) {
  await press(screen, '시작하기');
  await press(screen, '회원가입');
  await type(screen, '전화번호', '010-5555-6666');
}

const failure = (status: number, code: string) =>
  respond(status, { code, message: '', details: { retryAfterSec: 40 } });

// S15P31E105-646: 인증번호 단계는 제목·남은 시간·6칸·다시 받기 안내를 보인다(보낸 번호 문구는 담당자 결정으로 뺌).
test('the code step shows where the code went and when it can be sent again', async () => {
  serve([]);
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');

  const shown = texts(screen);
  expect(shown).toContain('인증번호를 입력해주세요');
  expect(shown).not.toContain('로 전송됨');
  expect(shown).toContain('남은 시간');
  expect(shown).toMatch(/남은 시간\s+(?:03:00|02:5\d)/);
  expect(shown).toContain('인증번호 다시 받기 (1:00)');
  expect(isDisabled(screen, '인증번호 다시 받기 1:00 뒤')).toBe(true);
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('인증 완료');
  expect(texts(screen)).not.toContain('인증번호 다시 받기');
  expect(texts(screen)).not.toContain('인증번호를 입력해주세요');
  await act(async () => screen.unmount());
});

test('a resend that comes too soon keeps the code on screen usable', async () => {
  serve([], [
    respond(200, { expiresInSec: 180, resendAvailableInSec: 60 }),
    failure(429, 'VERIFICATION_RESEND_TOO_SOON'),
  ]);
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');
  await press(screen, '다시 받기');

  expect(texts(screen)).toContain('인증번호는 잠시 후에 다시 받을 수 있어요.');
  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  await act(async () => screen.unmount());
});

test('an unclear send opens the code field for an SMS that may still arrive', async () => {
  serve([], [failure(503, 'SMS_UNAVAILABLE')]);
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');

  expect(texts(screen)).toContain('문자가 왔다면 입력하고');
  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  expect(texts(screen)).toMatch(/남은 시간\s+(?:03:00|02:5\d)/);
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  await act(async () => screen.unmount());
});

// S15P31E105-799 (TEAM QA T05): over the limit, a code sent earlier may still be live, so the field opens for it.
test('a first request over the limit still opens the field for a code already received', async () => {
  serve([], [failure(429, 'VERIFICATION_SEND_LIMIT_EXCEEDED')]);
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');

  expect(texts(screen)).toContain('인증번호 요청 횟수를 넘었어요');
  expect(texts(screen)).toContain('이미 받은 인증번호가 있으면 입력해 주세요');
  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  await act(async () => screen.unmount());
});

// S15P31E105-799 (TEAM QA T05): coming back to the screen and asking again within a minute is 429 too soon, but the
// code from the first request is still live on the server (180 s from that send), so the field opens with its time.
test('a first request that is too soon opens the field for the code sent a moment ago', async () => {
  serve([], [failure(429, 'VERIFICATION_RESEND_TOO_SOON')]);
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');

  expect(texts(screen)).toContain('조금 전에 보낸 인증번호를 입력해 주세요');
  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  // retryAfterSec 40: sent 20 s ago, so 160 s of the 180 s code are left and 다시 받기 opens in 40 s.
  expect(texts(screen)).toMatch(/남은 시간\s+(?:02:40|02:3\d)/);
  expect(texts(screen)).toContain('인증번호 다시 받기 (0:40)');
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  await act(async () => screen.unmount());
});

// S15P31E105-799: while 다시 받기 is waiting for the server, the code already on screen stays usable.
test('the code field stays while a resend is on its way', async () => {
  let answer: (value: ReturnType<typeof respond>) => void = () => {};
  const pending = new Promise<ReturnType<typeof respond>>(resolve => {
    answer = resolve;
  });
  serve(
    [],
    [
      respond(200, { expiresInSec: 180, resendAvailableInSec: 60 }),
      pending as unknown as ReturnType<typeof respond>,
    ],
  );
  const screen = await launch();
  await openSignUpPhone(screen);
  await press(screen, '인증번호 받기');
  await press(screen, '다시 받기');

  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  await act(async () => {
    answer(respond(200, { expiresInSec: 180, resendAvailableInSec: 60 }));
  });
  await settle();
  expect(hasField(screen, '인증번호 6자리')).toBe(true);
  await type(screen, '인증번호 6자리', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  await act(async () => screen.unmount());
});
