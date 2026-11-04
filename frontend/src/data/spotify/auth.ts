// Polyfills crypto.getRandomValues, which Hermes lacks, for the PKCE secrets below.
import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';
import { AppState, Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';

export const spotifyRedirectUri = 'runway://spotify-callback';

// 지금 곡·표지 (playback state), Premium 여부 (product), 재생 제어.
const scopes = [
  'user-read-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
];

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  // Epoch milliseconds.
  expiresAt: number;
};

// Why a Spotify call failed, so the screens can say what to do.
export type SpotifyFailure =
  | 'CANCELED'
  | 'SIGNED_OUT'
  | 'PREMIUM_REQUIRED'
  | 'NO_ACTIVE_DEVICE'
  | 'FAILED';

export class SpotifyError extends Error {
  readonly reason: SpotifyFailure;

  constructor(reason: SpotifyFailure, message: string = reason) {
    super(message);
    this.name = 'SpotifyError';
    this.reason = reason;
  }
}

const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Base64url without padding (RFC 4648 §5), as PKCE wants it. It packs bits, hence the bitwise operators.
/* eslint-disable no-bitwise */
export function base64Url(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) {
      out += alphabet[(n >> (18 - j * 6)) & 63];
    }
  }
  return out;
}
/* eslint-enable no-bitwise */

// Set up by react-native-get-random-values; the app's TypeScript libraries carry no Web Crypto types.
declare const crypto: {
  getRandomValues: <T extends Uint8Array>(array: T) => T;
};

function randomToken(byteLength: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// S256 code challenge of a PKCE verifier (RFC 7636 §4.2).
export function codeChallenge(verifier: string) {
  return base64Url(sha256.array(verifier));
}

function query(params: Record<string, string>) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function paramsOf(url: string) {
  const params: Record<string, string> = {};
  const search = url.split('?')[1]?.split('#')[0] ?? '';
  for (const pair of search.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(
        value.replace(/\+/g, ' '),
      );
    }
  }
  return params;
}

// Opens Spotify's sign-in page and waits for it to come back to runway://spotify-callback.
// Coming back to the app without the redirect (the browser closed) counts as canceled.
function waitForCode(url: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let left = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      links.remove();
      appState.remove();
      clearTimeout(timer);
    };
    const links = Linking.addEventListener('url', event => {
      if (!event.url.startsWith(spotifyRedirectUri)) {
        return;
      }
      finish();
      const params = paramsOf(event.url);
      if (params.state !== state) {
        reject(new SpotifyError('FAILED', 'state mismatch'));
      } else if (params.code) {
        resolve(params.code);
      } else {
        // access_denied: the user pressed 취소 on Spotify's page.
        reject(new SpotifyError('CANCELED', params.error));
      }
    });
    const appState = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        left = true;
      } else if (left) {
        // The redirect can land a moment after the app shows again.
        timer = setTimeout(() => {
          finish();
          reject(new SpotifyError('CANCELED'));
        }, 1500);
      }
    });
    Linking.openURL(url).catch(() => {
      finish();
      reject(new SpotifyError('FAILED', 'could not open the sign-in page'));
    });
  });
}

const service = 'com.runway.health.spotify';
let current: SpotifyTokens | null | undefined;

// Spotify's tokens in the device keystore, apart from RunWay's own (src/data/api/tokenStore.ts).
export const spotifyTokens = {
  async load(): Promise<SpotifyTokens | null> {
    if (current !== undefined) {
      return current;
    }
    try {
      const saved = await Keychain.getGenericPassword({ service });
      const value = saved ? JSON.parse(saved.password) : null;
      current =
        typeof value?.accessToken === 'string' &&
        typeof value?.refreshToken === 'string' &&
        typeof value?.expiresAt === 'number'
          ? value
          : null;
    } catch {
      current = null;
    }
    return current ?? null;
  },

  async save(tokens: SpotifyTokens) {
    current = tokens;
    await Keychain.setGenericPassword('spotify', JSON.stringify(tokens), {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  async clear() {
    current = null;
    await Keychain.resetGenericPassword({ service });
  },
};

async function requestTokens(
  body: Record<string, string>,
  refreshToken?: string,
): Promise<SpotifyTokens> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: query(body),
  });
  if (!response.ok) {
    // invalid_grant: the refresh token was revoked or expired.
    throw new SpotifyError(
      response.status === 400 ? 'SIGNED_OUT' : 'FAILED',
      `token ${response.status}`,
    );
  }
  const json = await response.json();
  return {
    accessToken: json.access_token,
    // A refresh may leave the old refresh token in place.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

// 2.8 Spotify 로그인: Authorization Code with PKCE (developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).
export async function signInToSpotify(clientId: string) {
  const verifier = randomToken(32);
  const state = randomToken(16);
  const code = await waitForCode(
    `https://accounts.spotify.com/authorize?${query({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: spotifyRedirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge(verifier),
      state,
      scope: scopes.join(' '),
    })}`,
    state,
  );
  const tokens = await requestTokens({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri,
    code_verifier: verifier,
  });
  await spotifyTokens.save(tokens);
  return tokens;
}

// An access token good for the next minute, refreshed when it is about to run out. null when signed out.
export async function spotifyAccessToken(
  clientId: string,
  { force = false } = {},
): Promise<string | null> {
  const tokens = await spotifyTokens.load();
  if (!tokens) {
    return null;
  }
  if (!force && tokens.expiresAt - 60_000 > Date.now()) {
    return tokens.accessToken;
  }
  try {
    const next = await requestTokens(
      {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      },
      tokens.refreshToken,
    );
    await spotifyTokens.save(next);
    return next.accessToken;
  } catch (error) {
    if (error instanceof SpotifyError && error.reason === 'SIGNED_OUT') {
      await spotifyTokens.clear();
      return null;
    }
    throw error;
  }
}
