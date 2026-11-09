import { Linking } from 'react-native';
import { sha256 } from 'js-sha256';
import { createMockRepositories } from '../../mock/createMockRepositories';
import { withSavedMusic } from '../../music/withSavedMusic';
import { base64Url, spotifyRedirectUri, spotifyTokens } from '../auth';
import { spotifyFailureMessage } from '../music';
import { withSpotifyRemote } from '../remote';
import { remoteConsent } from '../remoteConsent';
import type {
  AppAuthorizationRequest,
  RemotePlayback,
  SpotifyRemoteBridge,
} from '../remoteBridge';

// S15P31E105-573: on Android one Spotify app consent (single sign-on with PKCE) covers App Remote and the Web API
// lists, for the account signed in to the Spotify app on this phone.

type Reply = { status: number; body?: unknown };

function fakeFetch(route: (url: string, init?: RequestInit) => Reply) {
  const calls: { url: string; body?: string }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined });
    const reply = route(url, init);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () =>
        reply.body === undefined ? '' : JSON.stringify(reply.body),
      json: async () => reply.body,
    };
  }) as unknown as typeof fetch;
  return calls;
}

const formOf = (body?: string) =>
  Object.fromEntries(new URLSearchParams(body ?? ''));

// Token endpoint, /me and the two lists, as a phone signed in to Spotify as `account` would see them.
function spotifyServer(account = { id: 'runner-1', display_name: 'Runner' }) {
  return fakeFetch(url => {
    if (url === 'https://accounts.spotify.com/api/token') {
      return {
        status: 200,
        body: {
          access_token: 'access-app',
          refresh_token: 'refresh-app',
          expires_in: 3600,
        },
      };
    }
    if (url === 'https://api.spotify.com/v1/me') {
      return { status: 200, body: account };
    }
    if (url.startsWith('https://api.spotify.com/v1/me/playlists')) {
      return {
        status: 200,
        body: { items: [{ id: 'pl1', name: 'Long Run', images: [] }] },
      };
    }
    return { status: 500 };
  });
}

const playing: RemotePlayback = {
  connected: true,
  playing: false,
  canPlayOnDemand: true,
  track: null,
};

function bridge(
  answer: (
    request: AppAuthorizationRequest,
  ) => Promise<{ code: string; state: string }> = async request => ({
    code: 'code-1',
    state: request.state,
  }),
) {
  const remote: SpotifyRemoteBridge = {
    installed: jest.fn(async () => true),
    openApp: jest.fn(async () => {}),
    connect: jest.fn(async () => {}),
    getState: jest.fn(async () => playing),
    send: jest.fn(async () => {}),
    playUri: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    subscribe: () => () => {},
    authorize: jest.fn(answer),
  };
  return remote;
}

const base = () => createMockRepositories({ latencyMs: 0 }).music;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  await remoteConsent.clear();
  await spotifyTokens.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = realFetch;
});

test('the first connection asks once, in the Spotify app, for playback and the lists together', async () => {
  const calls = spotifyServer();
  const openURL = jest.spyOn(Linking, 'openURL');
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');

  await repo.resolveService('SPOTIFY');

  expect(remote.authorize).toHaveBeenCalledTimes(1);
  const request = jest.mocked(remote.authorize!).mock.calls[0][0];
  expect(request).toMatchObject({
    clientId: 'client',
    redirectUri: spotifyRedirectUri,
  });
  expect(request.scopes).toEqual(
    expect.arrayContaining([
      'app-remote-control',
      'playlist-read-private',
      'user-read-recently-played',
    ]),
  );
  // The code is exchanged with the verifier behind the challenge the app was given (RFC 7636 S256).
  const exchange = formOf(
    calls.find(call => call.url.endsWith('/api/token'))?.body,
  );
  expect(exchange).toMatchObject({
    grant_type: 'authorization_code',
    code: 'code-1',
    client_id: 'client',
    redirect_uri: spotifyRedirectUri,
  });
  expect(base64Url(sha256.array(exchange.code_verifier))).toBe(
    request.codeChallenge,
  );
  expect(remote.connect).toHaveBeenCalledWith('client', true);
  expect(await remoteConsent.load()).toBe(true);
  expect(await spotifyTokens.load()).toMatchObject({
    accessToken: 'access-app',
    refreshToken: 'refresh-app',
    via: 'app',
    account: { id: 'runner-1', name: 'Runner' },
  });
  // No browser sign-in and no second consent for the lists.
  expect(await repo.getPlaylists()).toMatchObject([{ id: 'pl1' }]);
  expect(openURL).not.toHaveBeenCalled();
  expect(remote.authorize).toHaveBeenCalledTimes(1);
});

