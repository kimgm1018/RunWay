import type { SleepNative } from './samsungSleep';
import type { SamsungAccessRequest } from './samsungRestingHr';

// Samsung Health exists only on Android (samsungRestingHrNative.android.ts). Elsewhere heart rate access is unavailable.
export const samsungHeartNative: SleepNative = {
  status: async () => 'unavailable',
  request: async () => false,
  read: async () => {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  },
  loadState: async () => null,
  saveState: async () => false,
};

export const requestSamsungHealthAccess: SamsungAccessRequest = async () => {
  throw { code: 'SAMSUNG_UNAVAILABLE' };
};
