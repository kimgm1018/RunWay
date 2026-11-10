import { placeNameOf } from '../placeName';
import type { CurrentPlace, GpsQuality, PhoneLocation } from '../types';

// 2.0F · 2.0C · 2.0 현재 위치 from the phone's own GPS (S15P31E105-635), instead of the mock's fixed place. The
// name comes from the phone's geocoder when it has one, else a plain label; there is no server API for it.
// Coordinates are never logged.

export const CURRENT_PLACE_LABEL = '현재 위치';
export const UNKNOWN_PLACE_LABEL = '위치를 확인할 수 없어요';

// A fix this close is a good signal; anything wider, or without an accuracy, is weak.
const goodAccuracyM = 30;

const unknown: CurrentPlace = {
  name: UNKNOWN_PLACE_LABEL,
  gps: 'none',
  position: null,
};

const qualityOf = (accuracyM: number | null): GpsQuality =>
  accuracyM !== null && accuracyM <= goodAccuracyM ? 'good' : 'weak';

export function createCurrentPlace(
  phoneLocation: PhoneLocation | undefined,
  nameOf: (position: [number, number]) => Promise<string | null> = placeNameOf,
): () => Promise<CurrentPlace> {
  return async () => {
    // No phone location on this device (iOS), no permission, location off or no fix: say so, never a fake place.
    if (!phoneLocation) {
      return unknown;
    }
    let position: [number, number];
    let gps: GpsQuality;
    try {
      const fix = await phoneLocation.current();
      position = [fix.longitude, fix.latitude];
      gps = qualityOf(fix.accuracyM);
    } catch {
      return unknown;
    }
    const name = await nameOf(position).catch(() => null);
    return { name: name ?? CURRENT_PLACE_LABEL, gps, position };
  };
}
