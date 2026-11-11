// Polyfills crypto.getRandomValues, which Hermes lacks, for the PKCE secrets below.
import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';
import { AppState, Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { AppAuthorization, AppAuthorizationRequest } from './remoteBridge';

export const spotifyRedirectUri = 'runway://spotify-callback';

// 지금 곡·표지 (playback state), Premium 여부 (product), 재생 제어, 2.7 내 재생 목록 (비공개 목록 포함)과 최근 들은 곡.
// An account signed in before these scopes gets 403 for them until it signs in again (SCOPE_REQUIRED).
const scopes = [
  'user-read-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-recently-played',
];

// App Remote's playback grant, asked for with the list scopes in one Spotify app consent (S15P31E105-573).
const appRemoteScope = 'app-remote-control';

// The Spotify account the tokens belong to, shown so the user can check it (GET /me).
export type SpotifyAccount = { id: string; name: string };

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  // Epoch milliseconds.
  expiresAt: number;
  // 'app': signed in through the Spotify app on this phone, the account App Remote uses. Missing for a browser
  // sign-in, whose account can differ from the phone's.
  via?: 'app';
  account?: SpotifyAccount;
};

// Why a Spotify call failed, so the screens can say what to do.
export type SpotifyFailure =
  | 'CANCELED'
  | 'SIGNED_OUT'
  | 'USER_NOT_REGISTERED'
  | 'PREMIUM_REQUIRED'
  | 'NO_HISTORY'
  | 'NO_ACTIVE_DEVICE'
  // Signed in before 내 재생 목록 · 최근 들은 곡 asked for their scopes: Spotify answers 403 until a new sign-in.
  | 'SCOPE_REQUIRED'
  // The list permission was granted once, but Spotify no longer refreshes it (revoked or expired).
  | 'LIBRARY_EXPIRED'
  // Lists signed in through the browser, whose account may not be the Spotify app's on this phone.
  | 'ACCOUNT_CHECK'
  // The user declined Spotify's consent, as opposed to closing it (CANCELED).
  | 'DENIED'
  // The Spotify app on this phone cannot sign in with PKCE yet.
  | 'APP_UPDATE_REQUIRED'
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
      const account = value?.account;
      current =
        typeof value?.accessToken === 'string' &&
        typeof value?.refreshToken === 'string' &&
        typeof value?.expiresAt === 'number'
          ? {
              accessToken: value.accessToken,
              refreshToken: value.refreshToken,
              expiresAt: value.expiresAt,
              ...(value.via === 'app' ? { via: 'app' as const } : {}),
              ...(typeof account?.id === 'string' &&
              typeof account?.name === 'string'
                ? { account: { id: account.id, name: account.name } }
                : {}),
            }
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
      show_dialog: 'true',
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

const appFailures: Partial<Record<string, SpotifyFailure>> = {
  CANCELED: 'CANCELED',
  DENIED: 'DENIED',
  APP_UPDATE_REQUIRED: 'APP_UPDATE_REQUIRED',
  USER_NOT_REGISTERED: 'USER_NOT_REGISTERED',
};

async function accountOf(accessToken: string): Promise<SpotifyAccount> {
  let response: Response;
  try {
    response = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new SpotifyError('FAILED', 'network');
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SpotifyError(
      /the user is not registered for this application/i.test(text)
        ? 'USER_NOT_REGISTERED'
        : 'FAILED',
      `GET /me ${response.status}`,
    );
  }
  const me = await response.json();
  const id = String(me?.id ?? '');
  return { id, name: me?.display_name || id };
}

// S15P31E105-573 Android: one consent in the Spotify app for App Remote and the lists, as the account signed in
// there. The app gets only the S256 challenge; the code comes back here and is exchanged with the verifier,
// like the browser sign-in (Authorization Code with PKCE).
export async function signInWithSpotifyApp(
  clientId: string,
  authorize: (request: AppAuthorizationRequest) => Promise<AppAuthorization>,
): Promise<SpotifyTokens> {
  const verifier = randomToken(32);
  const state = randomToken(16);
  let answer: AppAuthorization;
  try {
    answer = await authorize({
      clientId,
      redirectUri: spotifyRedirectUri,
      scopes: [...scopes, appRemoteScope],
      codeChallenge: codeChallenge(verifier),
      state,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? '';
    throw new SpotifyError(appFailures[code] ?? 'FAILED', code || undefined);
  }
  if (answer.state !== state || !answer.code) {
    throw new SpotifyError('FAILED', 'state mismatch');
  }
  let tokens: SpotifyTokens;
  try {
    tokens = await requestTokens({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: answer.code,
      redirect_uri: spotifyRedirectUri,
      code_verifier: verifier,
    });
  } catch (error) {
    // A rejected exchange right after consent is not a sign-out of an earlier session.
    throw error instanceof SpotifyError && error.reason === 'SIGNED_OUT'
      ? new SpotifyError('FAILED', error.message)
      : error;
  }
  return {
    ...tokens,
    via: 'app',
    account: await accountOf(tokens.accessToken),
  };
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
    const next = {
      // The same account and sign-in, with new tokens.
      ...tokens,
      ...(await requestTokens(
        {
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        },
        tokens.refreshToken,
      )),
    };
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
