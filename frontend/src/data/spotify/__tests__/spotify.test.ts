import { AppState, Linking } from 'react-native';
import { withSavedMusic } from '../../music/withSavedMusic';
import { createMockRepositories } from '../../mock/createMockRepositories';
import {
  base64Url,
  codeChallenge,
  signInToSpotify,
  SpotifyError,
  spotifyRedirectUri,
  spotifyTokens,
} from '../auth';
import {
  playlistOf,
  recentTracksOf,
  spotifyFailureMessage,
  trackOf,
  withSpotify,
} from '../music';

type Reply = { status: number; body?: unknown; text?: string };

// Answers fetch in order and keeps what was asked.
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 500 };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () =>
        reply.text ??
        (reply.body === undefined ? '' : JSON.stringify(reply.body)),
      json: async () => reply.body,
    };
  }) as unknown as typeof fetch;
  return calls;
}

const playback = {
  is_playing: true,
  progress_ms: 84_400,
  item: {
    id: 'trk1',
    name: 'Ocean Run',
    duration_ms: 221_000,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: {
      images: [
        { url: 'https://i.scdn.co/image/640' },
        { url: 'https://i.scdn.co/image/300' },
      ],
    },
  },
};

const music = (settleMs = 0) =>
  withSpotify(createMockRepositories({ latencyMs: 0 }).music, 'client-1', {
    settleMs,
  });

const signedIn = () =>
  spotifyTokens.save({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
  });

const realFetch = globalThis.fetch;

beforeEach(async () => {
  await spotifyTokens.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = realFetch;
});

// Expected values worked out with Node's Buffer and crypto.
test('PKCE strings are base64url without padding and the challenge is the S256 of the verifier', () => {
  const bytes = (length: number) =>
    Uint8Array.from({ length }, (_, i) => (i * 97 + 13) % 256);
  expect(base64Url(bytes(1))).toBe('DQ');
  expect(base64Url(bytes(2))).toBe('DW4');
  expect(base64Url(bytes(3))).toBe('DW7P');
  expect(base64Url(bytes(16))).toBe('DW7PMJHyU7QVdtc4mfpbvA');
  expect(codeChallenge('dBjftJeZ4CVP-mJ0vK1BnbPdPNkIUZJ3pTqqTPQFAdk')).toBe(
    'mQJpMSmaAzpGfRAwuyZEKoWMD5AetdaHNoMVjoXrKMQ',
  );
});

test('a song becomes the card track with its artists and widest album image', () => {
  expect(trackOf(playback)).toEqual({
    id: 'trk1',
    title: 'Ocean Run',
    subtitle: 'A, B',
    durationSec: 221,
    artworkUrl: 'https://i.scdn.co/image/640',
    positionSec: 84,
    playing: true,
  });
  expect(
    trackOf({
      is_playing: false,
      progress_ms: null,
      item: {
        id: 'ep1',
        name: 'Episode',
        duration_ms: 60_000,
        show: { name: 'Show' },
        images: [],
      },
    }),
  ).toMatchObject({ subtitle: 'Show', artworkUrl: null, positionSec: 0 });
  expect(trackOf({ is_playing: false, progress_ms: null, item: null })).toBe(
    null,
  );
});

test('without a Spotify sign-in, Spotify needs 로그인 and picking it shows 연결이 끊겼어요', async () => {
  const calls = fakeFetch([]);
  const repo = music();
  expect((await repo.getState()).services.SPOTIFY).toBe('LOGIN_REQUIRED');
  const picked = await repo.selectSource('SPOTIFY');
  expect(picked).toMatchObject({
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
  });
  expect(calls).toHaveLength(0);
});

