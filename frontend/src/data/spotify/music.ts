import type { MusicState, Repositories, Track } from '../types';
import {
  signInToSpotify,
  spotifyAccessToken,
  SpotifyError,
  spotifyTokens,
  type SpotifyFailure,
} from './auth';

type Music = Repositories['music'];

// What a toast says when a Spotify call fails; null when nothing needs saying (the user closed sign-in).
const failureMessages: Record<SpotifyFailure, string | null> = {
  CANCELED: null,
  SIGNED_OUT: 'Spotify에 다시 로그인해 주세요',
  PREMIUM_REQUIRED: 'Spotify Premium에서만 조작할 수 있어요',
  NO_ACTIVE_DEVICE: 'Spotify 앱에서 먼저 곡을 재생해 주세요',
  FAILED: 'Spotify와 연결하지 못했어요',
};

export function spotifyFailureMessage(error: unknown, fallback: string) {
  return error instanceof SpotifyError
    ? failureMessages[error.reason]
    : fallback;
}

// The playback state from GET /me/player, trimmed to what 2.7 shows.
type Playback = {
  is_playing: boolean;
  progress_ms: number | null;
  item: {
    id: string;
    name: string;
    duration_ms: number;
    // A song carries its artists and album; a podcast episode its show and images.
    artists?: { name: string }[];
    album?: { images: { url: string }[] };
    show?: { name: string };
    images?: { url: string }[];
  } | null;
};

export function trackOf(playback: Playback): MusicState['nowPlaying'] {
  const item = playback.item;
  if (!item) {
    return null;
  }
  // Spotify lists the images widest first; the first fills the 370×500 card best.
  const images = item.album?.images ?? item.images ?? [];
  const track: Track = {
    id: item.id,
    title: item.name,
    // MUS-004: the card names the artist.
    subtitle:
      item.artists?.map(artist => artist.name).join(', ') ??
      item.show?.name ??
      '',
    durationSec: Math.round(item.duration_ms / 1000),
    artworkUrl: images[0]?.url ?? null,
  };
  return {
    ...track,
    positionSec: Math.round((playback.progress_ms ?? 0) / 1000),
    playing: playback.is_playing,
  };
}

// The 2.7·2.8 music repository with Spotify on the Web API; 멜론 and 음악 없음 stay with `base`.
// Spotify applies a command a moment later, so the state is read back every `settleMs` until it shows the
// command, a few times at most (MUS-004).
export function withSpotify(
  base: Music,
  clientId: string,
  { settleMs = 400 } = {},
): Music {
  let premium: boolean | null = null;
  // The song last read, so 이전 · 다음 can tell when Spotify has moved on.
  let lastTrackId: string | null = null;

  async function call<T>(
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    retried = false,
  ): Promise<T | null> {
    const token = await spotifyAccessToken(clientId, { force: retried });
    if (!token) {
      throw new SpotifyError('SIGNED_OUT');
    }
    let response: Response;
    try {
      response = await fetch(`https://api.spotify.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new SpotifyError('FAILED', 'network');
    }
    if (response.status === 401 && !retried) {
      return call(method, path, true);
    }
    if (response.status === 204 || response.status === 202) {
      return null;
    }
    if (!response.ok) {
      throw new SpotifyError(
        response.status === 401
          ? 'SIGNED_OUT'
          : response.status === 403
          ? 'PREMIUM_REQUIRED'
          : response.status === 404
          ? 'NO_ACTIVE_DEVICE'
          : 'FAILED',
        `${method} ${path} ${response.status}`,
      );
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  async function getState(): Promise<MusicState> {
    const state = await base.getState();
    const tokens = await spotifyTokens.load();
    const services = {
      ...state.services,
      SPOTIFY: tokens ? ('CONNECTED' as const) : ('LOGIN_REQUIRED' as const),
    };
    if (state.source !== 'SPOTIFY') {
      return { ...state, services };
    }
    // Spotify has no song lists on the card (2.7 핸드오프), only what is playing now.
    const spotify = { ...state, services, library: null };
    if (!tokens) {
      // Picked but signed out: 2.7b 연결이 끊겼어요 offers 다시 연결.
      return { ...spotify, linked: false, nowPlaying: null };
    }
    try {
      if (premium === null) {
        const me = await call<{ product?: string }>('GET', '/me');
        premium = me?.product === 'premium';
      }
      // 204: nothing is playing on any of the account's devices.
      const playback = await call<Playback>('GET', '/me/player');
      const nowPlaying = playback ? trackOf(playback) : null;
      lastTrackId = nowPlaying?.id ?? null;
      return { ...spotify, linked: true, premium, nowPlaying };
    } catch (error) {
      if (error instanceof SpotifyError && error.reason === 'SIGNED_OUT') {
        return { ...spotify, linked: false, nowPlaying: null };
      }
      throw error;
    }
  }

  // Runs a player command on Spotify, or on `base` for 멜론, then reads the state back until it shows the
  // command; after the last try the card shows whatever Spotify reports.
  function command(
    method: 'PUT' | 'POST',
    path: string,
    fallback: () => Promise<MusicState>,
    applied: (state: MusicState, before: string | null) => boolean,
  ) {
    return async () => {
      const state = await base.getState();
      if (state.source !== 'SPOTIFY') {
        return fallback();
      }
      const before = lastTrackId;
      await call(method, path);
      let next = state;
      for (let tries = 0; tries < 4; tries++) {
        await new Promise<void>(resolve =>
          setTimeout(() => resolve(), settleMs),
        );
        next = await getState();
        if (applied(next, before)) {
          break;
        }
      }
      return next;
    };
  }

  const isPlaying = (state: MusicState) => state.nowPlaying?.playing === true;
  const moved = (state: MusicState, before: string | null) =>
    (state.nowPlaying?.id ?? null) !== before;

  async function signIn() {
    await signInToSpotify(clientId);
    premium = null;
    await base.resolveService('SPOTIFY');
  }

  return {
    getState,
    selectSource: async source => {
      await base.selectSource(source);
      return getState();
    },
    resolveService: async service => {
      if (service !== 'SPOTIFY') {
        await base.resolveService(service);
        return getState();
      }
      await signIn();
      return getState();
    },
    reconnect: async () => {
      const state = await base.getState();
      if (state.source !== 'SPOTIFY') {
        await base.reconnect();
      } else if (!(await spotifyTokens.load())) {
        await signIn();
      }
      return getState();
    },
    play: command('PUT', '/me/player/play', base.play, isPlaying),
    pause: command(
      'PUT',
      '/me/player/pause',
      base.pause,
      state => !isPlaying(state),
    ),
    next: command('POST', '/me/player/next', base.next, moved),
    previous: command('POST', '/me/player/previous', base.previous, moved),
  };
}
