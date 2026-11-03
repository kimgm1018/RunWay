import { appConfig, type DataSource } from '../config';
import { createApiRepositories } from './api/createApiRepositories';
import { createMockRepositories } from './mock/createMockRepositories';
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
  // Spotify talks to Spotify, not the RunWay server, so it applies to either source once the app has a Client ID.
  return appConfig.spotifyClientId
    ? {
        ...repositories,
        music: withSpotify(repositories.music, appConfig.spotifyClientId),
      }
    : repositories;
}
