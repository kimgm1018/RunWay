import { appConfig } from '../config';

// 경로 재생 링크 (S15P31E105-704): https://k15e105.p.ssafy.io/r/{token} opens a run someone shared, /p/{postId} a
// community post's course replay. Android App Links hand them to the app; anything else (the Spotify sign-in
// callback, other pages of the site) is not ours and is left alone.

export type ShareLink =
  | { kind: 'run'; token: string }
  | { kind: 'post'; postId: string };

// The server's link token: 32 random bytes in URL-safe base64 without padding.
const runToken = /^[A-Za-z0-9_-]{43}$/;
const postId = /^[A-Za-z0-9_-]{1,64}$/;

export function parseShareLink(url: string | null | undefined): ShareLink | null {
  if (!url) {
    return null;
  }
  const base = appConfig.shareBaseUrl.replace(/\/+$/, '');
  if (!url.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return null;
  }
  // The path alone: no query or fragment, no trailing slash.
  const path = url
    .slice(base.length)
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');
  const [, kind, id, ...rest] = path.split('/');
  if (rest.length > 0 || !id) {
    return null;
  }
  if (kind === 'r' && runToken.test(id)) {
    return { kind: 'run', token: id };
  }
  if (kind === 'p' && postId.test(id)) {
    return { kind: 'post', postId: id };
  }
  return null;
}

export const runShareUrl = (token: string) =>
  `${appConfig.shareBaseUrl}/r/${token}`;
export const postShareUrl = (id: string) => `${appConfig.shareBaseUrl}/p/${id}`;
