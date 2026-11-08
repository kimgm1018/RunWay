import { sha256 } from 'js-sha256';
import type { PhoneFix } from '../data/types';

// 폰 인계 뒤 폰이 직접 만드는 W07 batch(S15P31E105-464, devices-health.md W07·폰 인계 후 업로드·종료).
// 생산 기기는 폰(relay PHONE)이고 GPS_POINT만 넣는다. 심박을 만들어 METRIC_SAMPLE에 넣지 않는다.
// 본문은 RFC 8785 JCS 표기로 한 번만 쓴다. 해시 입력은 payloadHash를 뺀 본문이며 deviceId·sessionId만 십진 문자열로 바꾼다.
// 좌표·본문은 로그에 남기지 않는다.

export const SCHEMA_VERSION = '1';
// MessageClient를 거치지 않지만 W07 본문 상한(32 KiB)을 넉넉히 지키도록 한 batch의 항목 수를 제한한다(GPS 한 점 약 150바이트).
export const MAX_ITEMS = 100;

// JSON 숫자 토큰을 그대로 쓴다(int64 ID를 JS Number로 바꾸지 않는다).
class RawNumber {
  constructor(readonly text: string) {}
}

type Json = null | boolean | number | string | RawNumber | Json[] | { [key: string]: Json };

// batch에 들어가는 값만 다루는 최소 JCS. 숫자는 ECMAScript 최단 표기(JSON.stringify)이고 키는 UTF-16 코드 단위 순이다.
export function jcs(value: Json): string {
  if (value === null || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof RawNumber) {
    return value.text;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(jcs).join(',')}]`;
  }
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map(key => `${JSON.stringify(key)}:${jcs(value[key])}`).join(',')}}`;
}

const ID = /^[1-9]\d*$/;

// W07 payloadHash: id·schemaVersion·items와 문자열화한 deviceId·sessionId의 JCS UTF-8 SHA-256(소문자 hex).
export function payloadHash(id: string, deviceId: string, sessionId: string, items: Json[]): string {
  return sha256(
    jcs({ id, deviceId, sessionId, schemaVersion: SCHEMA_VERSION, items }),
  );
}

// DB 자릿수(정확도·고도 10,2)를 넘지 않게 소수 둘째 자리로 맞춘다. 없는 값은 null로 둔다.
const scale2 = (value: number | null) =>
  value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;

export function gpsItem(fix: PhoneFix): Json | null {
  const { latitude, longitude } = fix;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(fix.time)
  ) {
    return null;
  }
  const accuracy = scale2(fix.accuracyM);
  return {
    type: 'GPS_POINT',
    // 원래 측정 시각(UTC, 밀리초). 수신 시각으로 바꾸지 않는다.
    measuredAt: new Date(fix.time).toISOString(),
    coordinates: [longitude, latitude],
    accuracyM: accuracy === null ? null : Math.max(accuracy, 0),
    altitudeM: scale2(fix.altitudeM),
  };
}

// 완성한 W07 본문. 이후 같은 batch는 이 문자열 그대로만 다시 보낸다.
export function phoneBatchBody(
  id: string,
  deviceId: string,
  sessionId: string,
  items: Json[],
): string {
  if (!ID.test(deviceId) || !ID.test(sessionId) || items.length === 0) {
    throw new Error('invalid batch');
  }
  return jcs({
    id,
    deviceId: new RawNumber(deviceId),
    sessionId: new RawNumber(sessionId),
    schemaVersion: SCHEMA_VERSION,
    items,
    payloadHash: payloadHash(id, deviceId, sessionId, items),
  });
}

export type { Json as BatchJson };
