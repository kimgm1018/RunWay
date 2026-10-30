import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { createMockRepositories } from '../src/data';
import * as fixtures from '../src/data/mock/fixtures';
import {
  authRoutes,
  groupTabRoutes,
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
  expect(texts(screen)).toContain('RUN YOUR WAY');
  expect(
    screen.root.findAll(node => node.props.accessibilityRole === 'tablist'),
  ).toHaveLength(0);
  await press(screen, '로그인');
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
  expect(home).toContain('민준');
  expect(home).toContain('오늘 달리기 좋은 날이에요');
  expect(home).toContain('82');
  for (const tab of ['홈', '러닝', '그룹', '커뮤니티']) {
    expect(pressable(screen, tab).props.accessibilityRole).toBe('tab');
  }
  expect(() => pressable(screen, '뒤로')).toThrow();
  await act(async () => screen.unmount());
});

test('watch connection opened from settings returns home instead of signing in', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  // 8.3: once disconnected, 연결 opens 1.7, which reconnects the watch.
  await press(screen, '연결 해제');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('연결 해제됨');
  await press(screen, '연결');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  await act(async () => {
    screen.root
      .findAll(node => node.props.accessibilityLabel === '밀어서 다시 연결')[0]
      .props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  });
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('82%');
  await act(async () => {
    screen.root
      .findAll(node => node.props.accessibilityLabel === '밀어서 시작하기')[0]
      .props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
  });
  expect(texts(screen)).toContain('오늘 달리기 좋은 날이에요');
  await act(async () => screen.unmount());
});

test('tabs and their inner screens follow the prototype flow', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '러닝');
  expect(texts(screen)).toContain('달릴까요?');
  await press(screen, '자유 러닝');
  expect(texts(screen)).toContain('코스 없이 기록만 남겨요');
  await press(screen, '그룹');
  // The group list loads after the tab opens.
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('광안리 새벽 크루');
  await press(screen, '크루 모집');
  expect(texts(screen)).toContain('원하는 크루가 없나요?');
  await press(screen, '커뮤니티');
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 400)));
  expect(texts(screen)).toContain('seoyun.run');
  await act(async () => screen.unmount());
});

test('settings signs out', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  expect(texts(screen)).not.toContain('화면 모드');
  await press(screen, '로그아웃');
  expect(texts(screen)).toContain('RUN YOUR WAY');
  await act(async () => screen.unmount());
});

test('developer menu opens the component gallery with sheet and toast', async () => {
  const screen = await render({ initialSignedIn: true });
  await press(screen, '설정');
  await press(screen, '공통 컴포넌트 미리보기');
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
