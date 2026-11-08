import { appConfig, type DataSource } from '../config';
import { createApiRepositories } from './api/createApiRepositories';
import { createMockRepositories } from './mock/createMockRepositories';
import { createMelonBridge, withMelon } from './melon';
import { withSavedMusic } from './music/withSavedMusic';
import { createSpotifyRemoteBridge } from './spotify/native';
import { withSpotifyRemote } from './spotify/remote';
import { withSpotify } from './spotify/music';
import type { Repositories } from './types';

function forSource(source: DataSource): Repositories {
  switch (source) {
    case 'mock':
      return createMockRepositories();
    case 'api':
      return createApiRepositories();
  }
}

export function createRepositories(source: DataSource): Repositories {
  const repositories = forSource(source);
  // 멜론 Android는 기기의 멜론 앱과 직접 연결하므로 데이터 출처와 관계없이 네이티브 모듈이 있으면 쓴다(S15P31E105-398).
  const melon = createMelonBridge();
  const base = melon
    ? withMelon(repositories.music, melon)
    : repositories.music;
  // Spotify talks to Spotify, not the RunWay server, so it applies to either source once the app has a Client ID.
  const remote = createSpotifyRemoteBridge();
  const music = appConfig.spotifyClientId
    ? remote
      ? withSpotifyRemote(base, remote, appConfig.spotifyClientId)
      : withSpotify(base, appConfig.spotifyClientId)
    : base;
  return {
    ...repositories,
    music: withSavedMusic(music, { restoreSpotifyTrack: !remote }),
  };
}
