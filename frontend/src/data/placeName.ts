import { NativeModules, Platform } from 'react-native';

// The name of a point picked on the map (3.1 기준 위치 · 도착 위치 지도에서 선택, 담당자 요청), from the phone's own
// geocoder through the native PlaceName module (Android). There is no server API for it, so elsewhere, or when the
// phone finds nothing, the answer is null and the screen keeps its plain label. Coordinates are never logged.

type NativePlaceName = {
  nameOf: (latitude: number, longitude: number) => Promise<string | null>;
  addressOf?: (latitude: number, longitude: number) => Promise<string | null>;
};

export async function placeNameOf([longitude, latitude]: [
  number,
  number,
]): Promise<string | null> {
  const native = NativeModules.PlaceName as NativePlaceName | undefined;
  if (Platform.OS !== 'android' || !native) {
    return null;
  }
  try {
    const name = await native.nameOf(latitude, longitude);
    return name?.trim() || null;
  } catch {
    return null;
  }
}

// The full address of a point with its 시·도 (‘부산광역시 해운대구 우동 …’), for the region a shared run started in
// (S15P31E105-687). null off Android, on an app built before addressOf, or when the phone finds nothing.
export async function placeAddressOf([longitude, latitude]: [
  number,
  number,
]): Promise<string | null> {
  const native = NativeModules.PlaceName as NativePlaceName | undefined;
  if (Platform.OS !== 'android' || !native?.addressOf) {
    return null;
  }
  try {
    const address = await native.addressOf(latitude, longitude);
    return address?.trim() || null;
  } catch {
    return null;
  }
}
