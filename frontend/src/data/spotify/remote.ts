import type { MusicState, Repositories } from '../types';
import {
  signInToSpotify,
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
    if (!(await spotifyTokens.load())) {
      throw new SpotifyError('SCOPE_REQUIRED');
    }
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
      if (problem.reason === 'USER_NOT_REGISTERED') {
        await spotifyTokens.clear();
      }
    }
    return new SpotifyStateError(problem, {
      ...state,
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
  async function resolveSpotify() {
    const epoch = remoteConsent.version();
    const state = await base.getState();
    if (!(await remote.installed())) {
      await remote.openApp?.();
      return getState();
    }
    try {
      if (epoch !== remoteConsent.version()) {
        throw new SpotifyError('CANCELED');
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
      return resolveSpotify();
    },
    play: command('play'),
    pause: command('pause'),
    next: command('next'),
    previous: command('previous'),
    connectLibrary: async () => {
      await signInToSpotify(clientId);
    },
    getPlaylists: async () => {
      if (!(await onSpotify())) {
        return base.getPlaylists();
      }
      await needWebSignIn();
      return web.getPlaylists();
    },
    getRecentTracks: async () => {
      if (!(await onSpotify())) {
        return base.getRecentTracks();
      }
      await needWebSignIn();
      return web.getRecentTracks();
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
