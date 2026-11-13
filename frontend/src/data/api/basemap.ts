import { appConfig } from '../../config';
import type { CourseBasemap } from '../types';

// C03 basemap (docs/design/api/courses.md, S15P31E105-612): `{ imageUrl, osmDataTimestamp }`, a server-rendered flat
// map PNG with the course on it. An older server leaves the field out; anything that cannot be loaded is null, never
// guessed, so the card keeps its plain outline.

// A relative address is made whole on the API server's origin, as profile photos are (api/profile.ts). A course
// basemap is public and loaded without the app's Authorization header; an own run thumbnail (S15P31E105-756) is
// loaded with ownImageSource, which adds the token for this origin only.
const serverOrigin = appConfig.apiBaseUrl.replace(
  /^(https?:\/\/[^/]+).*$/,
  '$1',
);

// The image's address ready for <Image>: an http(s) one as it came, a relative path ('/api/v1/…') on the server's
// origin; null for anything else (empty, another scheme, protocol-relative, not a string).
export function basemapImageAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const address = raw.trim();
  if (!address || /\s/.test(address)) {
    return null;
  }
  if (/^https?:\/\/[^/]/i.test(address)) {
    return address;
  }
  if (address.startsWith('/') && !address.startsWith('//')) {
    return serverOrigin + address;
  }
  return null;
}

// null for a missing or unreadable basemap; otherwise its loadable image address.
export function basemapOf(raw: unknown): CourseBasemap | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const { imageUrl, osmDataTimestamp } = raw as {
    imageUrl?: unknown;
    osmDataTimestamp?: unknown;
  };
  const address = basemapImageAddress(imageUrl);
  if (!address) {
    return null;
  }
  return {
    imageUrl: address,
    osmDataTimestamp:
      typeof osmDataTimestamp === 'string' ? osmDataTimestamp : null,
  };
}
