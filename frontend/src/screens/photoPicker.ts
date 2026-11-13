import { launchImageLibrary } from 'react-native-image-picker';
import { errorCode, type PhotoFile } from '../data';

// Picking a photo for F01 (8.2 프로필 사진, 6.3 크루 대표 사진): one photo from the library, sized down on the
// phone. F01 takes jpeg or png up to 5MB.

const photoLimitBytes = 5 * 1024 * 1024;

export type PickedPhoto =
  | { kind: 'picked'; photo: PhotoFile }
  | { kind: 'cancelled' }
  // A photo F01 would turn down, or a picker that failed, with what to say.
  | { kind: 'refused'; message: string }
  // The picker is still open (or still shrinking the last photo): a second tap does nothing.
  | { kind: 'busy' };

// S15P31E105-796: a second launchImageLibrary while the first is open or still shrinking a big original made the
// first pick look dead. One pick at a time; a picker that fails or throws says so instead of reading as 취소.
let picking = false;

const pickerFailure = (code: string | undefined) =>
  code === 'permission'
    ? '사진 접근 권한이 필요해요. 설정에서 허용해 주세요'
    : '사진을 불러오지 못했어요. 다시 골라 주세요';

export async function pickPhoto(baseName: string): Promise<PickedPhoto> {
  if (picking) {
    return { kind: 'busy' };
  }
  picking = true;
  try {
    return await pickOne(baseName);
  } catch {
    return { kind: 'refused', message: pickerFailure(undefined) };
  } finally {
    picking = false;
  }
}

async function pickOne(baseName: string): Promise<PickedPhoto> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    maxWidth: 1080,
    maxHeight: 1080,
    quality: 0.8,
  });
  if (result.errorCode) {
    return { kind: 'refused', message: pickerFailure(result.errorCode) };
  }
  const asset = result.assets?.[0];
  if (result.didCancel || !asset?.uri) {
    return { kind: 'cancelled' };
  }
  const type =
    asset.type === 'image/jpeg' || asset.type === 'image/png'
      ? asset.type
      : null;
  if (!type) {
    return { kind: 'refused', message: 'JPG나 PNG 사진만 쓸 수 있어요' };
  }
  if ((asset.fileSize ?? 0) > photoLimitBytes) {
    return { kind: 'refused', message: '5MB 이하의 사진을 골라 주세요' };
  }
  return {
    kind: 'picked',
    photo: {
      uri: asset.uri,
      type,
      name:
        asset.fileName ?? `${baseName}.${type === 'image/png' ? 'png' : 'jpg'}`,
    },
  };
}

// What F01 failing says; null when the failure is not about the photo.
export function photoFailure(error: unknown): string | null {
  switch (errorCode(error)) {
    case 'FILE_TOO_LARGE':
      return '사진이 너무 커요. 5MB 이하의 사진을 골라 주세요';
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'INVALID_FILE':
    case 'INVALID_IMAGE':
      return '이 사진은 쓸 수 없어요. 다른 JPG나 PNG 사진을 골라 주세요';
    default:
      return null;
  }
}