test('the connected Spotify account is shown so it can be checked', async () => {
  spotifyServer();
  const repo = withSpotifyRemote(base(), bridge(), 'client');
  await repo.selectSource('SPOTIFY');
  await repo.resolveService('SPOTIFY');
  expect(await repo.getState()).toMatchObject({ spotifyAccount: 'Runner' });
});

test('a list permission already granted is reused after a restart and refreshed when it expires', async () => {
  await remoteConsent.save();
  await spotifyTokens.save({
    accessToken: 'old',
    refreshToken: 'refresh-app',
    expiresAt: Date.now() - 1000,
    via: 'app',
    account: { id: 'runner-1', name: 'Runner' },
  });
  const calls = spotifyServer();
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');

  expect(await repo.getPlaylists()).toMatchObject([{ id: 'pl1' }]);

  expect(remote.authorize).not.toHaveBeenCalled();
  expect(formOf(calls[0].body)).toMatchObject({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-app',
  });
  // The refreshed tokens still say which account and sign-in they came from.
  expect(await spotifyTokens.load()).toMatchObject({
    accessToken: 'access-app',
    via: 'app',
    account: { id: 'runner-1', name: 'Runner' },
  });
});

test('a refresh Spotify rejects asks to connect the lists again instead of hiding them', async () => {
  await remoteConsent.save();
  await spotifyTokens.save({
    accessToken: 'old',
    refreshToken: 'revoked',
    expiresAt: Date.now() - 1000,
    via: 'app',
  });
  fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  const repo = withSpotifyRemote(base(), bridge(), 'client');
  await repo.selectSource('SPOTIFY');
  await expect(repo.getPlaylists()).rejects.toMatchObject({
    reason: 'LIBRARY_EXPIRED',
  });
});

