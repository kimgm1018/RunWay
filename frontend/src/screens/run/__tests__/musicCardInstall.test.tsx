import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  createMockRepositories,
  DataProvider,
  SpotifyError,
  SpotifyStateError,
  type MusicState,
} from '../../../data';
import { ToastProvider } from '../../../components';
import { MusicCardScreen } from '../MusicCardScreen';

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) =>
      ReactActual.useEffect(effect, [effect]),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

type Screen = TestRenderer.ReactTestRenderer;

const texts = (screen: Screen) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

async function render(state: MusicState) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.music.getState = async () => state;
  repositories.music.subscribe = undefined;
  const reconnect = jest.fn(async (): Promise<MusicState> => {
    throw new SpotifyStateError(new SpotifyError('INSTALL_REQUIRED'), state);
  });
  repositories.music.reconnect = reconnect;
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <ToastProvider>
          <MusicCardScreen />
        </ToastProvider>
      </DataProvider>,
    );
  });
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));
  return { screen: screen!, reconnect };
}

// S15P31E105-776: Spotify picked on a phone without the Spotify app says so, instead of 연결이 끊겼어요.
test('2.7 with Spotify picked but not installed asks to install it', async () => {
  const base = await createMockRepositories({ latencyMs: 0 }).music.getState();
  const { screen, reconnect } = await render({
    ...base,
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
    services: { ...base.services, SPOTIFY: 'INSTALL_REQUIRED' },
  });
  expect(texts(screen)).toContain('Spotify 앱이 없어요');
  expect(texts(screen)).not.toContain('연결이 끊겼어요');
  const install = screen.root.find(
    node =>
      node.props.accessibilityLabel === 'Spotify 설치하기' &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => install.props.onPress());
  expect(reconnect).toHaveBeenCalledTimes(1);
  expect(texts(screen)).toContain('Spotify 앱이 없어요');
  await act(async () => screen.unmount());
});

test('2.7 with Spotify installed but dropped still shows 연결이 끊겼어요', async () => {
  const base = await createMockRepositories({ latencyMs: 0 }).music.getState();
  const { screen } = await render({
    ...base,
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
    services: { ...base.services, SPOTIFY: 'CONNECTED' },
  });
  expect(texts(screen)).toContain('연결이 끊겼어요');
  expect(texts(screen)).not.toContain('Spotify 앱이 없어요');
  await act(async () => screen.unmount());
});
