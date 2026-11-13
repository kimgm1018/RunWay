import type { LinkedDevices } from '../types';
import type { ApiRequest } from './request';

// 러닝 세션(S01)에 쓸 등록 기기 (docs/design/api/devices-health.md W01·W02, S15P31E105-256).
// 워치 연결·해제는 기기 설정 화면(S15P31E105-308)이 맡는다. 이 휴대폰은 러닝을 중계하는 PHONE이므로,
// 아직 연결 기록이 없으면 시작할 때 W01로 연결한다(같은 요청을 반복해도 같은 기기를 돌려준다).

type DeviceItem = {
  id: number;
  deviceType: 'PHONE' | 'WATCH';
  linkedAt: string;
  unlinkedAt: string | null;
};

export function createLinkedDevices(request: ApiRequest) {
  return async (): Promise<LinkedDevices | null> => {
    // W02는 연결 중인 기기만, 유형별로 하나씩 돌려준다.
    const { items } = await request<{ items: DeviceItem[] }>('GET', '/devices');
    const watch = items.find(item => item.deviceType === 'WATCH');
    if (!watch) {
      return null;
    }
    const phone =
      items.find(item => item.deviceType === 'PHONE') ??
      (await request<DeviceItem>('POST', '/devices', { deviceType: 'PHONE' }));
    return { watchDeviceId: String(watch.id), phoneDeviceId: String(phone.id) };
  };
}

// A personal run can use the registered phone even when no watch is linked.
export function createPhoneDeviceId(request: ApiRequest) {
  return async (): Promise<string> => {
    const { items } = await request<{ items: DeviceItem[] }>('GET', '/devices');
    const phone = items.find(item => item.deviceType === 'PHONE') ??
      (await request<DeviceItem>('POST', '/devices', { deviceType: 'PHONE' }));
    return String(phone.id);
  };
}
