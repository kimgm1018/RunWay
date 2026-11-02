import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories, type MockScenario } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';
import { setWatchHealthConsent } from '../src/health/watchHealth';

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

// Lets mock responses (setTimeout 0) and debounced checks finish.
async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function press(screen: Screen, label: string) {
  await act(async () => {
    last(screen, label, 'onPress').props.onPress();
  });
  await settle();
}

function isDisabled(screen: Screen, label: string) {
  return Boolean(
    last(screen, label, 'onPress').props.accessibilityState?.disabled,
  );
}

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    last(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function slide(screen: Screen, label: string) {
  await act(async () => {
    last(screen, label, 'onAccessibilityAction').props.onAccessibilityAction({
      nativeEvent: { actionName: 'activate' },
    });
  });
  await settle();
}

async function render(
  props: React.ComponentProps<typeof App> = {},
  scenario: MockScenario = 'default',
) {
  const repositories =
    props.repositories ?? createMockRepositories({ latencyMs: 0, scenario });
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} {...props} />,
    );
  });
  await settle();
  return screen!;
}

async function login(screen: Screen, loginId: string, password: string) {
  await type(screen, '아이디', loginId);
  await type(screen, '비밀번호', password);
  await press(screen, '로그인');
}

test('login shows the failure count, then enters home with the right password', async () => {
  const screen = await render();
  expect(texts(screen)).toContain('RUN YOUR WAY');
  await press(screen, '로그인');
  expect(isDisabled(screen, '로그인')).toBe(true);
  await login(screen, fixtures.account.loginId, 'wrong-pass1');
  expect(texts(screen)).toContain('아이디 또는 비밀번호가 맞지 않아요.');
  expect(texts(screen)).toContain('5회 실패 시 10분간 제한돼요 (1/5)');
  await login(screen, fixtures.account.loginId, fixtures.account.password);
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});

test('five failed logins lock the account for ten minutes', async () => {
  const screen = await render();
  await press(screen, '로그인');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await login(screen, fixtures.account.loginId, 'wrong-pass1');
  }
  expect(texts(screen)).toContain('로그인을 5회 실패해 10분간 제한돼요.');
  await login(screen, fixtures.account.loginId, fixtures.account.password);
  expect(texts(screen)).toContain('로그인을 5회 실패해 10분간 제한돼요.');
  await act(async () => screen.unmount());
});

test('sign-up validates each field and reaches home through the watch connection', async () => {
  const screen = await render();
  await press(screen, '시작하기');
  expect(texts(screen)).toContain('만들어요');

  await type(screen, '아이디', 'runner01');
  await settle(550);
  expect(texts(screen)).toContain('이미 사용 중인 아이디예요');
  await type(screen, '아이디', 'ab');
  expect(texts(screen)).toContain('영문·숫자 4–16자로 입력해 주세요');
  await type(screen, '아이디', 'newrunner');
  await settle(550);
  expect(texts(screen)).toContain('사용할 수 있는 아이디예요');

  await type(screen, '비밀번호', 'runway123');
  await type(screen, '비밀번호 확인', 'runway12');
  expect(texts(screen)).toContain('비밀번호가 일치하지 않아요');
  await type(screen, '비밀번호 확인', 'runway123');
  expect(texts(screen)).toContain('비밀번호가 일치해요');

  await type(screen, '전화번호', fixtures.account.phoneNumber);
  await press(screen, '인증번호 받기');
  expect(texts(screen)).toContain('이미 가입된 전화번호예요');
  await type(screen, '전화번호', '010-5555-6666');
  expect(isDisabled(screen, '다음')).toBe(true);
  await press(screen, '인증번호 받기');
  expect(texts(screen)).toContain('03:00');
  // A keyboard resending the same number keeps the code that was sent.
  await type(screen, '전화번호', '010-5555-6666');
  expect(texts(screen)).toContain('03:00');
  await type(screen, '인증번호', '111111');
  expect(texts(screen)).toContain(
    '인증번호가 맞지 않아요. 다시 입력해 주세요 (1/5)',
  );
  await type(screen, '인증번호', fixtures.verificationCode);
  expect(texts(screen)).toContain('본인 인증됐어요');
  expect(isDisabled(screen, '다음')).toBe(false);
  await press(screen, '다음');

  expect(texts(screen)).toContain('동의해 주세요');
  expect(isDisabled(screen, '동의하고 가입하기')).toBe(true);
  await press(screen, '[필수] 서비스 이용약관');
  await press(screen, '[필수] 개인정보 수집·이용');
  await press(screen, '[필수] 위치 정보 수집·이용');
  expect(isDisabled(screen, '동의하고 가입하기')).toBe(false);
  await press(screen, '동의하고 가입하기');

  expect(texts(screen)).toContain('불러드릴까요?');
  await type(screen, '닉네임', '러너');
  await press(screen, '남성');
  await press(screen, '연도 연도');
  await press(screen, '1991년');
  await press(screen, '일 일');
  await press(screen, '31일');
  expect(isDisabled(screen, '다음')).toBe(true);
  await press(screen, '월 월');
  await press(screen, '02월');
  // February 1991 has 28 days, so the 31st moves back to the 28th.
  expect(isDisabled(screen, '일 28일')).toBe(false);
  await press(screen, '다음');

  expect(texts(screen)).toContain('평소 어떻게');
  await press(screen, '중급, 5–10km 주 2–3회');
  await type(screen, '거리', '5');
  await type(screen, '완주 시간', '30:00');
  expect(texts(screen)).toContain('6′00″/km');
  await press(screen, '저장');

  // The consent chosen at sign-up is sent to the watch once the account exists.
  expect(setWatchHealthConsent).toHaveBeenCalledTimes(1);
  expect(setWatchHealthConsent).toHaveBeenCalledWith('DISAGREE');
  expect(texts(screen)).toContain('함께 쓰나요?');
  await press(screen, '네, 워치와 함께 쓸게요');
  await press(screen, '다음');
  expect(texts(screen)).toContain('82%');
  expect(texts(screen)).toContain('심박수');
  await slide(screen, '밀어서 시작하기');
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});