test('signed in, the card reads what plays now with its cover and the Premium flag', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
  ]);
  const state = await music().selectSource('SPOTIFY');
  expect(state).toMatchObject({
    source: 'SPOTIFY',
    services: { SPOTIFY: 'CONNECTED' },
    linked: true,
    premium: true,
    library: null,
    nowPlaying: {
      title: 'Ocean Run',
      artworkUrl: 'https://i.scdn.co/image/640',
    },
  });
  expect(calls.map(call => call.url)).toEqual([
    'https://api.spotify.com/v1/me',
    'https://api.spotify.com/v1/me/player',
  ]);
  expect(calls[0].init.headers).toEqual({ Authorization: 'Bearer access-1' });
});

test('nothing playing (204) leaves the card without a track', async () => {
  await signedIn();
  fakeFetch([{ status: 200, body: { product: 'free' } }, { status: 204 }]);
  expect(await music().selectSource('SPOTIFY')).toMatchObject({
    premium: false,
    nowPlaying: null,
  });
});

test('a command goes to the Spotify player and the card shows the state read back', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
    { status: 204 },
    { status: 200, body: { ...playback, is_playing: false } },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  const paused = await repo.pause();
  expect(calls[2]).toMatchObject({
    url: 'https://api.spotify.com/v1/me/player/pause',
    init: { method: 'PUT' },
  });
  expect(paused.nowPlaying?.playing).toBe(false);
});

test('the state is read again until Spotify shows the command', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
    { status: 204 },
    // Still the old song, then the next one.
    { status: 200, body: playback },
    {
      status: 200,
      body: {
        ...playback,
        item: { ...playback.item, id: 'trk2', name: 'Next' },
      },
    },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  expect((await repo.next()).nowPlaying?.title).toBe('Next');
  expect(calls).toHaveLength(5);
});

test('a free account or no active device turns into a message, not a silent success', async () => {
  await signedIn();
  fakeFetch([
    { status: 200, body: { product: 'free' } },
    { status: 200, body: playback },
    {
      status: 403,
      body: {
        error: { reason: 'PREMIUM_REQUIRED', message: 'Premium required' },
      },
    },
    { status: 404 },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  const premium = await repo.next().catch(error => error);
  expect(premium).toBeInstanceOf(SpotifyError);
  // A rejected command does not mean the account's playback connection was lost.
  expect(premium.state).toBeUndefined();
  expect(spotifyFailureMessage(premium, '')).toBe(
    'Spotify Premium에서만 조작할 수 있어요',
  );
  const device = await repo.play().catch(error => error);
  expect(spotifyFailureMessage(device, '')).toBe(
    'Spotify 앱에서 먼저 곡을 재생해 주세요',
  );
});

test('an expiring token is refreshed before the call, keeping the old refresh token', async () => {
  await spotifyTokens.save({
    accessToken: 'old',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 10_000,
  });
  const calls = fakeFetch([
    { status: 200, body: { access_token: 'new', expires_in: 3600 } },
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
  ]);
  await music().selectSource('SPOTIFY');
  expect(calls[0].url).toBe('https://accounts.spotify.com/api/token');
  expect(calls[0].init.body).toBe(
    'client_id=client-1&grant_type=refresh_token&refresh_token=refresh-1',
  );
  expect(calls[1].init.headers).toEqual({ Authorization: 'Bearer new' });
  expect(await spotifyTokens.load()).toMatchObject({
    accessToken: 'new',
    refreshToken: 'refresh-1',
  });
});

test('a revoked refresh token signs Spotify out', async () => {
  await spotifyTokens.save({
    accessToken: 'old',
    refreshToken: 'gone',
    expiresAt: Date.now() - 1,
  });
  fakeFetch([{ status: 400 }]);
  const state = await music().selectSource('SPOTIFY');
  expect(state).toMatchObject({ linked: false, nowPlaying: null });
  expect(await spotifyTokens.load()).toBe(null);
});

test('a playlist keeps its widest cover and its song count under either name', () => {
  expect(
    playlistOf({
      id: 'pl1',
      name: 'Long Run',
      images: [{ url: 'https://i.scdn.co/image/640' }],
      tracks: { total: 42 },
    }),
  ).toEqual({
    id: 'pl1',
    title: 'Long Run',
    artworkUrl: 'https://i.scdn.co/image/640',
    trackCount: 42,
  });
  expect(
    playlistOf({ id: 'pl2', name: 'Easy', images: null, items: { total: 7 } }),
  ).toMatchObject({ artworkUrl: null, trackCount: 7 });
});

test('signed in, 내 재생 목록 reads the account playlists', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
    {
      status: 200,
      body: {
        items: [
          { id: 'pl1', name: 'Long Run', images: [], tracks: { total: 3 } },
          null,
        ],
      },
    },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  expect(await repo.getPlaylists()).toEqual([
    { id: 'pl1', title: 'Long Run', artworkUrl: null, trackCount: 3 },
  ]);
  expect(calls[2].url).toBe('https://api.spotify.com/v1/me/playlists?limit=20');
});

test('a playlist starts on the player with its context and the card shows what plays', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 204 },
    { status: 204 },
    { status: 200, body: playback },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  const state = await repo.playPlaylist('pl1');
  expect(calls[2]).toMatchObject({
    url: 'https://api.spotify.com/v1/me/player/play',
    init: {
      method: 'PUT',
      body: JSON.stringify({ context_uri: 'spotify:playlist:pl1' }),
      headers: {
        Authorization: 'Bearer access-1',
        'Content-Type': 'application/json',
      },
    },
  });
  expect(state.nowPlaying).toMatchObject({ title: 'Ocean Run', playing: true });
});

