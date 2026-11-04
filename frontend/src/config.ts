export type DataSource = 'mock' | 'api';

export const appConfig = {
  // Screens read data through src/data repositories. 'api' calls the server for repositories that have an API version and keeps mock data for the rest.
  dataSource: 'mock' as DataSource,
  // Every API path starts with /api/v1 (docs/design/api/README.md 공통 규약).
  apiBaseUrl: 'https://k15e105.p.ssafy.io/api/v1',
  // Client ID of the RunWay app in the Spotify Developer Dashboard (redirect URI runway://spotify-callback).
  // Sign-in uses PKCE without a client secret, so the ID may live in the app. Empty keeps Spotify on mock data.
  spotifyClientId: 'a9edc207ef2848cda30cfddb639da6a2',
  // The installed Android build bundles JS without __DEV__, so the developer menu is a flag; turn it off before release.
  developerMenu: true,
};
