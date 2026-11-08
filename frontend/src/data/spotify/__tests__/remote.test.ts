import { createMockRepositories } from '../../mock/createMockRepositories';
import { withSavedMusic } from '../../music/withSavedMusic';
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