test('a sign-in from before the playlist scopes asks to sign in again', async () => {
  await signedIn();
  fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 204 },
    { status: 403 },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  const error = await repo.getPlaylists().catch(caught => caught);
  expect(error).toMatchObject({ reason: 'SCOPE_REQUIRED' });
  expect(spotifyFailureMessage(error, '')).toBe(
    '목록을 보려면 Spotify에 다시 로그인해 주세요',
  );
});

test('최근 들은 곡 keeps each song once, where it was heard last', () => {
  const song = (id: string, name: string) => ({
    track: {
      id,
      name,
      duration_ms: 200_400,
      artists: [{ name: 'A' }],
      album: { images: [{ url: `https://i.scdn.co/${id}` }] },
    },
  });
  expect(
    recentTracksOf([
      song('t1', 'One'),
      song('t2', 'Two'),
      song('t1', 'One'),
      { track: null },
    ]),
  ).toEqual([
    {
      id: 't1',
      title: 'One',
      subtitle: 'A',
      durationSec: 200,
      artworkUrl: 'https://i.scdn.co/t1',
    },
    {
      id: 't2',
      title: 'Two',
      subtitle: 'A',
      durationSec: 200,
      artworkUrl: 'https://i.scdn.co/t2',
    },
  ]);
});

test('최근 들은 곡 reads the recently played list and a song starts by its uri', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 204 },
    {
      status: 200,
      body: {
        items: [
          { track: { id: 'trk1', name: 'Ocean Run', duration_ms: 221_000 } },
        ],
      },
    },
    { status: 204 },
    { status: 200, body: playback },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  expect(await repo.getRecentTracks()).toMatchObject([
    { id: 'trk1', title: 'Ocean Run' },
  ]);
  expect(calls[2].url).toBe(
    'https://api.spotify.com/v1/me/player/recently-played?limit=20',
  );
  const state = await repo.playTrack('trk1');
  expect(calls[3]).toMatchObject({
    url: 'https://api.spotify.com/v1/me/player/play',
    init: {
      method: 'PUT',
      body: JSON.stringify({ uris: ['spotify:track:trk1'] }),
    },
  });
  expect(state.nowPlaying?.playing).toBe(true);
});

