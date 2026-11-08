import { createMockRepositories } from '../../mock/createMockRepositories';
import { withSavedMusic } from '../../music/withSavedMusic';
import { spotifyTokens } from '../auth';
import { SpotifyStateError } from '../music';
import { withSpotifyRemote } from '../remote';
import { remoteConsent } from '../remoteConsent';
import type { SpotifyRemoteBridge, RemotePlayback } from '../remoteBridge';

const track = {
  id: 'spotify:track:synthetic',
  title: 'Synthetic',
  artist: 'Synthetic artist',
  durationMs: 120000,
  positionMs: 1000,
  artworkUri: 'file:///synthetic.png',
};
function bridge() {
  let state: RemotePlayback = {
    connected: true,
    playing: false,
    canPlayOnDemand: true,
    track,
  };
  const listeners = new Set<(value: RemotePlayback) => void>();
  const remote: SpotifyRemoteBridge = {
    installed: jest.fn(async () => true),
    openApp: jest.fn(async () => {}),
    connect: jest.fn(async () => {}),
    getState: jest.fn(async () => state),
    send: jest.fn(async command => {
      state = {
        ...state,
        playing: command === 'play',
        track: state.track && {
          ...state.track,
          id: command === 'next' ? 'spotify:track:next' : state.track.id,
          positionMs: command === 'previous' ? 0 : state.track.positionMs,
        },
      };
    }),
    // A playlist starts on its first song; a song plays itself.
    playUri: jest.fn(async (uri: string) => {
      state = {
        ...state,
        connected: true,
        playing: true,
        track: {
          ...track,
          id: uri.startsWith('spotify:track:') ? uri : 'spotify:track:first',
          positionMs: 0,
        },
      };
    }),
    disconnect: jest.fn(async () => {}),
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    remote,
    update: (next: RemotePlayback) => {
      state = next;
      listeners.forEach(listener => listener(next));
    },
  };
}
const base = () => createMockRepositories({ latencyMs: 0 }).music;
beforeEach(async () => {
  await remoteConsent.clear();
});
afterEach(() => jest.restoreAllMocks());

test('reading the source does not open consent and a first connection requires explicit login', async () => {
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  expect(await repo.selectSource('SPOTIFY')).toMatchObject({
    linked: false,
    nowPlaying: null,
    services: { SPOTIFY: 'LOGIN_REQUIRED' },
  });
  expect(remote.connect).not.toHaveBeenCalled();
  await repo.resolveService('SPOTIFY');
  expect(remote.connect).toHaveBeenCalledWith('client', true);
  expect(await remoteConsent.load()).toBe(true);
  expect(await repo.getState()).toMatchObject({
    linked: true,
    nowPlaying: { id: track.id, playing: false },
  });
});

test('missing Spotify is shown as install required without starting authentication', async () => {
  const { remote } = bridge();
  jest.mocked(remote.installed).mockResolvedValue(false);
  expect(
    await withSpotifyRemote(base(), remote, 'client').selectSource('SPOTIFY'),
  ).toMatchObject({ linked: false, services: { SPOTIFY: 'INSTALL_REQUIRED' } });
  expect(remote.connect).not.toHaveBeenCalled();
  await withSpotifyRemote(base(), remote, 'client').resolveService('SPOTIFY');
  expect(remote.openApp).toHaveBeenCalledTimes(1);
});

test.each(['play', 'pause', 'next', 'previous'] as const)(
  '%s uses App Remote without a Web API request and returns the actual state',
  async command => {
    await remoteConsent.save();
    const { remote } = bridge();
    const repo = withSpotifyRemote(base(), remote, 'client', { settleMs: 0 });
    await repo.selectSource('SPOTIFY');
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const state = await repo[command]();
    expect(remote.send).toHaveBeenCalledWith(command);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      source: 'SPOTIFY',
      linked: true,
      nowPlaying: { playing: command === 'play' },
    });
  },
);

test('native events update the subscribed view and unsubscribe stops updates', async () => {
  await remoteConsent.save();
  const { remote, update } = bridge();
  const repo = withSavedMusic(withSpotifyRemote(base(), remote, 'client'), {
    restoreSpotifyTrack: false,
  });
  await repo.selectSource('SPOTIFY');
  const received: unknown[] = [];
  const stop = repo.subscribe!(state => received.push(state));
  update({ connected: true, playing: true, canPlayOnDemand: true, track });
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(received).toEqual([
    expect.objectContaining({
      nowPlaying: expect.objectContaining({ id: track.id, playing: true }),
    }),
  ]);
  stop();
  update({
    connected: false,
    playing: false,
    canPlayOnDemand: false,
    track: null,
  });
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(received).toHaveLength(1);
});

test('an SDK failure after choosing Spotify still persists the choice and disconnects the card', async () => {
  await remoteConsent.save();
  const { remote } = bridge();
  const repo = withSavedMusic(withSpotifyRemote(base(), remote, 'client'), {
    restoreSpotifyTrack: false,
  });
  await repo.selectSource('MELON');
  jest.mocked(remote.connect).mockRejectedValue({ code: 'CONNECTION_LOST' });
  const error = await repo.selectSource('SPOTIFY').catch(value => value);
  expect(error).toBeInstanceOf(SpotifyStateError);
  expect(error.state).toMatchObject({
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
  });
  await remoteConsent.clear();
  expect(
    (
      await withSavedMusic(
        withSpotifyRemote(base(), bridge().remote, 'client'),
      ).getState()
    ).source,
  ).toBe('SPOTIFY');
});

