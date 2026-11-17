import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataProvider,
  type GroupRunDetail,
  type GroupRunStatus,
} from '../src/data';
import { GroupRunDetailScreen } from '../src/screens/group/GroupRunDetailScreen';
import { GroupRunDraftProvider } from '../src/screens/group/parts';
import { ThemeProvider } from '../src/theme';

// 6.4 status CTAs and host edit/cancel gating (S15P31E105-637).

const mockNavigate = jest.fn();
let mockRouteGroupRunId = 'gr-today';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: { groupRunId: mockRouteGroupRunId } }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => effect(), [effect]);
  },
  useIsFocused: () => true,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(30000);

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function labelled(screen: Screen, label: string) {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (matches.length === 0) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
}

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function renderDetail(
  status: GroupRunStatus,
  groupRunId: string,
  patch: Partial<GroupRunDetail> = {},
) {
  mockRouteGroupRunId = groupRunId;
  mockNavigate.mockReset();
  const repositories = createMockRepositories({ latencyMs: 0 });
  const originalGet = repositories.groupRuns.get.bind(repositories.groupRuns);
  jest.spyOn(repositories.groupRuns, 'get').mockImplementation(async id => ({
    ...(await originalGet(id)),
    status,
    ...patch,
  }));

  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>
          <DataProvider repositories={repositories}>
            <ToastProvider>
              <GroupRunDraftProvider>
                <GroupRunDetailScreen />
              </GroupRunDraftProvider>
            </ToastProvider>
          </DataProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  for (let i = 0; i < 40 && !texts(screen!).includes('광안리'); i++) {
    await settle(25);
  }
  return screen!;
}

test('RUNNING joined detail opens GroupRunProgress and hides host edit/cancel', async () => {
  const screen = await renderDetail('RUNNING', 'gr-wednesday');
  expect(texts(screen)).toContain('내가 만든 그룹런');
  expect(() => labelled(screen, '그룹런 수정')).toThrow();
  expect(() => labelled(screen, '그룹런 취소')).toThrow();
  await act(async () => {
    labelled(screen, '진행 화면으로').props.onPress();
  });
  expect(mockNavigate).toHaveBeenCalledWith('GroupRunProgress');
  await act(async () => screen.unmount());
});

test('COMPLETED joined detail opens GroupRunResult without host edit/cancel', async () => {
  const screen = await renderDetail('COMPLETED', 'gr-today');
  expect(() => labelled(screen, '그룹런 수정')).toThrow();
  expect(() => labelled(screen, '그룹런 취소')).toThrow();
  await act(async () => {
    labelled(screen, '그룹런 결과 보기').props.onPress();
  });
  expect(mockNavigate).toHaveBeenCalledWith('GroupRunResult', {
    groupRunId: 'gr-today',
  });
  await act(async () => screen.unmount());
});

test('SCHEDULED host detail still shows edit and cancel', async () => {
  const screen = await renderDetail('SCHEDULED', 'gr-wednesday');
  expect(() => labelled(screen, '그룹런 수정')).not.toThrow();
  expect(() => labelled(screen, '그룹런 취소')).not.toThrow();
  expect(() => labelled(screen, '진행 화면으로')).toThrow();
  expect(() => labelled(screen, '그룹런 결과 보기')).toThrow();
  await act(async () => screen.unmount());
});

// S15P31E105-891: a start long past that nobody began is a past run, not one to join or get ready for.
const longPast = '2026-10-10T07:00:00+09:00';

test('SCHEDULED run long past says it is over and offers no join', async () => {
  const screen = await renderDetail('SCHEDULED', 'gr-today', {
    scheduledAt: longPast,
    joined: false,
    isHost: false,
  });
  expect(texts(screen)).toContain('지난 그룹런이에요');
  expect(texts(screen)).toContain('지남');
  expect(() => labelled(screen, '참가하기')).toThrow();
  expect(() => labelled(screen, '참가 취소')).toThrow();
  await act(async () => screen.unmount());
});

test('SCHEDULED run long past offers no waiting room even to a joined member', async () => {
  const screen = await renderDetail('SCHEDULED', 'gr-today', {
    scheduledAt: longPast,
    joined: true,
    isHost: false,
  });
  expect(texts(screen)).toContain('지난 그룹런이에요');
  expect(() => labelled(screen, '대기방 입장')).toThrow();
  expect(() => labelled(screen, '참가 취소')).toThrow();
  await act(async () => screen.unmount());
});

test('SCHEDULED run just past its start still joins while the host may begin', async () => {
  const screen = await renderDetail('SCHEDULED', 'gr-today', {
    scheduledAt: '2026-10-19T12:30:00+09:00',
    joined: false,
    isHost: false,
  });
  expect(texts(screen)).not.toContain('지난 그룹런이에요');
  expect(() => labelled(screen, '참가하기')).not.toThrow();
  await act(async () => screen.unmount());
});
