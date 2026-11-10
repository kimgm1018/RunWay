import { NativeModules, PermissionsAndroid } from 'react-native';
import { samsungSleepNative } from '../health/samsungSleepNative';
import type { WatchLinkState } from '../data/types';
import type { PhoneHealthPermissions, WatchReadiness } from './watchReadiness';

export type { PhoneHealthPermissions, WatchReadiness } from './watchReadiness';

// No permissions are requested here. Each refresh reads actual OS/SDK state only.
export async function readPhoneHealthPermissions(): Promise<PhoneHealthPermissions> {
  const [sleep, location] = await Promise.all([
    samsungSleepNative.status().then(
      (state): WatchLinkState =>
        state === 'granted'
          ? 'connected'
          : state === 'required'
          ? 'denied'
          : 'unknown',
      (): WatchLinkState => 'unknown',
    ),
    PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ).then(
      (granted): WatchLinkState => (granted ? 'connected' : 'denied'),
      (): WatchLinkState => 'unknown',
    ),
  ]);
  return { sleep, location };
}

export async function readWatchReadiness(
  nodeId: string,
): Promise<WatchReadiness> {
  const module = NativeModules.WatchSession as
    | {
        getWatchReadiness?: (id: string) => Promise<WatchReadiness>;
      }
    | undefined;
  try {
    return (
      (await module?.getWatchReadiness?.(nodeId)) ?? { appStatus: 'noResponse' }
    );
  } catch {
    return { appStatus: 'noResponse' };
  }
}
