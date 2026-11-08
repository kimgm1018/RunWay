import type { MusicState, Playlist, Repositories, Track } from '../types';
import {
  signInToSpotify,
  spotifyAccessToken,
  SpotifyError,
  spotifyTokens,
  type SpotifyFailure,
} from './auth';

type Music = Repositories['music'];

// A read can fail after the source was changed. Keep that result available to storage and screens.
export class SpotifyStateError extends SpotifyError {
  constructor(error: unknown, readonly state: MusicState) {
    super(error instanceof SpotifyError ? error.reason : 'FAILED');
  }
}

async function forbiddenReason(response: Response): Promise<SpotifyFailure> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return 'FAILED';
  }
  let reason = '';
  let message = text;
  try {
    const body = JSON.parse(text);
    reason = body?.error?.reason ?? '';
    message = body?.error?.message ?? text;
  } catch {
    // Development-mode allowlist errors can be plain text.
  }
  if (/the user is not registered for this application/i.test(message)) {
    return 'USER_NOT_REGISTERED';
  }
  return reason === 'PREMIUM_REQUIRED' || /premium required/i.test(message)
    ? 'PREMIUM_REQUIRED'
    : 'FAILED';
}

// What a toast says when a Spotify call fails; null when nothing needs saying (the user closed sign-in).
const failureMessages: Record<SpotifyFailure, string | null> = {
  CANCELED: null,
  SIGNED_OUT: 'Spotify에 다시 로그인해 주세요',
  USER_NOT_REGISTERED:
    'Spotify 개발자 대시보드의 User Management에 계정을 등록해 주세요. 다른 계정으로 다시 로그인할 수 있어요',
  PREMIUM_REQUIRED: 'Spotify Premium에서만 조작할 수 있어요',
  NO_HISTORY:
    'Spotify에 이어 들을 음악이 없어요. Spotify에서 재생할 음악을 선택해 주세요',
  NO_ACTIVE_DEVICE: 'Spotify 앱에서 먼저 곡을 재생해 주세요',
  SCOPE_REQUIRED: '목록을 보려면 Spotify에 다시 로그인해 주세요',
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

// A playlist from GET /me/playlists. Spotify has been renaming the song count from `tracks` to `items`.
type SpotifyPlaylist = {
  id: string;
  name: string;
  images: { url: string }[] | null;
  tracks?: { total: number } | null;
  items?: { total: number } | null;
};

export function playlistOf(item: SpotifyPlaylist): Playlist {
  return {
    id: item.id,
    title: item.name,
    artworkUrl: item.images?.[0]?.url ?? null,
    trackCount: (item.tracks ?? item.items)?.total,
  };
}

// A play from GET /me/player/recently-played.
type RecentPlay = {
  track: {
    id: string;
    name: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { images: { url: string }[] };
  } | null;
};

// Newest first and each song once: a song heard twice lately shows where it was heard last.
export function recentTracksOf(plays: RecentPlay[]): Track[] {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const { track } of plays) {
    if (!track || seen.has(track.id)) {
      continue;
    }
    seen.add(track.id);
    tracks.push({
      id: track.id,
      title: track.name,
      subtitle: track.artists?.map(artist => artist.name).join(', ') ?? '',
      durationSec: Math.round(track.duration_ms / 1000),
      artworkUrl: track.album?.images[0]?.url ?? null,
    });
  }
  return tracks;
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
    body?: object,
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
        headers: body
          ? {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          : { Authorization: `Bearer ${token}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new SpotifyError('FAILED', 'network');
    }
    if (response.status === 401 && !retried) {
      return call(method, path, body, true);
    }
    if (response.status === 204 || response.status === 202) {
      return null;
    }
    if (!response.ok) {
      const reason =
        response.status === 401
          ? 'SIGNED_OUT'
          : response.status === 403
          ? await forbiddenReason(response)
          : response.status === 404
          ? 'NO_ACTIVE_DEVICE'
          : 'FAILED';
      if (reason === 'USER_NOT_REGISTERED' || reason === 'SIGNED_OUT') {
        await spotifyTokens.clear();
        premium = null;
        lastTrackId = null;
      }
      throw new SpotifyError(reason, `${method} ${path} ${response.status}`);
    }
    // Player commands can return 200 with a non-JSON success body. Playback comes from the next GET.
    if (method !== 'GET') {
      return null;
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  // A read for 내 재생 목록 · 최근 들은 곡: 403 there (other than an account missing from User Management) is a
  // sign-in without their scopes, not a free account.
  async function readList<T>(path: string) {
    try {
      return await call<T>('GET', path);
    } catch (error) {
      throw error instanceof SpotifyError &&
        error.reason !== 'USER_NOT_REGISTERED' &&
        error.message.endsWith(' 403')
        ? new SpotifyError('SCOPE_REQUIRED', `GET ${path} 403`)
        : error;
    }
  }

  // Starts a playlist or a song on the account's active device (Premium), then reads the state back until a new
  // song plays.
  async function start(body: object) {
    const state = await base.getState();
    const before = lastTrackId;
    await call('PUT', '/me/player/play', body);
    let next = state;
    for (let tries = 0; tries < 4; tries++) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), settleMs));
      next = await getState();
      if (isPlaying(next) && moved(next, before)) {
        break;
      }
    }
    return next;
  }

  async function disconnected(state: MusicState): Promise<MusicState> {
    lastTrackId = null;
    return {
      ...state,
      linked: false,
      nowPlaying: null,
      library: null,
      services: {
        ...state.services,
        SPOTIFY: (await spotifyTokens.load()) ? 'CONNECTED' : 'LOGIN_REQUIRED',
      },
    };
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
      return disconnected(spotify);
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
        return disconnected(spotify);
      }
      throw new SpotifyStateError(error, await disconnected(spotify));
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
      try {
        await call(method, path);
      } catch (error) {
        if (
          error instanceof SpotifyError &&
          (error.reason === 'USER_NOT_REGISTERED' ||
            error.reason === 'SIGNED_OUT')
        ) {
          throw new SpotifyStateError(error, await disconnected(state));
        }
        throw error;
      }
      let next = state;
      for (let tries = 0; tries < 4; tries++) {
        if (tries > 0) {
          await new Promise<void>(resolve =>
            setTimeout(() => resolve(), settleMs),
          );
        }
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
    connectLibrary: signIn,
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
    getPlaylists: async () => {
      const state = await base.getState();
      if (state.source !== 'SPOTIFY') {
        return base.getPlaylists();
      }
      if (!(await spotifyTokens.load())) {
        return [];
      }
      const page = await readList<{ items: (SpotifyPlaylist | null)[] }>(
        '/me/playlists?limit=20',
      );
      return (page?.items ?? [])
        .filter((item): item is SpotifyPlaylist => item !== null)
        .map(playlistOf);
    },
    // The playlist from its first song.
    playPlaylist: async playlistId => {
      if ((await base.getState()).source !== 'SPOTIFY') {
        await base.playPlaylist(playlistId);
        return getState();
      }
      return start({ context_uri: `spotify:playlist:${playlistId}` });
    },
    getRecentTracks: async () => {
      if ((await base.getState()).source !== 'SPOTIFY') {
        return base.getRecentTracks();
      }
      if (!(await spotifyTokens.load())) {
        return [];
      }
      const page = await readList<{ items: RecentPlay[] }>(
        '/me/player/recently-played?limit=20',
      );
      return recentTracksOf(page?.items ?? []);
    },
    playTrack: async trackId => {
      if ((await base.getState()).source !== 'SPOTIFY') {
        await base.playTrack(trackId);
        return getState();
      }
      return start({ uris: [`spotify:track:${trackId}`] });
    },
  };
}