test('an account that never saved its running profile resumes at 1.6 and can skip the watch', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  await repositories.auth.signUp({
    loginId: 'halfway1',
    password: 'runway123',
    nickname: '러너',
    birthDate: '1995-05-05',
    gender: 'FEMALE',
    phoneNumber: '01011112222',
    healthDataAccess: 'DISAGREE',
  });
  const screen = await render({ repositories });
  await press(screen, '로그인');
  await login(screen, 'halfway1', 'runway123');
  expect(texts(screen)).toContain('평소 어떻게');
  await press(screen, '초급, 5km 미만 주 1회 이하');
  // The pace tab takes the pace alone (U07 PACE).
  await press(screen, '페이스');
  expect(texts(screen)).not.toContain('자동 계산');
  await type(screen, '페이스 (분:초/km)', '7:30');
  await press(screen, '저장');
  await press(screen, '아니요, 휴대폰만 쓸게요');
  await press(screen, '다음');
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});

test('password reset handles unknown numbers and wrong codes, then logs in with the new password', async () => {
  const screen = await render();
  await press(screen, '로그인');
  await press(screen, '비밀번호를 잊으셨나요?');
  expect(texts(screen)).toContain('가입한 전화번호 입력');
  await press(screen, '전화번호로 찾기');

  await type(screen, '전화번호', '01077310042');
  await press(screen, '인증번호 받기');
  expect(texts(screen)).toContain('가입되지 않은 전화번호예요');
  expect(texts(screen)).toContain('처음이신가요?');

  await type(screen, '전화번호', fixtures.account.phoneNumber);
  await press(screen, '인증번호 받기');
  await type(screen, '인증번호', '000000');
  expect(texts(screen)).toContain('(1/5)');
  await type(screen, '인증번호', fixtures.verificationCode);
  expect(texts(screen)).toContain('인증됐어요');

  await type(screen, '새 비밀번호', 'newpass123');
  await type(screen, '새 비밀번호 확인', 'newpass123');
  expect(texts(screen)).toContain('비밀번호가 일치해요');
  await press(screen, '변경하고 로그인하기');
  expect(texts(screen)).toContain('새 비밀번호로 로그인해 주세요');

  await login(screen, fixtures.account.loginId, fixtures.account.password);
  expect(texts(screen)).toContain('아이디 또는 비밀번호가 맞지 않아요.');
  await login(screen, fixtures.account.loginId, 'newpass123');
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});

test('five wrong codes require a new code', async () => {
  const screen = await render();
  await press(screen, '로그인');
  await press(screen, '비밀번호를 잊으셨나요?');
  await press(screen, '전화번호로 찾기');
  await type(screen, '전화번호', fixtures.account.phoneNumber);
  await press(screen, '인증번호 받기');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await type(screen, '인증번호', '000000');
  }
  expect(texts(screen)).toContain('인증번호를 5회 틀렸어요');
  await type(screen, '인증번호', fixtures.verificationCode);
  expect(texts(screen)).not.toContain('인증됐어요');
  await press(screen, '다시 받기');
  await type(screen, '인증번호', fixtures.verificationCode);
  expect(texts(screen)).toContain('인증됐어요');
  await act(async () => screen.unmount());
});

test('a disconnected watch shows the 1.8 state and can be skipped from settings', async () => {
  const screen = await render({ initialSignedIn: true }, 'watchDisconnected');
  await press(screen, '설정');
  await settle(400);
  await press(screen, '연결');
  await settle(400);
  const text = texts(screen);
  expect(text).toContain('연결 끊김');
  expect(text).toContain('권한 거부');
  expect(text).toContain('– –');
  await slide(screen, '밀어서 다시 연결');
  expect(texts(screen)).toContain('연결 끊김');
  await press(screen, '나중에 연결하기');
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});
