import type { MusicState, Repositories } from '../types';
import { SpotifyError, spotifyTokens, type SpotifyFailure } from './auth';
import { SpotifyStateError } from './music';
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
