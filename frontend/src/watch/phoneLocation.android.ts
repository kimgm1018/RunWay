// 폰 batch ID(UUID v4)에 쓰는 crypto.getRandomValues를 Hermes에 채운다.
import 'react-native-get-random-values';
import { NativeEventEmitter, NativeModules, PermissionsAndroid } from 'react-native';
import { DataError, type DataErrorCode } from '../data/errors';
import type { PhoneFix, PhoneLocation } from '../data/types';

// 폰 인계 뒤 폰 GPS(S15P31E105-464). 네이티브 RunLocation 모듈의 위치를 받는다. 좌표는 로그에 남기지 않는다.

type NativeRunLocation = {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  // An app built before S15P31E105-494 has no current.
  current?: (timeoutMs: number) => Promise<string>;
};

const EVENT = 'RunwayRunLocation';
// 3.1 waits this long for a first fix before saying it was not found.
export const CURRENT_TIMEOUT_MS = 15_000;

const locationCodes: DataErrorCode[] = [
  'LOCATION_PERMISSION_DENIED',
  'LOCATION_DISABLED',
  'LOCATION_TIMEOUT',
  'LOCATION_UNAVAILABLE',
];

// The native promise rejects with one of the codes above; anything else is no location to give.
function locationError(error: unknown): DataError {
  const code = (error as { code?: unknown } | null)?.code;
  return new DataError(
    locationCodes.find(item => item === code) ?? 'LOCATION_UNAVAILABLE',
    '현재 위치를 찾지 못했어요',
  );
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function toFix(json: string): PhoneFix | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!finite(raw.latitude) || !finite(raw.longitude) || !finite(raw.time)) {
      return null;
    }
    return {
      latitude: raw.latitude,
      longitude: raw.longitude,
      accuracyM: finite(raw.accuracyM) ? raw.accuracyM : null,
      altitudeM: finite(raw.altitudeM) ? raw.altitudeM : null,
      time: raw.time,
    };
  } catch {
    return null;
  }
}

export function createPhoneLocation(): PhoneLocation | undefined {
  const native = NativeModules.RunLocation as NativeRunLocation | undefined;
  if (!native) {
    return undefined;
  }
  const emitter = new NativeEventEmitter(NativeModules.RunLocation);
  const requestPermission = async () => {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (await PermissionsAndroid.check(permission).catch(() => false)) {
      return true;
    }
    const result = await PermissionsAndroid.request(permission).catch(() => null);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };
  return {
    start: () => native.start().catch(() => false),
    stop: () => native.stop().catch(() => undefined),
    subscribe: listener => {
      const subscription = emitter.addListener(EVENT, (json: string) => {
        const fix = toFix(json);
        if (fix) {
          listener(fix);
        }
      });
      return () => subscription.remove();
    },
    requestPermission,
    current: async () => {
      if (!(await requestPermission())) {
        throw locationError({ code: 'LOCATION_PERMISSION_DENIED' });
      }
      if (!native.current) {
        throw locationError(null);
      }
      let json: string;
      try {
        json = await native.current(CURRENT_TIMEOUT_MS);
      } catch (error) {
        throw locationError(error);
      }
      const fix = toFix(json);
      if (!fix) {
        throw locationError(null);
      }
      return fix;
    },
  };
}
