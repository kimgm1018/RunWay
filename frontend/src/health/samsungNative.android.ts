import { NativeModules } from 'react-native';
import type { SamsungSdk } from './samsungReader';
import type { HealthMetric, HealthRecord, ReadWindow } from './types';
type NativeSamsung = {
  availability: SamsungSdk['availability'];
  requestReadAccess(): Promise<void>;
  readMetric(
    metric: HealthMetric,
    start: string,
    end: string,
  ): Promise<HealthRecord[]>;
  openSettings(): Promise<void>;
};
const native = NativeModules.SamsungHealth as NativeSamsung | undefined;
function required(): NativeSamsung {
  if (!native) {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  }
  return native;
}
export const samsungNative = {
  availability: async () =>
    native ? native.availability() : ('unavailable' as const),
  request: () => required().requestReadAccess(),
  read: (metric: HealthMetric, window: ReadWindow) =>
    required().readMetric(metric, window.start, window.end),
  openSettings: () => required().openSettings(),
};
