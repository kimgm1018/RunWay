import { errorCode } from '../../data';
import type { RecommendNotice } from './recommendFailure';

// What 3.1 says when 현재 위치 could not be used (S15P31E105-494). No fixed point stands in for it, so the
// origin stays empty until the user tries again or picks a place.
export const CURRENT_PLACE_NAME = '현재 위치';

const byCode: Partial<Record<ReturnType<typeof errorCode>, RecommendNotice>> = {
  LOCATION_PERMISSION_DENIED: {
    title: '위치 권한이 없어 현재 위치를 쓸 수 없어요.',
    detail: '설정에서 위치 권한을 허용하거나 기준 위치를 직접 골라 주세요.',
  },
  LOCATION_DISABLED: {
    title: '휴대폰 위치가 꺼져 있어요.',
    detail: '위치를 켠 뒤 현재 위치를 다시 찾거나 기준 위치를 직접 골라 주세요.',
  },
  LOCATION_TIMEOUT: {
    title: '현재 위치를 찾지 못했어요.',
    detail: '하늘이 보이는 곳에서 다시 찾거나 기준 위치를 직접 골라 주세요.',
  },
};

const fallback: RecommendNotice = {
  title: '현재 위치를 찾지 못했어요.',
  detail: '다시 찾거나 기준 위치를 직접 골라 주세요.',
};

// No phone location on this device (iOS, or the mock data).
export const noLocationNotice: RecommendNotice = {
  title: '이 기기에서는 현재 위치를 쓸 수 없어요.',
  detail: '기준 위치를 직접 골라 주세요.',
};

export function locationFailureNotice(error: unknown): RecommendNotice {
  return byCode[errorCode(error)] ?? fallback;
}
