import type { PhoneLocation } from '../data/types';

// 워치 중계가 없는 플랫폼(iOS 등)에는 폰 인계가 없으므로 폰 GPS 기록도 없다(S15P31E105-464).
export function createPhoneLocation(): PhoneLocation | undefined {
  return undefined;
}
