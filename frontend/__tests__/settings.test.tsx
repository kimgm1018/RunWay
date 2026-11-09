import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  tokenStore,
  type Repositories,
} from '../src/data';
import { DataError } from '../src/data/errors';
import { setWatchHealthConsent } from '../src/health/watchHealth';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// 8.1 건강정보 수집 hands the saved consent to the watch; the tests read what it was given.
jest.mock('../src/health/watchHealth', () => ({
  ...jest.requireActual('../src/health/watchHealth'),
  setWatchHealthConsent: jest.fn(async () => undefined),
}));
const watchConsent = setWatchHealthConsent as jest.Mock;
beforeEach(() => watchConsent.mockClear());
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(60000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

// Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
function labelled(screen: Screen, label: string, prop = 'onPress') {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props[prop] === 'function',
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

async function type(screen: Screen, label: string, text: string) {
  await act(async () => {
    labelled(screen, label, 'onChangeText').props.onChangeText(text);
  });
  await settle();
}

async function openSettings(
  repositories: Repositories = createMockRepositories({ latencyMs: 0 }),
) {
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  await settle();
  await press(screen!, '설정');
  await settle();
  return screen!;
}

// A tile or a row reads its state out (켜기 · 공개 · 러닝 중에만 …).
const stateOf = (screen: Screen, label: string) =>
  labelled(screen, label).props.accessibilityValue?.text as string;

test('8.1 tiles switch at once and 8.1b picks where the location is recorded', async () => {
  const screen = await openSettings();
  const page = texts(screen);
  expect(page).toContain('Galaxy Watch7');
  expect(page).toContain('연결됨');
  // runway-settings: no profile card and no setting descriptions on 8.1 (담당자 결정).
  expect(page).not.toContain('내 프로필 보기');
  expect(page).not.toContain('페이스·심박 이탈 시 음성으로 알려요');

  const voice = () => labelled(screen, '코칭 음성 알림');
  expect(voice().props.accessibilityState.checked).toBe(true);
  await press(screen, '코칭 음성 알림');
  expect(voice().props.accessibilityState.checked).toBe(false);
  expect(stateOf(screen, '코칭 음성 알림')).toBe('끄기');

  expect(stateOf(screen, '계정 공개 범위')).toBe('공개');
  await press(screen, '계정 공개 범위');
  expect(stateOf(screen, '계정 공개 범위')).toBe('비공개');

  // 위치 기록 opens 8.1b: one of 항상 · 러닝 중에만 · 끔 is on, and 8.1 shows the one picked.
  expect(stateOf(screen, '위치 기록')).toBe('러닝 중에만');
  await press(screen, '위치 기록');
  await settle(50);
  expect(labelled(screen, '러닝 중에만').props.accessibilityState.checked).toBe(
    true,
  );
  await press(screen, '항상');
  expect(labelled(screen, '항상').props.accessibilityState.checked).toBe(true);
  expect(labelled(screen, '러닝 중에만').props.accessibilityState.checked).toBe(
    false,
  );
  await press(screen, '뒤로');
  await settle(50);
  expect(stateOf(screen, '위치 기록')).toBe('항상');
  await act(async () => screen.unmount());
});

test('8.1 건강정보 수집 asks before withdrawing and gives consent again at once', async () => {
  const screen = await openSettings();
  expect(stateOf(screen, '건강정보 수집')).toBe('동의함');

  // A tap only asks; 취소 leaves the consent as it was.
  await press(screen, '건강정보 수집');
  expect(texts(screen)).toContain('건강정보 수집 동의를 철회할까요?');
  await press(screen, '취소');
  expect(stateOf(screen, '건강정보 수집')).toBe('동의함');
  expect(watchConsent).not.toHaveBeenCalled();

  await press(screen, '건강정보 수집');
  await press(screen, '철회하기');
  expect(stateOf(screen, '건강정보 수집')).toBe('철회함');
  expect(texts(screen)).toContain('건강정보 수집 동의를 철회했어요');
  expect(watchConsent).toHaveBeenLastCalledWith('DISAGREE');

  // Giving it again needs no sheet.
  await press(screen, '건강정보 수집');
  expect(stateOf(screen, '건강정보 수집')).toBe('동의함');
  expect(watchConsent).toHaveBeenLastCalledWith('AGREE');
  await act(async () => screen.unmount());
});

test('8.1 asks W05 again when W04 fails and shows what the server holds', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  // The withdrawal landed on the server, but its answer was lost.
  let server = true;
  repositories.consents = {
    getHealth: async () => server,
    setHealth: async granted => {
      server = granted;
      throw new DataError('NETWORK_ERROR', '응답 없음');
    },
  };
  const screen = await openSettings(repositories);
  await press(screen, '건강정보 수집');
  await press(screen, '철회하기');
  expect(stateOf(screen, '건강정보 수집')).toBe('철회함');
  expect(texts(screen)).toContain('건강정보 수집 동의를 철회했어요');
  expect(watchConsent).toHaveBeenLastCalledWith('DISAGREE');

  // Nothing landed this time: the tile stays and the user is told to try again.
  repositories.consents.setHealth = async () => {
    throw new DataError('SERVER_ERROR', '503');
  };
  await press(screen, '건강정보 수집');
  expect(stateOf(screen, '건강정보 수집')).toBe('철회함');
  expect(texts(screen)).toContain(
    '저장하지 못했어요. 잠시 후 다시 시도해 주세요',
  );
  await act(async () => screen.unmount());
});

// S15P31E105-555: a failed U19·U13 read still leaves 로그아웃 and 회원탈퇴 on 8.1, next to 다시 시도.
test('8.1 keeps 로그아웃 and 회원탈퇴 when the settings cannot be read', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  let reads = 0;
  repositories.settings.get = async () => {
    reads += 1;
    throw new DataError('SERVER_ERROR', '503');
  };
  const logout = jest.fn(async (_refreshToken: string) => undefined);
  repositories.auth.logout = logout;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const screen = await openSettings(repositories);
  expect(texts(screen)).toContain('설정을 불러오지 못했어요');
  expect(labelled(screen, '회원탈퇴')).toBeTruthy();
  expect(labelled(screen, '뒤로')).toBeTruthy();

  const before = reads;
  await press(screen, '다시 시도');
  expect(reads).toBeGreaterThan(before);
  expect(texts(screen)).toContain('설정을 불러오지 못했어요');

  await press(screen, '로그아웃');
  await settle(50);
  expect(logout).toHaveBeenCalledWith('refresh-1');
  expect(texts(screen)).toContain('시작하기');
  await act(async () => screen.unmount());
});

