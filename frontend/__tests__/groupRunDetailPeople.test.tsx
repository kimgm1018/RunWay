import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../src/components';
import {
  createMockRepositories,
  DataProvider,
  type GroupRunDetail,
} from '../src/data';
import { GroupRunDetailScreen } from '../src/screens/group/GroupRunDetailScreen';
import { GroupRunDraftProvider } from '../src/screens/group/parts';
import { ThemeProvider } from '../src/theme';

// 6.4 그룹런 상세: the photos of who comes say and open their names (팀원 의견: 사진만으로는 누가 누군지 몰라요).

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: { groupRunId: 'gr-wednesday' } }),
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

const people: GroupRunDetail['participants'] = [
  {
    userId: 'host',
    nickname: '민수',
    isHost: true,
    isMe: false,
    readyStatus: 'WAITING',
    readinessScore: 80,
  },
  {
    userId: 'me',
    nickname: '지우',
    isHost: false,
    isMe: true,
    readyStatus: 'WAITING',
    readinessScore: 70,
  },
  {
    userId: 'other',
    nickname: '하늘',
    isHost: false,
    isMe: false,
    readyStatus: 'WAITING',
    readinessScore: null,
  },
];

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

const avatars = (screen: Screen) =>
  screen.root.find(
    node =>
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('참가자 ') &&
      typeof node.props.onPress === 'function',
  );

const nameList = (screen: Screen) =>
  screen.root.findAll(
    node =>
      typeof node.type === 'string' &&
      node.props.accessibilityLabel === '참가자 이름',
  );

async function settle(ms = 20) {
  await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
}

async function renderDetail() {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const originalGet = repositories.groupRuns.get.bind(repositories.groupRuns);
  jest.spyOn(repositories.groupRuns, 'get').mockImplementation(async id => ({
    ...(await originalGet(id)),
    status: 'SCHEDULED',
    participants: people,
    participantCount: people.length,
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
  for (let i = 0; i < 40 && !texts(screen!).includes('참가'); i++) {
    await settle(25);
  }
  return screen!;
}

test('the photos say who comes, and a tap opens and closes their names with 그룹장 and 나', async () => {
  const screen = await renderDetail();
  // A screen reader hears every name on the photos, the host and me marked.
  expect(avatars(screen).props.accessibilityLabel).toBe(
    '참가자 민수 · 그룹장, 지우 · 나, 하늘',
  );
  expect(avatars(screen).props.accessibilityState).toEqual({
    expanded: false,
  });
  expect(nameList(screen)).toHaveLength(0);

  await act(async () => avatars(screen).props.onPress());
  expect(nameList(screen)).toHaveLength(1);
  const listed = nameList(screen)[0]
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .join(' ');
  expect(listed).toContain('민수');
  expect(listed).toContain('지우');
  expect(listed).toContain('하늘');
  expect(listed).toContain('그룹장');
  expect(listed).toContain('나');
  expect(avatars(screen).props.accessibilityState).toEqual({ expanded: true });

  await act(async () => avatars(screen).props.onPress());
  expect(nameList(screen)).toHaveLength(0);
  await act(async () => screen.unmount());
});
