import { NativeModules } from 'react-native';
import type { HealthRecord } from './types';
import type { NativeSleepAccess, SleepNative } from './samsungSleep';
import type { SamsungAccessRequest } from './samsungRestingHr';

// S15P31E105-600: heart-rate calls on the SamsungHealth native module (SamsungHealthModule.kt). It has the same shape as
// the sleep boundary so access, state and upload marks follow the same rules.
type NativeSamsungHeart = {
  heartRateAccessStatus(): Promise<NativeSleepAccess>;
  requestHealthAccess(
    metrics: ('sleep' | 'heartRate')[],
  ): Promise<{ sleep?: boolean; heartRate?: boolean }>;
  readMetric(
    metric: 'heartRate',
    start: string,
    end: string,
  ): Promise<HealthRecord[]>;
  loadRestingHrState(): Promise<string | null>;
  saveRestingHrState(json: string | null): Promise<boolean>;
};

const native = NativeModules.SamsungHealth as NativeSamsungHeart | undefined;

function required(): NativeSamsungHeart {
  if (!native) {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  }
  return native;
}

export const samsungHeartNative: SleepNative = {
  status: async () => (native ? native.heartRateAccessStatus() : 'unavailable'),
  request: async () =>
    (await required().requestHealthAccess(['heartRate'])).heartRate === true,
  read: async window =>
    (
      await required().readMetric('heartRate', window.start, window.end)
    ).filter(record => record.metric === 'heartRate'),
  loadState: async () => (native ? native.loadRestingHrState() : null),
  saveState: json => required().saveRestingHrState(json),
};

// One system dialog for sleep and heart rate (2026-11-09 사용자 결정 D-8).
export const requestSamsungHealthAccess: SamsungAccessRequest = async () => {
  const granted = await required().requestHealthAccess(['sleep', 'heartRate']);
  return {
    sleep: granted.sleep === true,
    heartRate: granted.heartRate === true,
  };
};
