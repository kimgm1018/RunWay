import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider } from '../src/data';
import { CrewDetailScreen } from '../src/screens/group/CrewDetailScreen';
import { GroupRunProgressScreen } from '../src/screens/group/GroupRunProgressScreen';
import { GroupRunResultScreen } from '../src/screens/group/GroupRunResultScreen';
import { WaitingRoomScreen } from '../src/screens/group/WaitingRoomScreen';

// Group screens opened without their crew or group run id show that nothing was found and go back, instead of
// opening a mock id such as gr-today or crew-gwangalli (S15P31E105-635).

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ canGoBack: () => true, goBack: mockGoBack }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../src/screens/run/RunSession', () => ({
  useRunSession: () => ({ run: null }),
}));
jest.setTimeout(20000);

const texts = (screen: TestRenderer.ReactTestRenderer) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

test.each([
  ['6.7', GroupRunResultScreen, '그룹런 결과를 찾을 수 없어요'],
  ['6.5', WaitingRoomScreen, '그룹런을 찾을 수 없어요'],
  ['6.6', GroupRunProgressScreen, '진행 중인 그룹런이 없어요'],
  ['6.2', CrewDetailScreen, '크루를 찾을 수 없어요'],
] as const)(
  '%s without an id loads nothing and goes back',
  async (_, Screen, title) => {
    mockGoBack.mockReset();
    const repositories = createMockRepositories({ latencyMs: 0 });
    const getResult = jest.spyOn(repositories.groupRuns, 'getResult');
    const getRoom = jest.spyOn(repositories.groupRuns, 'getWaitingRoom');
    const getCrew = jest.spyOn(repositories.crews, 'get');
    let screen: TestRenderer.ReactTestRenderer;
    await act(async () => {
      screen = TestRenderer.create(
        <DataProvider repositories={repositories}>
          <Screen />
        </DataProvider>,
      );
    });

    expect(texts(screen!)).toContain(title);
    expect(getResult).not.toHaveBeenCalled();
    expect(getRoom).not.toHaveBeenCalled();
    expect(getCrew).not.toHaveBeenCalled();
    const back = screen!.root.findAll(
      node =>
        node.props.accessibilityLabel === '돌아가기' &&
        typeof node.props.onPress === 'function',
    );
    await act(async () => {
      back[back.length - 1].props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  },
);