test('8.1 opens 회원탈퇴 when the settings cannot be read', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.settings.get = async () => {
    throw new DataError('NETWORK_ERROR', '응답 없음');
  };
  const screen = await openSettings(repositories);
  expect(texts(screen)).toContain('설정을 불러오지 못했어요');
  await press(screen, '회원탈퇴');
  await settle(50);
  expect(texts(screen)).toContain('정말 탈퇴할까요?');
  await act(async () => screen.unmount());
});

test('8.2 saves the nickname from the foot and opens with it again', async () => {
  const screen = await openSettings();
  await press(screen, '뒤로');
  await press(screen, '프로필');
  await settle(50);
  await press(screen, '프로필 수정');
  await settle(50);
  expect(texts(screen)).toContain('5km · 30:00 · 6′00″/km');
  // The date is one field; a tap opens 연도 · 월 · 일 under it.
  expect(texts(screen)).toContain('1991년 3월 14일');
  expect(texts(screen)).not.toContain('03월');
  await press(screen, '생년월일 1991년 3월 14일');
  expect(texts(screen)).toContain('03월');
  await type(screen, '닉네임', '민');
  expect(labelled(screen, '저장').props.accessibilityState.disabled).toBe(true);
  await type(screen, '닉네임', '새벽러너');
  await press(screen, '저장');
  await settle(50);
  expect(texts(screen)).toContain('프로필을 저장했어요');
  // 8.1 no longer has the profile card, so open 8.2 again and read the saved nickname.
  await press(screen, '프로필 수정');
  await settle(50);
  expect(labelled(screen, '닉네임', 'onChangeText').props.value).toBe(
    '새벽러너',
  );
  await act(async () => screen.unmount());
});

test('8.4 keeps 다음 off while a crew I lead must be handed over first (users.md U17·U18)', async () => {
  const screen = await openSettings();
  await press(screen, '회원탈퇴');
  await settle(50);
  const page = texts(screen);
  expect(page).toContain('정말 탈퇴할까요?');
  expect(page).toContain('저장한 코스 5개');
  expect(page).toContain('크루장인 크루가 있어요');
  expect(page).toContain('민락 야경 러너스');
  // The confirmed policy has no automatic successor: the server's blocker says to hand it over or dissolve it.
  expect(page).toContain('크루장을 다른 멤버에게 넘기거나 크루를 해산한 뒤 탈퇴할 수 있어요.');
  expect(page).not.toContain('가장 오래된 멤버');
  expect(page).toContain('먼저 정리해야 탈퇴할 수 있어요');
  await press(screen, '탈퇴 동의');
  expect(labelled(screen, '다음').props.disabled).toBe(true);
  await act(async () => screen.unmount());
});

test('8.4 to 8.6 withdraws after the agreement and the password, then signs out', async () => {
  const screen = await openSettings(
    createMockRepositories({ latencyMs: 0, scenario: 'noCrews' }),
  );
  await press(screen, '회원탈퇴');
  await settle(50);
  let page = texts(screen);
  expect(page).toContain('정말 탈퇴할까요?');
  expect(page).not.toContain('먼저 정리해야 탈퇴할 수 있어요');
  // 8.4 steps on with 다음 (runway-settings); 탈퇴하기 is 8.5's.
  expect(labelled(screen, '다음').props.disabled).toBe(true);
  await press(screen, '탈퇴 동의');
  await press(screen, '다음');
  await settle(50);
  expect(texts(screen)).toContain('비밀번호를 입력해 주세요');

  // A password outside the 8–20 rule does not go to the server.
  await type(screen, '비밀번호', 'short');
  expect(labelled(screen, '탈퇴하기').props.disabled).toBe(true);
  await type(screen, '비밀번호', 'wrong123');
  await press(screen, '탈퇴하기');
  await settle(50);
  expect(texts(screen)).toContain('비밀번호가 맞지 않아요');
  await type(screen, '비밀번호', 'runway123');
  await press(screen, '탈퇴하기');
  await settle(50);
  expect(texts(screen)).toContain('탈퇴가 완료됐어요');
  await press(screen, '처음으로');
  await settle(50);
  page = texts(screen);
  expect(page).toContain('시작하기');
  await act(async () => screen.unmount());
});
