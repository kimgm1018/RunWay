import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';
import {
  authRoutes,
  groupTabRoutes,
  homeTabRoutes,
  mainRoutes,
  routes,
  runTabRoutes,
  isSessionAction,
  type RouteName,
} from '../src/navigation/routes';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
// The first React Native render loads lazy host components on this Windows runner.
jest.setTimeout(20000);

const repositories = createMockRepositories({ latencyMs: 0 });

function texts(screen: TestRenderer.ReactTestRenderer) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function pressable(screen: TestRenderer.ReactTestRenderer, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No pressable labelled ${label}`);
  }
  // Stacks keep earlier screens mounted, so the newest match belongs to the top screen.
  return matches[matches.length - 1];
}

async function press(screen: TestRenderer.ReactTestRenderer, label: string) {
  await act(async () => {
    pressable(screen, label).props.onPress();
  });
}

async function render(props: React.ComponentProps<typeof App> = {}) {
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <App repositories={repositories} {...props} />,
    );
  });
  return screen!;
}

test('every prototype link points at a registered screen', () => {
  const registered = new Set<RouteName>([
    ...authRoutes,
    ...mainRoutes,
    ...runTabRoutes,
    ...homeTabRoutes,
    ...groupTabRoutes,
    'Home',
    'Community',
  ]);
  expect(new Set(Object.keys(routes))).toEqual(registered);
  for (const route of Object.values(routes)) {
    for (const link of route.links) {
      expect(isSessionAction(link) || registered.has(link)).toBe(true);
    }
  }
});

test('signed-out users move from start through login into the home tab', async () => {
  const screen = await render();
  expect(texts(screen)).toContain('시작하기');
  expect(
    screen.root.findAll(node => node.props.accessibilityRole === 'tablist'),
  ).toHaveLength(0);
  await press(screen, '시작하기'); // 1.1 시작하기 opens 1.2 로그인
  expect(texts(screen)).toContain('비밀번호를 잊으셨나요?');
  await act(async () => {
    for (const [label, text] of [
      ['아이디', fixtures.account.loginId],
      ['비밀번호', fixtures.account.password],
    ]) {
      screen.root
        .findAll(
          node =>
            node.props.accessibilityLabel === label &&
            typeof node.props.onChangeText === 'function',
        )[0]
        .props.onChangeText(text);
    }
  });
  await press(screen, '로그인');
  // The mock answers on a 0 ms timer.
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));
  const home = texts(screen);
  // The signed-in runner shows as the header avatar's initial (2.1 has no greeting, S15P31E105-382).
  expect(home).toContain('민');
  // 2.1 준비도 leads with the day's sentence and 러닝 시작하기; the score folds under 자세히 보기 (S15P31E105-615).
  expect(home).toContain('러닝 시작하기');
  expect(home).toContain('최근 운동량이 평소보다 많아요.');
  for (const tab of ['홈', '러닝', '그룹', '커뮤니티', '프로필']) {
    expect(pressable(screen, tab).props.accessibilityRole).toBe('tab');
  }
  expect(() => pressable(screen, '뒤로')).toThrow();
  await act(async () => screen.unmount());
});

test('watch connection opened from settings returns home instead of signing in', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  // 8.1: disconnect, then the same tile re-registers (S15P31E105-625) without opening 1.7 first.
  await press(screen, 'Galaxy Watch7');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('등록/연결 끊김');
  await press(screen, 'Galaxy Watch7');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('연결됨');
  expect(texts(screen)).toContain('Galaxy Watch7');
  await press(screen, '뒤로');
  expect(texts(screen)).toContain('러닝 시작하기');
  await act(async () => screen.unmount());
});

test('tabs and their inner screens follow the prototype flow', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '러닝');
  // The 러닝 tab opens the 2.0F map straight away (S15P31E105-683): no 러닝 방식 선택, no tab bar, the goal chip and
  // the start row.
  expect(texts(screen)).toContain('목표 설정');
  expect(texts(screen)).not.toContain('달릴까요?');
  expect(() => pressable(screen, '그룹')).toThrow();
  // 코스 설정 sits beside the goal, and 설정 left of 러닝 시작 opens the app settings (S15P31E105-683).
  expect(texts(screen)).toContain('코스 설정');
  await press(screen, '설정');
  expect(texts(screen)).toContain('로그아웃');
  await press(screen, '뒤로');
  expect(texts(screen)).toContain('목표 설정');
  // 뒤로 leaves the tab for 홈, and 러닝 opens the map again.
  await press(screen, '뒤로');
  expect(texts(screen)).toContain('러닝 시작하기');
  await press(screen, '러닝');
  expect(texts(screen)).toContain('목표 설정');
  expect(texts(screen)).not.toContain('달릴까요?');
  await press(screen, '뒤로');
  await press(screen, '그룹');
  // The group list loads after the tab opens.
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('광안리 새벽 크루');
  await press(screen, '크루 모집');
  expect(texts(screen)).toContain('원하는 크루가 없나요?');
  await press(screen, '커뮤니티');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('seoyun.run');
  // 7.4b is the fifth tab (S15P31E105-428), opened without a 뒤로 of its own.
  const backs = () =>
    screen.root.findAll(
      node =>
        node.props.accessibilityLabel === '뒤로' &&
        typeof node.props.onPress === 'function',
    ).length;
  const before = backs();
  await press(screen, '프로필');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('팔로워');
  expect(backs()).toBe(before);
  await act(async () => screen.unmount());
});

test('홈 opens the run tab map without 러닝 방식 선택', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '러닝');
  expect(texts(screen)).toContain('목표 설정');
  // 홈's 러닝 시작하기 opens the same map (S15P31E105-683).
  await press(screen, '뒤로');
  await press(screen, '러닝 시작하기');
  expect(texts(screen)).toContain('목표 설정');
  expect(texts(screen)).not.toContain('달릴까요?');
  // 러닝 시작하기 opens the map as it was left rather than stacking a second one, so 뒤로 still returns to 홈.
  await press(screen, '뒤로');
  await press(screen, '러닝 시작하기');
  expect(texts(screen)).toContain('코스 설정');
  await press(screen, '뒤로');
  // Back on 홈: the tab bar shows again.
  expect(pressable(screen, '그룹').props.accessibilityRole).toBe('tab');
  await act(async () => screen.unmount());
});

test('settings signs out', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  expect(texts(screen)).not.toContain('화면 모드');
  await press(screen, '로그아웃');
  expect(texts(screen)).toContain('시작하기');
  await act(async () => screen.unmount());
});

test('developer menu opens the component gallery with sheet and toast', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  await press(screen, '공통 컴포넌트');
  const gallery = texts(screen);
  for (const text of [
    '러닝 시작',
    '사용할 수 있는 아이디예요',
    '받은 알림이 없어요',
  ]) {
    expect(gallery).toContain(text);
  }
  await press(screen, '바텀시트 열기');
  expect(texts(screen)).toContain('정원이 가득 찼어요');
  await press(screen, '토스트 띄우기');
  expect(texts(screen)).toContain('워치 연결을 해제했어요');
  await act(async () => screen.unmount());
});

test('mock repositories cover new-user and error scenarios', async () => {
  const newUser = createMockRepositories({ scenario: 'newUser', latencyMs: 0 });
  await expect(newUser.home.getTodayCondition()).resolves.toMatchObject({
    readinessState: 'collecting',
    readinessScore: null,
  });
  const failing = createMockRepositories({ scenario: 'error', latencyMs: 0 });
  await expect(failing.profile.getMe()).rejects.toThrow('목 데이터 오류');
});