test('signed out or on 멜론, 내 재생 목록 is empty without asking Spotify', async () => {
  const calls = fakeFetch([]);
  const repo = music();
  expect(await repo.getPlaylists()).toEqual([]);
  expect(await repo.getRecentTracks()).toEqual([]);
  await repo.selectSource('SPOTIFY');
  expect(await repo.getPlaylists()).toEqual([]);
  expect(await repo.getRecentTracks()).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('멜론 commands stay with the mock player', async () => {
  const calls = fakeFetch([]);
  const repo = music();
  expect((await repo.pause()).nowPlaying?.playing).toBe(false);
  const before = (await repo.getState()).nowPlaying?.id;
  expect((await repo.next()).nowPlaying?.id).not.toBe(before);
  expect(calls).toHaveLength(0);
});

test('sign-in opens Spotify with an S256 challenge and trades the code with the matching verifier', async () => {
  let onUrl: ((event: { url: string }) => void) | undefined;
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (event: { url: string }) => void,
  ) => {
    onUrl = handler;
    return { remove: jest.fn() };
  }) as never);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((() => ({ remove: jest.fn() })) as never);
  const opened = jest
    .spyOn(Linking, 'openURL')
    .mockImplementation(async () => true);
  const calls = fakeFetch([
    {
      status: 200,
      body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
    },
  ]);

  const done = signInToSpotify('client-1');
  await Promise.resolve();
  const authorize = new URL(opened.mock.calls[0][0]);
  expect(authorize.origin + authorize.pathname).toBe(
    'https://accounts.spotify.com/authorize',
  );
  expect(authorize.searchParams.get('redirect_uri')).toBe(spotifyRedirectUri);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('show_dialog')).toBe('true');
  onUrl?.({
    url: `${spotifyRedirectUri}?code=xyz&state=${authorize.searchParams.get(
      'state',
    )}`,
  });
  await done;

  const body = new URLSearchParams(String(calls[0].init.body));
  expect(body.get('code')).toBe('xyz');
  expect(codeChallenge(body.get('code_verifier') ?? '')).toBe(
    authorize.searchParams.get('code_challenge'),
  );
  expect(await spotifyTokens.load()).toMatchObject({
    accessToken: 'a',
    refreshToken: 'r',
  });
});

test('a redirect with another state is refused', async () => {
  let onUrl: ((event: { url: string }) => void) | undefined;
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (event: { url: string }) => void,
  ) => {
    onUrl = handler;
    return { remove: jest.fn() };
  }) as never);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((() => ({ remove: jest.fn() })) as never);
  jest.spyOn(Linking, 'openURL').mockImplementation(async () => true);
  const done = signInToSpotify('client-1').catch(error => error);
  await Promise.resolve();
  onUrl?.({ url: `${spotifyRedirectUri}?code=xyz&state=forged` });
  expect((await done).reason).toBe('FAILED');
  expect(await spotifyTokens.load()).toBe(null);
});

test.each([
  [
    'plain text',
    { status: 403, text: 'The user is not registered for this application' },
  ],
  [
    'JSON',
    {
      status: 403,
      body: {
        error: {
          status: 403,
          message: 'The user is not registered for this application',
        },
      },
    },
  ],
])(
  'an unregistered account (%s) is signed out with a dashboard instruction and disconnected snapshot',
  async (_format, reply) => {
    await signedIn();
    fakeFetch([reply]);
    const repo = music();
    const error = await repo.selectSource('SPOTIFY').catch(value => value);
    expect(error.reason).toBe('USER_NOT_REGISTERED');
    expect(spotifyFailureMessage(error, '')).toContain('대시보드');
    expect(error.state).toMatchObject({
      source: 'SPOTIFY',
      linked: false,
      nowPlaying: null,
      services: { SPOTIFY: 'LOGIN_REQUIRED' },
    });
    expect(await spotifyTokens.load()).toBeNull();
    expect(await repo.getState()).toMatchObject({
      services: { SPOTIFY: 'LOGIN_REQUIRED' },
      linked: false,
      nowPlaying: null,
    });
  },
);