test('lists signed in through the browser before 573 are not assumed to be the phone account', async () => {
  await remoteConsent.save();
  await spotifyTokens.save({
    accessToken: 'browser',
    refreshToken: 'refresh-browser',
    expiresAt: Date.now() + 3_600_000,
  });
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  const repo = withSpotifyRemote(base(), bridge(), 'client');
  await repo.selectSource('SPOTIFY');
  await expect(repo.getPlaylists()).rejects.toMatchObject({
    reason: 'ACCOUNT_CHECK',
  });
  await expect(repo.getRecentTracks()).rejects.toMatchObject({
    reason: 'ACCOUNT_CHECK',
  });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('다시 로그인 on the lists goes through the Spotify app, not the browser', async () => {
  await remoteConsent.save();
  spotifyServer();
  const openURL = jest.spyOn(Linking, 'openURL');
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await repo.connectLibrary!();
  expect(remote.authorize).toHaveBeenCalledTimes(1);
  expect(openURL).not.toHaveBeenCalled();
  expect(await repo.getPlaylists()).toMatchObject([{ id: 'pl1' }]);
});

test('closing the Spotify consent is a cancel: nothing is saved and nothing is said', async () => {
  const remote = bridge(async () => {
    throw { code: 'CANCELED' };
  });
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  const error = await repo.resolveService('SPOTIFY').catch(e => e);
  expect(error).toMatchObject({ reason: 'CANCELED' });
  expect(spotifyFailureMessage(error, 'x')).toBeNull();
  expect(remote.connect).not.toHaveBeenCalled();
  expect(await remoteConsent.load()).toBe(false);
  expect(await spotifyTokens.load()).toBeNull();
});

test('declining the Spotify consent is told apart from closing it', async () => {
  const remote = bridge(async () => {
    throw { code: 'DENIED' };
  });
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  const error = await repo.resolveService('SPOTIFY').catch(e => e);
  expect(error).toMatchObject({ reason: 'DENIED' });
  expect(spotifyFailureMessage(error, 'x')).toEqual(expect.any(String));
  expect(await remoteConsent.load()).toBe(false);
});

test('a Spotify app too old for this sign-in asks for an update', async () => {
  const remote = bridge(async () => {
    throw { code: 'APP_UPDATE_REQUIRED' };
  });
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await expect(repo.resolveService('SPOTIFY')).rejects.toMatchObject({
    reason: 'APP_UPDATE_REQUIRED',
  });
});

test('an answer for a different request is refused', async () => {
  const calls = spotifyServer();
  const remote = bridge(async () => ({ code: 'code-1', state: 'forged' }));
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await expect(repo.resolveService('SPOTIFY')).rejects.toMatchObject({
    reason: 'FAILED',
  });
  expect(calls).toEqual([]);
  expect(await spotifyTokens.load()).toBeNull();
});

test('a consent finished after RunWay logout keeps no Spotify tokens', async () => {
  spotifyServer();
  let release!: (value: { code: string; state: string }) => void;
  let asked!: AppAuthorizationRequest;
  const remote = bridge(
    request =>
      new Promise(resolve => {
        asked = request;
        release = resolve;
      }),
  );
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  const connecting = repo.resolveService('SPOTIFY').catch(error => error);
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  await remoteConsent.clear();
  await spotifyTokens.clear();
  release({ code: 'code-1', state: asked.state });
  expect(await connecting).toMatchObject({ reason: 'CANCELED' });
  expect(await spotifyTokens.load()).toBeNull();
  expect(await remoteConsent.load()).toBe(false);
});

test('losing the App Remote authorization also drops the list tokens, which may be another account now', async () => {
  await remoteConsent.save();
  await spotifyTokens.save({
    accessToken: 'access-app',
    refreshToken: 'refresh-app',
    expiresAt: Date.now() + 3_600_000,
    via: 'app',
  });
  const remote = bridge();
  jest.mocked(remote.connect).mockRejectedValue({ code: 'AUTH_REQUIRED' });
  const repo = withSpotifyRemote(base(), remote, 'client');
  await expect(repo.selectSource('SPOTIFY')).rejects.toMatchObject({
    reason: 'SIGNED_OUT',
  });
  expect(await spotifyTokens.load()).toBeNull();
});

test('the account name survives the saved-music wrapper', async () => {
  spotifyServer();
  const repo = withSavedMusic(withSpotifyRemote(base(), bridge(), 'client'), {
    restoreSpotifyTrack: false,
  });
  await repo.selectSource('SPOTIFY');
  await repo.resolveService('SPOTIFY');
  expect(await repo.getState()).toMatchObject({ spotifyAccount: 'Runner' });
});

// Galaxy S22 (573 E2E): the Spotify app shows its consent on every sign-in, even one already given, so a dropped
// connection (2.7b 다시 연결) reconnects App Remote without signing in again when this phone's sign-in is kept.
test('2.7b 다시 연결 with the app sign-in kept reconnects App Remote without another consent', async () => {
  await remoteConsent.save();
  await spotifyTokens.save({
    accessToken: 'access-app',
    refreshToken: 'refresh-app',
    expiresAt: Date.now() + 3_600_000,
    via: 'app',
    account: { id: 'runner-1', name: 'Runner' },
  });
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  expect(await repo.reconnect()).toMatchObject({ linked: true });
  expect(remote.authorize).not.toHaveBeenCalled();
  expect(remote.connect).toHaveBeenCalledWith('client', true);
});

test('2.7b 다시 연결 without the app sign-in still asks for it once', async () => {
  spotifyServer();
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await repo.reconnect();
  expect(remote.authorize).toHaveBeenCalledTimes(1);
});

test('closing the consent of an account check keeps showing the connected account', async () => {
  spotifyServer();
  const remote = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await repo.resolveService('SPOTIFY');
  jest.mocked(remote.authorize!).mockRejectedValueOnce({ code: 'CANCELED' });
  await expect(repo.resolveService('SPOTIFY')).rejects.toMatchObject({
    reason: 'CANCELED',
    state: { spotifyAccount: 'Runner' },
  });
});
