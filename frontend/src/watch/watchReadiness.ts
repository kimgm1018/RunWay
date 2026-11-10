import type { WatchLinkState } from '../data/types';

export type WatchReadiness = {
  appStatus: 'responded' | 'missingOrOutdated' | 'noResponse' | 'disconnected';
  heartRate?: boolean;
  activity?: boolean;
};

export type PhoneHealthPermissions = {
  sleep: WatchLinkState;
  location: WatchLinkState;
};

export async function readWatchReadiness(
  _nodeId: string,
): Promise<WatchReadiness> {
  return { appStatus: 'noResponse' };
}

export async function readPhoneHealthPermissions(): Promise<PhoneHealthPermissions> {
  return { sleep: 'unknown', location: 'unknown' };
}