test.each([
  { status: 403 },
  { status: 403, text: '<html>Forbidden</html>' },
  { status: 403, body: { error: { message: 'Insufficient client scope' } } },
])(
  'an unrelated 403 is not reported as Premium and keeps the account',
  async reply => {
    await signedIn();
    fakeFetch([reply]);
    const error = await music()
      .selectSource('SPOTIFY')
      .catch(value => value);
    expect(error.reason).toBe('FAILED');
    expect(error.state).toMatchObject({ linked: false, nowPlaying: null });
    expect(await spotifyTokens.load()).not.toBeNull();
  },
);

test('a failed playback read carries a disconnected state instead of the previous song', async () => {
  await signedIn();
  fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
    { status: 503 },
  ]);
  const repo = music();
  await repo.selectSource('SPOTIFY');
  const error = await repo.getState().catch(value => value);
  expect(error.state).toMatchObject({
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
    library: null,
  });
});

test('a failed Spotify read still persists a new source across a relaunch', async () => {
  await signedIn();
  const repo = withSavedMusic(music());
  fakeFetch([]);
  await repo.selectSource('MELON');
  const error = await repo.selectSource('SPOTIFY').catch(value => value);
  expect(error.state).toMatchObject({
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
  });
  await spotifyTokens.clear();
  expect(await withSavedMusic(music()).getState()).toMatchObject({
    source: 'SPOTIFY',
    linked: false,
    nowPlaying: null,
  });
});

test('launching on Spotify still reports an unregistered account after restoring the saved source', async () => {
  await signedIn();
  fakeFetch([
    { status: 403, text: 'The user is not registered for this application' },
  ]);
  const error = await withSavedMusic(music())
    .getState()
    .catch(value => value);
  expect(error.reason).toBe('USER_NOT_REGISTERED');
  expect(error.state).toMatchObject({
    linked: false,
    nowPlaying: null,
    services: { SPOTIFY: 'LOGIN_REQUIRED' },
  });
});

test.each(['play', 'pause', 'next', 'previous'] as const)(
  'a successful %s command with a non-JSON body reads back playback without a false error',
  async command => {
    await signedIn();
    const updated = {
      ...playback,
      is_playing: command !== 'pause',
      item: { ...playback.item, id: 'trk2' },
    };
    fakeFetch([
      { status: 200, body: { product: 'premium' } },
      { status: 200, body: playback },
      // Real-device Spotify player commands can reply 200 with a non-JSON success body.
      { status: 200, text: 'accepted' },
      { status: 200, body: updated },
    ]);
    const repo = music();
    await repo.selectSource('SPOTIFY');
    await expect(repo[command]()).resolves.toMatchObject({
      linked: true,
      nowPlaying: { id: 'trk2', playing: command !== 'pause' },
    });
  },
);

test('an already-applied command reads back immediately instead of waiting for the retry interval', async () => {
  await signedIn();
  const calls = fakeFetch([
    { status: 200, body: { product: 'premium' } },
    { status: 200, body: playback },
    { status: 204 },
    { status: 200, body: { ...playback, is_playing: false } },
  ]);
  const repo = music(1000);
  await repo.selectSource('SPOTIFY');
  jest.useFakeTimers();
  try {
    const paused = repo.pause();
    await jest.advanceTimersByTimeAsync(10);
    expect(calls.map(call => call.url)).toEqual([
      'https://api.spotify.com/v1/me',
      'https://api.spotify.com/v1/me/player',
      'https://api.spotify.com/v1/me/player/pause',
      'https://api.spotify.com/v1/me/player',
    ]);
    await expect(paused).resolves.toMatchObject({
      nowPlaying: { playing: false },
    });
  } finally {
    jest.useRealTimers();
  }
});
