// 폰 batch ID(UUID v4)에 쓰는 crypto.getRandomValues를 Hermes에 채운다.
import 'react-native-get-random-values';
import { NativeEventEmitter, NativeModules, PermissionsAndroid } from 'react-native';
import type { PhoneFix, PhoneLocation } from '../data/types';

// 폰 인계 뒤 폰 GPS(S15P31E105-464). 네이티브 RunLocation 모듈의 위치를 받는다. 좌표는 로그에 남기지 않는다.

type NativeRunLocation = {
  start(): Promise<boolean>;
  stop(): Promise<void>;
};

const EVENT = 'RunwayRunLocation';

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
    requestPermission: async () => {
      const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
      if (await PermissionsAndroid.check(permission).catch(() => false)) {
        return true;
      }
      const result = await PermissionsAndroid.request(permission).catch(() => null);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    },
  };
}
