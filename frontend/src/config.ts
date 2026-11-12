export type DataSource = 'mock' | 'api';

export const appConfig = {
  // Screens read data through src/data repositories. 'api' calls the server for repositories that have an API version and keeps mock data for the rest.
  dataSource: 'api' as DataSource,
  // Every API path starts with /api/v1 (docs/design/api/README.md 공통 규약).
  apiBaseUrl: 'https://k15e105.p.ssafy.io/api/v1',
  // Shared replay links open on this site (S15P31E105-704): /r/{token} for my run, /p/{postId} for a post. Android
  // App Links open them in the app; without it the site shows the run.
  shareBaseUrl: 'https://k15e105.p.ssafy.io',
  // Client ID of the RunWay app in the Spotify Developer Dashboard (redirect URI runway://spotify-callback).
  // Sign-in uses PKCE without a client secret, so the ID may live in the app. Empty keeps Spotify on mock data.
  spotifyClientId: 'a9edc207ef2848cda30cfddb639da6a2',
  // The developer menu (component gallery, health and map PoCs) shows in dev builds only; release bundles set
  // __DEV__ to false (S15P31E105-635).
  developerMenu: __DEV__,
};
