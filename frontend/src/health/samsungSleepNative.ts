import type { SleepNative } from './samsungSleep';

// Samsung Health exists only on Android (samsungSleepNative.android.ts). Elsewhere sleep access is unavailable.
export const samsungSleepNative: SleepNative = {
  status: async () => 'unavailable',
  request: async () => false,
  read: async () => {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  },
  loadState: async () => null,
  saveState: async () => false,
};
