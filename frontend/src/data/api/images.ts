import { apiRequest } from './http';

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
