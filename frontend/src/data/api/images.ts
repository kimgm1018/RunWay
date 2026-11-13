import { appConfig } from '../../config';
import { apiRequest } from './http';
import { tokenStore } from './tokenStore';

export type ImagePurpose = 'PROFILE' | 'CREW' | 'POST';

// A picked photo as React Native's FormData expects it. The server takes jpeg or png up to 5MB.
export type ImageFile = {
  uri: string;
  type: 'image/jpeg' | 'image/png';
  name: string;
};

export type UploadedImage = {
  // Passed on to U05·M03·CMT01.
  imageId: string;
  // Always null in the MVP; preview URLs come later (docs/design/api/files.md).
  url: string | null;
};

// F01 이미지 업로드 (multipart/form-data).
export function uploadImage(file: ImageFile, purpose: ImagePurpose) {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  return apiRequest<UploadedImage>('/images', {
    method: 'POST',
    body: form,
    timeoutMs: 60_000,
  });
}

// The server gives photos as the F02 path (/api/v1/images/…, ImageService.publicUrl). F02 is public, so the
// full address is enough for <Image>; an address that is already absolute is kept as it is.
const serverOrigin = appConfig.apiBaseUrl.replace(
  /^(https?:\/\/[^/]+).*$/,
  '$1',
);
export const imageAddress = (path: string | null | undefined) =>
  path == null || /^https?:\/\//.test(path)
    ? path ?? null
    : serverOrigin + path;

// S15P31E105-756 (ADR-0024): an image only its owner may see (own run-route thumbnail, H01 routePreviewImageUrl).
// F02 checks the viewer's token, so <Image> gets the signed-in user's Authorization header. Without a session the
// request goes without it and the server answers 404, which the card treats as no picture.
// The token goes only to the API server itself (its origin and a path below it), never to another host or scheme.
export function ownImageSource(uri: string) {
  const token = tokenStore.current()?.accessToken;
  return token && uri.startsWith(serverOrigin + '/')
    ? { uri, headers: { Authorization: `Bearer ${token}` } }
    : { uri };
}
