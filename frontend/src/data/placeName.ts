import { NativeModules, Platform } from 'react-native';

// The name of a point picked on the map (3.1 기준 위치 · 도착 위치 지도에서 선택, 담당자 요청), from the phone's own
// geocoder through the native PlaceName module (Android). There is no server API for it, so elsewhere, or when the
// phone finds nothing, the answer is null and the screen keeps its plain label. Coordinates are never logged.

type NativePlaceName = {
  nameOf: (latitude: number, longitude: number) => Promise<string | null>;
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
