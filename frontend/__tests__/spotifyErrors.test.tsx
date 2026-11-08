import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import {
  createMockRepositories,
  withSpotify,
  spotifyTokens,
} from '../src/data';
import { withSpotifyRemote } from '../src/data/spotify/remote';
import { remoteConsent } from '../src/data/spotify/remoteConsent';
import type {
  SpotifyRemoteBridge,
  RemotePlayback,
} from '../src/data/spotify/remoteBridge';
import type { Repositories } from '../src/data/types';
import { withSavedMusic } from '../src/data/music/withSavedMusic';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.setTimeout(30000);
type Screen = TestRenderer.ReactTestRenderer;
let mounted: Screen | undefined;
const realFetch = globalThis.fetch;
const texts = (screen: Screen) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');
const labelled = (screen: Screen, label: string) => {
  const matches = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );
  if (!matches.length) {
    throw new Error(`No element labelled ${label}`);
  }
  return matches[matches.length - 1];
};
async function press(screen: Screen, label: string) {
  await act(async () => {
    await labelled(screen, label).props.onPress();
  });
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for music screen: ${mounted ? texts(mounted) : ''}`,
      );
    }
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 20)));
  }
}
async function launch(music?: Repositories['music']) {
  const repositories = createMockRepositories({ latencyMs: 0 });
  repositories.music =
    music ??
    withSavedMusic(withSpotify(repositories.music, 'synthetic-client'));
  await repositories.music.selectSource('MELON');
  await spotifyTokens.save({
    accessToken: 'synthetic',
    refreshToken: 'synthetic-refresh',
    expiresAt: Date.now() + 3600000,
  });
  await act(async () => {
    mounted = TestRenderer.create(
      <App repositories={repositories} initialSignedIn />,
    );
  });
  const screen = mounted!;
  await waitFor(() => texts(screen).includes('오늘 준비도 양호'));
  await press(screen, '러닝');
  await press(screen, '자유 러닝');
  await press(screen, '음악');
  await waitFor(() => texts(screen).includes('멜론 열기'));
  return screen;
}
beforeEach(async () => {
  await spotifyTokens.clear();
});
afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
  }
  mounted = undefined;
  globalThis.fetch = realFetch;
});
function reply(status: number, body = '') {
  return { ok: status < 300, status, text: async () => body } as Response;
}
test('a failed Spotify read saves the pick, closes 2.8 and replaces the old song with disconnected state', async () => {
  globalThis.fetch = jest.fn(async () => reply(503));
  const screen = await launch();
  await press(screen, '음악 연결 설정');
  await waitFor(() => texts(screen).includes('음악 없음'));
  await press(screen, 'Spotify');
  await press(screen, '설정 완료');
  await waitFor(() => texts(screen).includes('연결이 끊겼어요'));
  expect(() => labelled(screen, '설정 완료')).toThrow();
  expect(texts(screen)).not.toContain('바다 쪽으로 달리기');
  await spotifyTokens.clear();
  const fresh = withSavedMusic(
    withSpotify(
      createMockRepositories({ latencyMs: 0 }).music,
      'synthetic-client',
    ),
  );
  expect((await fresh.getState()).source).toBe('SPOTIFY');
});
test('an unregistered account gets a dashboard instruction and Spotify login after selecting it', async () => {
  globalThis.fetch = jest.fn(async () =>
    reply(403, 'The user is not registered for this application'),
  );
  const screen = await launch();
  await press(screen, '음악 연결 설정');
  await waitFor(() => texts(screen).includes('음악 없음'));
  await press(screen, 'Spotify');
  await press(screen, '설정 완료');
  await waitFor(() => texts(screen).includes('연결이 끊겼어요'));
  expect(texts(screen)).toContain('대시보드');
  await press(screen, '음악 연결 설정');
  await waitFor(() => {
    try {
      return Boolean(labelled(screen, 'Spotify 로그인'));
    } catch {
      return false;
    }
  });
  expect(labelled(screen, 'Spotify 로그인')).toBeDefined();
});

test('App Remote can resume without a current track and player events update the visible card', async () => {
  await remoteConsent.save();
  let playback: RemotePlayback = {
    connected: true,
    playing: false,
    canPlayOnDemand: true,
    track: null,
  };
  const listeners = new Set<(value: RemotePlayback) => void>();
  const remote: SpotifyRemoteBridge = {
    installed: async () => true,
    connect: async () => {},
    disconnect: async () => {},
    getState: async () => playback,
    send: async () => {
      playback = {
        ...playback,
        playing: true,
        track: {
          id: 'synthetic',
          title: 'Remote synthetic song',
          artist: 'Synthetic',
          durationMs: 120000,
          positionMs: 0,
          artworkUri: null,
        },
      };
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const music = withSavedMusic(
    withSpotifyRemote(
      createMockRepositories({ latencyMs: 0 }).music,
      remote,
      'client',
    ),
    { restoreSpotifyTrack: false },
  );
  const screen = await launch(music);
  await press(screen, '음악 연결 설정');
  await waitFor(() => texts(screen).includes('음악 없음'));
  await press(screen, 'Spotify');
  await press(screen, '설정 완료');
  await waitFor(() => texts(screen).includes('재생 중인 곡이 없어요'));
  expect(labelled(screen, '재생').props.disabled).toBe(false);
  await press(screen, '재생');
  await waitFor(() => texts(screen).includes('Remote synthetic song'));
  playback = {
    ...playback,
    track: { ...playback.track!, title: 'Changed by Spotify event' },
  };
  await act(async () => {
    listeners.forEach(listener => listener(playback));
  });
  await waitFor(() => texts(screen).includes('Changed by Spotify event'));
  expect(texts(screen)).not.toContain('Remote synthetic song');
});
