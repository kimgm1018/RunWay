import type { Repositories, WatchConnection } from '../types';
import { apiRequest } from './http';

// W01·W02·W03 기기 (docs/design/api/devices-health.md).
// 서버는 연결 여부만 보관한다. 기기명·배터리·권한·실제 연결은 폰의 Wearable Data Layer로 확인한다(S15P31E105-571).
// 실제 발견/연결 증거 없이 mock 기기명·배터리·성공 상태를 보여 주거나 서버에 등록하지 않는다.

type DeviceItem = {
  id: number;
  deviceType: 'PHONE' | 'WATCH';
  linkedAt: string;
  unlinkedAt: string | null;
};

export type ConnectedWatchNode = {
  id: string;
  displayName: string;
  nearby?: boolean;
};

export type WatchBridge = {
  findConnectedWatch: () => Promise<ConnectedWatchNode | null>;
};

// Phone GPS can stay connected; watch-side sensors stay unknown until a real probe exists.
const basePermissions = (): WatchConnection['permissions'] => ({
  heartRate: 'disconnected',
  location: 'connected',
  sleep: 'disconnected',
  activity: 'disconnected',
});

const offlineWatch = (linkedAt: string | null): WatchConnection => ({
  status: 'disconnected',
  deviceName: '워치',
  lastSyncedAt: linkedAt,
  batteryPercent: null,
  permissions: basePermissions(),
});

const connectedWatch = (node: ConnectedWatchNode, linkedAt: string | null): WatchConnection => ({
  status: 'connected',
  deviceName: node.displayName.trim() || '워치',
  lastSyncedAt: linkedAt,
  batteryPercent: null,
  permissions: basePermissions(),
});

// 설정·연결 화면 상태 문구(S15P31E105-571 완료 조건).
export function watchConnectionLabel(watch: WatchConnection): string {
  if (watch.status === 'connected') {
    const ready =
      watch.permissions.heartRate === 'connected' &&
      watch.permissions.activity === 'connected';
    return ready ? '연결됨' : '준비 미완료';
  }
  return watch.lastSyncedAt ? '등록/연결 끊김' : '워치 없음';
}

async function linkedWatch() {
  const { items } = await apiRequest<{ items: DeviceItem[] }>('/devices', {
    query: { deviceType: 'WATCH' },
  });
  return items[0] ?? null;
}

export function createWatchApi(
  _mock: Repositories['watch'],
  bridge: WatchBridge,
): Repositories['watch'] {
  const read = async (): Promise<WatchConnection> => {
    const [node, device] = await Promise.all([
      bridge.findConnectedWatch().catch(() => null),
      linkedWatch().catch(() => null),
    ]);
    const linkedAt = device?.linkedAt ?? null;
    if (node) {
      return connectedWatch(node, linkedAt);
    }
    return offlineWatch(linkedAt);
  };

  return {
    getConnection: read,
    // W01 only when a Data Layer node is reachable; repeating it returns the same server device.
    reconnect: async () => {
      const node = await bridge.findConnectedWatch().catch(() => null);
      if (!node) {
        const device = await linkedWatch().catch(() => null);
        return offlineWatch(device?.linkedAt ?? null);
      }
      await apiRequest('/devices', {
        method: 'POST',
        body: { deviceType: 'WATCH' },
      });
      const device = await linkedWatch().catch(() => null);
      return connectedWatch(node, device?.linkedAt ?? null);
    },
    // W03 succeeds again for a watch already unlinked.
    disconnect: async () => {
      const device = await linkedWatch();
      if (device) {
        await apiRequest(`/devices/${device.id}`, { method: 'DELETE' });
      }
      return offlineWatch(null);
    },
  };
}