test('denied connection does not authorize the next launch or misreport Premium', async () => {
  const { remote } = bridge();
  jest.mocked(remote.connect).mockRejectedValue({ code: 'AUTH_REQUIRED' });
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  await expect(repo.resolveService('SPOTIFY')).rejects.toMatchObject({
    reason: 'SIGNED_OUT',
    state: { linked: false, services: { SPOTIFY: 'LOGIN_REQUIRED' } },
  });
  expect(await remoteConsent.load()).toBe(false);
});

test('no playback history does not restore an old saved track or pretend resume succeeded', async () => {
  await remoteConsent.save();
  const { remote, update } = bridge();
  const repo = withSavedMusic(
    withSpotifyRemote(base(), remote, 'client', {
      settleMs: 0,
      settleTries: 2,
    }),
    { restoreSpotifyTrack: false },
  );
  await repo.selectSource('SPOTIFY');
  update({
    connected: true,
    playing: false,
    canPlayOnDemand: true,
    track: null,
  });
  expect((await repo.getState()).nowPlaying).toBeNull();
  await expect(repo.play()).rejects.toMatchObject({ reason: 'NO_HISTORY' });
  expect(remote.send).toHaveBeenCalledWith('play');
});

test('a connection event never replaces Melon or NONE with Spotify', async () => {
  await remoteConsent.save();
  const { remote, update } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('NONE');
  const listener = jest.fn();
  const stop = repo.subscribe!(listener);
  update({ connected: true, playing: true, canPlayOnDemand: true, track });
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(listener).not.toHaveBeenCalled();
  stop();
});

test('an unregistered SDK account clears consent and offers login again', async () => {
  await remoteConsent.save();
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  jest
    .mocked(remote.connect)
    .mockRejectedValue({ code: 'USER_NOT_REGISTERED' });
  await expect(repo.selectSource('SPOTIFY')).rejects.toMatchObject({
    reason: 'USER_NOT_REGISTERED',
    state: { services: { SPOTIFY: 'LOGIN_REQUIRED' } },
  });
  expect(await remoteConsent.load()).toBe(false);
});

test('authentication loss emits a disconnected view even after consent was cleared', async () => {
  await remoteConsent.save();
  const { remote, update } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('SPOTIFY');
  const received: unknown[] = [];
  const stop = repo.subscribe!(state => received.push(state));
  jest.mocked(remote.disconnect).mockImplementation(async () =>
    update({
      connected: false,
      playing: false,
      canPlayOnDemand: false,
      track: null,
    }),
  );
  jest.mocked(remote.send).mockRejectedValue({ code: 'AUTH_REQUIRED' });
  await expect(repo.play()).rejects.toMatchObject({ state: { linked: false } });
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(received).toContainEqual(
    expect.objectContaining({
      linked: false,
      nowPlaying: null,
      services: expect.objectContaining({ SPOTIFY: 'LOGIN_REQUIRED' }),
    }),
  );
  stop();
});

test('a connection approved after logout cannot save consent for the next session', async () => {
  const { remote } = bridge();
  let release!: () => void;
  jest.mocked(remote.connect).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  const repo = withSpotifyRemote(base(), remote, 'client');
  const connecting = repo.resolveService('SPOTIFY').catch(error => error);
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  await remoteConsent.clear();
  release();
  await connecting;
  expect(await remoteConsent.load()).toBe(false);
});

test('내 재생 목록 · 최근 들은 곡 ask for the Web API sign-in that App Remote does not give, then use it', async () => {
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.resolveService('SPOTIFY');
  await repo.selectSource('SPOTIFY');
  await spotifyTokens.clear();
  await expect(repo.getPlaylists()).rejects.toMatchObject({
    reason: 'SCOPE_REQUIRED',
  });
  await expect(repo.getRecentTracks()).rejects.toMatchObject({
    reason: 'SCOPE_REQUIRED',
  });

  await spotifyTokens.save({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
  });
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = jest.fn(async (url: string) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          items: [{ id: 'pl1', name: 'Long Run', images: [] }],
        }),
    };
  }) as unknown as typeof fetch;
  try {
    expect(await repo.getPlaylists()).toMatchObject([
      { id: 'pl1', title: 'Long Run' },
    ]);
    expect(urls).toEqual(['https://api.spotify.com/v1/me/playlists?limit=20']);
  } finally {
    globalThis.fetch = realFetch;
    await spotifyTokens.clear();
  }
});

test('on 멜론 the lists stay with the base player', async () => {
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.selectSource('MELON');
  expect(await repo.getPlaylists()).toEqual([]);
  expect(await repo.getRecentTracks()).toEqual([]);
});

test('a playlist or a song from the lists starts on this phone through App Remote, without the Web API', async () => {
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.resolveService('SPOTIFY');
  await repo.selectSource('SPOTIFY');
  await spotifyTokens.clear();
  const fetchSpy = jest.fn();
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  try {
    const listed = await repo.playPlaylist('pl1');
    expect(remote.playUri).toHaveBeenCalledWith('spotify:playlist:pl1');
    expect(listed.nowPlaying).toMatchObject({
      id: 'spotify:track:first',
      playing: true,
    });
    const song = await repo.playTrack('trk9');
    expect(remote.playUri).toHaveBeenCalledWith('spotify:track:trk9');
    expect(song.nowPlaying).toMatchObject({
      id: 'spotify:track:trk9',
      playing: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a free account starting a list gets the Premium message and stays connected', async () => {
  const { remote } = bridge();
  const repo = withSpotifyRemote(base(), remote, 'client');
  await repo.resolveService('SPOTIFY');
  await repo.selectSource('SPOTIFY');
  jest.mocked(remote.playUri).mockRejectedValue({ code: 'PREMIUM_REQUIRED' });
  await expect(repo.playPlaylist('pl1')).rejects.toMatchObject({
    reason: 'PREMIUM_REQUIRED',
  });
  expect(remote.disconnect).not.toHaveBeenCalled();
  expect(await remoteConsent.load()).toBe(true);
});
