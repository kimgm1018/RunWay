import type { MusicState, Repositories } from '../types';
import {
  signInToSpotify,
  signInWithSpotifyApp,
  SpotifyError,
  spotifyTokens,
  type SpotifyFailure,
} from './auth';
import { SpotifyStateError, withSpotify } from './music';
import { remoteConsent } from './remoteConsent';
import type {
  RemoteCommand,
  RemotePlayback,
  SpotifyRemoteBridge,
} from './remoteBridge';
type Music = Repositories['music'];
function failure(error: unknown): SpotifyError {
  if (error instanceof SpotifyError) {
    return error;
  }
  const code = (error as { code?: string } | null)?.code;
  const reason: SpotifyFailure =
    code === 'AUTH_REQUIRED'
      ? 'SIGNED_OUT'
      : code === 'USER_NOT_REGISTERED'
      ? 'USER_NOT_REGISTERED'
      : code === 'PREMIUM_REQUIRED'
      ? 'PREMIUM_REQUIRED'
      : code === 'NO_HISTORY'
      ? 'NO_HISTORY'
      : code === 'INSTALL_REQUIRED'
      ? 'INSTALL_REQUIRED'
      : 'FAILED';
  return new SpotifyError(reason);
}
function view(state: MusicState, playback: RemotePlayback): MusicState {
  const track = playback.connected ? playback.track : null;
  return {
    ...state,
    linked: playback.connected,
    library: null,
    premium: playback.canPlayOnDemand,
    services: { ...state.services, SPOTIFY: 'CONNECTED' },
    nowPlaying: track
      ? {
          id: track.id,
          title: track.title,
          subtitle: track.artist,
          durationSec: Math.round(track.durationMs / 1000),
          artworkUrl: track.artworkUri,
          positionSec: Math.round(track.positionMs / 1000),
          playing: playback.playing,
        }
      : null,
  };
}
export function withSpotifyRemote(
  base: Music,
  remote: SpotifyRemoteBridge,
  clientId: string,
  { settleMs = 100, settleTries = 25 } = {},
): Music {
  let connecting: Promise<void> | undefined;
  // 내 재생 목록 · 최근 들은 곡 are read through the Web API, which App Remote does not cover; the reads need the Web
  // API sign-in (connectLibrary), asked for as SCOPE_REQUIRED until it is there. Starting one goes through App
  // Remote like 재생, switched to this phone first (ADR-0020), so it needs no Web API token or active device.
  const web = withSpotify(base, clientId);
  async function onSpotify() {
    return (await base.getState()).source === 'SPOTIFY';
  }
  async function needWebSignIn() {
    const tokens = await spotifyTokens.load();
    if (!tokens) {
      throw new SpotifyError('SCOPE_REQUIRED');
    }
    // S15P31E105-573: a browser sign-in may be another account than the phone's Spotify app, which App Remote
    // plays for; the lists wait for a sign-in through the app instead of showing that account's.
    if (remote.authorize && tokens.via !== 'app') {
      throw new SpotifyError('ACCOUNT_CHECK');
    }
  }
  // A list read with the saved permission; one Spotify stopped refreshing is told apart from never having it.
  async function readList<T>(read: () => Promise<T>) {
    await needWebSignIn();
    try {
      return await read();
    } catch (error) {
      throw error instanceof SpotifyError && error.reason === 'SIGNED_OUT'
        ? new SpotifyError('LIBRARY_EXPIRED', error.message)
        : error;
    }
  }
  // S15P31E105-573: the Spotify app's own sign-in grants App Remote and the lists at once, for the account App
  // Remote uses. Without it (a bridge with no app sign-in) the lists keep the browser sign-in.
  async function signInOnPhone(epoch: number) {
    if (!remote.authorize) {
      await signInToSpotify(clientId);
      return;
    }
    const tokens = await signInWithSpotifyApp(clientId, remote.authorize);
    if (epoch !== remoteConsent.version()) {
      throw new SpotifyError('CANCELED');
    }
    await spotifyTokens.save(tokens);
    if (epoch !== remoteConsent.version()) {
      // RunWay signed out while the tokens were being written.
      await spotifyTokens.clear();
      throw new SpotifyError('CANCELED');
    }
  }
  async function account(): Promise<Partial<MusicState>> {
    const tokens = await spotifyTokens.load();
    return tokens?.via === 'app' && tokens.account
      ? { spotifyAccount: tokens.account.name }
      : {};
  }
  async function connect(interactive: boolean) {
    if (!connecting) {
      connecting = remote.connect(clientId, interactive).finally(() => {
        connecting = undefined;
      });
    }
    await connecting;
  }
  async function broken(
    state: MusicState,
    error: unknown,
  ): Promise<SpotifyStateError> {
    const problem = failure(error);
    if (
      problem.reason === 'SIGNED_OUT' ||
      problem.reason === 'USER_NOT_REGISTERED'
    ) {
      await remoteConsent.clear();
      await remote.disconnect();
      // The Spotify app may be signed in to another account now, so the lists do not keep the old one's tokens.
      await spotifyTokens.clear();
    }
    return new SpotifyStateError(problem, {
      ...state,
      // A canceled account check keeps the account still connected on display.
      ...(await account()),
      linked: false,
      library: null,
      nowPlaying: null,
      services: {
        ...state.services,
        SPOTIFY: (await remoteConsent.load()) ? 'CONNECTED' : 'LOGIN_REQUIRED',
      },
    });
  }
  async function getState(): Promise<MusicState> {
    const state = await readState();
    return { ...state, ...(await account()) };
  }
  async function readState(): Promise<MusicState> {
    const epoch = remoteConsent.version();
    const state = await base.getState();
    const installed = await remote.installed();
    const allowed = await remoteConsent.load();
    const services = {
      ...state.services,
      SPOTIFY: !installed
        ? ('INSTALL_REQUIRED' as const)
        : allowed
        ? ('CONNECTED' as const)
        : ('LOGIN_REQUIRED' as const),
    };
    if (state.source !== 'SPOTIFY') {
      return { ...state, services };
    }
    if (!installed || !allowed) {
      return {
        ...state,
        services,
        linked: false,
        library: null,
        nowPlaying: null,
      };
    }
    try {
      await connect(false);
      const playback = await remote.getState();
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      return view(state, playback);
    } catch (error) {
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      throw await broken(state, error);
    }
  }
  // The Spotify app shows its consent on every sign-in, even one already given (Galaxy S22, 573), so only an
  // explicit connection or account check signs in again. A dropped connection with this phone's sign-in kept
  // (2.7b 다시 연결) only reconnects App Remote.
  async function signInKept() {
    return (
      (await remoteConsent.load()) &&
      (await spotifyTokens.load())?.via === 'app'
    );
  }
  async function resolveSpotify({ signIn = true } = {}) {
    const epoch = remoteConsent.version();
    const state = await base.getState();
    if (!(await remote.installed())) {
      // S15P31E105-776: the store opens to install it, and the screen says why and what comes next.
      try {
        await remote.openApp?.();
      } catch {
        // The message still tells the user to install Spotify.
      }
      throw new SpotifyStateError(
        new SpotifyError('INSTALL_REQUIRED'),
        await getState(),
      );
    }
    try {
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      if (remote.authorize && signIn) {
        // One consent for playback and the lists; App Remote then connects without asking again.
        await signInOnPhone(epoch);
      }
      await connect(true);
      if (!(await remoteConsent.save(epoch))) {
        throw new SpotifyError('CANCELED');
      }
      return await getState();
    } catch (error) {
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      throw await broken(state, error);
    }
  }
  function command(name: RemoteCommand) {
    return async () => {
      const epoch = remoteConsent.version();
      const state = await base.getState();
      if (state.source !== 'SPOTIFY') {
        return base[name]();
      }
      if (!(await remoteConsent.load())) {
        throw await broken(state, new SpotifyError('SIGNED_OUT'));
      }
      try {
        await connect(false);
        const before = await remote.getState();
        if (epoch !== remoteConsent.version()) {
          throw new SpotifyError('CANCELED');
        }
        await remote.send(name);
        let next = before;
        for (let attempt = 0; attempt < settleTries; attempt++) {
          if (attempt) {
            await new Promise<void>(resolve => setTimeout(resolve, settleMs));
          }
          next = await remote.getState();
          const applied =
            name === 'play'
              ? next.playing && next.track !== null
              : name === 'pause'
              ? !next.playing
              : next.track?.id !== before.track?.id ||
                (name === 'previous' &&
                  (next.track?.positionMs ?? Infinity) <
                    (before.track?.positionMs ?? 0));
          if (applied) {
            return view(state, next);
          }
        }
        if (name === 'play' && !next.track) {
          throw new SpotifyError('NO_HISTORY');
        }
        // Return the observed state; a sent command alone is never shown as successful playback.
        return view(state, next);
      } catch (error) {
        if (epoch !== remoteConsent.version()) {
          throw new SpotifyError('CANCELED');
        }
        const problem = failure(error);
        if (
          problem.reason === 'NO_HISTORY' ||
          problem.reason === 'PREMIUM_REQUIRED'
        ) {
          throw problem;
        }
        throw await broken(state, error);
      }
    };
  }
  // Starts a playlist or a song on this phone and waits until Spotify reports a song playing that `applied`
  // accepts; the observed state is returned either way, never a guess.
  async function playOnPhone(
    uri: string,
    applied: (next: RemotePlayback, before: RemotePlayback) => boolean,
  ) {
    const epoch = remoteConsent.version();
    const state = await base.getState();
    if (!(await remoteConsent.load())) {
      throw await broken(state, new SpotifyError('SIGNED_OUT'));
    }
    try {
      await connect(false);
      const before = await remote.getState();
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      await remote.playUri(uri);
      let next = before;
      for (let attempt = 0; attempt < settleTries; attempt++) {
        if (attempt) {
          await new Promise<void>(resolve => setTimeout(resolve, settleMs));
        }
        next = await remote.getState();
        if (next.playing && next.track && applied(next, before)) {
          break;
        }
      }
      return view(state, next);
    } catch (error) {
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
      }
      const problem = failure(error);
      if (problem.reason === 'PREMIUM_REQUIRED') {
        throw problem;
      }
      throw await broken(state, error);
    }
  }

  return {
    canStartWithoutTrack: true,
    getState,
    selectSource: async source => {
      await base.selectSource(source);
      return getState();
    },
    resolveService: async service => {
      if (service === 'SPOTIFY') {
        return resolveSpotify();
      }
      await base.resolveService(service);
      return getState();
    },
    reconnect: async () => {
      if ((await base.getState()).source !== 'SPOTIFY') {
        await base.reconnect();
        return getState();
      }
      return resolveSpotify({ signIn: !(await signInKept()) });
    },
    play: command('play'),
    pause: command('pause'),
    next: command('next'),
    previous: command('previous'),
    connectLibrary: () => signInOnPhone(remoteConsent.version()),
    getPlaylists: async () => {
      if (!(await onSpotify())) {
        return base.getPlaylists();
      }
      return readList(web.getPlaylists);
    },
    getRecentTracks: async () => {
      if (!(await onSpotify())) {
        return base.getRecentTracks();
      }
      return readList(web.getRecentTracks);
    },
    // A playlist counts as started once a different song plays (its first song may be the one already on).
    playPlaylist: async playlistId => {
      if (!(await onSpotify())) {
        await base.playPlaylist(playlistId);
        return getState();
      }
      return playOnPhone(
        `spotify:playlist:${playlistId}`,
        (next, before) => next.track?.id !== before.track?.id,
      );
    },
    playTrack: async trackId => {
      if (!(await onSpotify())) {
        await base.playTrack(trackId);
        return getState();
      }
      const uri = `spotify:track:${trackId}`;
      return playOnPhone(uri, next => next.track?.id === uri);
    },
    subscribe: listener => {
      let active = true;
      const stop = remote.subscribe(playback => {
        void base
          .getState()
          .then(async state => {
            if (!active || state.source !== 'SPOTIFY') {
              return;
            }
            const allowed = await remoteConsent.load();
            if (active && (allowed || !playback.connected)) {
              const next = view(state, playback);
              listener({
                ...next,
                services: {
                  ...next.services,
                  SPOTIFY: allowed ? 'CONNECTED' : 'LOGIN_REQUIRED',
                },
              });
            }
          })
          .catch(() => {});
      });
      return () => {
        active = false;
        stop();
      };
    },
  };
}
