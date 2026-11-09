import { NativeModules } from 'react-native';
import type { HealthRecord } from './types';
import type { NativeSleepAccess, SleepNative } from './samsungSleep';

// S15P31E105-572: sleep-only calls on the SamsungHealth native module (SamsungHealthModule.kt).
type NativeSamsungSleep = {
  sleepAccessStatus(): Promise<NativeSleepAccess>;
  requestSleepAccess(): Promise<boolean>;
  readMetric(metric: 'sleep', start: string, end: string): Promise<HealthRecord[]>;
  loadSleepState(): Promise<string | null>;
  saveSleepState(json: string | null): Promise<boolean>;
};

const native = NativeModules.SamsungHealth as NativeSamsungSleep | undefined;

function required(): NativeSamsungSleep {
  if (!native) {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  }
  return native;
}

export const samsungSleepNative: SleepNative = {
  status: async () => (native ? native.sleepAccessStatus() : 'unavailable'),
  request: () => required().requestSleepAccess(),
  read: async window =>
    (await required().readMetric('sleep', window.start, window.end)).filter(
      record => record.metric === 'sleep',
    ),
  loadState: async () => (native ? native.loadSleepState() : null),
  saveState: json => required().saveSleepState(json),
};
