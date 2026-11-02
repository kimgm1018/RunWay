import type { Repositories } from '../types';
import { apiRequest } from './http';

// W01·W02·W03 기기 (docs/design/api/devices-health.md). The server only keeps whether my watch is linked; its name,
// battery and permissions are read on the phone, which the mock stands in for until the watch bridge lands.

type DeviceItem = {
  id: number;
  deviceType: 'PHONE' | 'WATCH';
  linkedAt: string;
  unlinkedAt: string | null;
};

// W02 lists linked devices only, at most one per type.
async function linkedWatch() {
  const { items } = await apiRequest<{ items: DeviceItem[] }>('/devices', {
    query: { deviceType: 'WATCH' },
  });
  return items[0] ?? null;
}

export function createWatchApi(
  mock: Repositories['watch'],
): Repositories['watch'] {
  return {
    // A watch the server has not linked shows as 연결 끊김, whatever the phone sees.
    getConnection: async () => {
      const device = await linkedWatch();
      return device ? mock.getConnection() : mock.disconnect();
    },
    // W01 links only a watch the phone can reach; repeating it returns the same device.
    reconnect: async () => {
      const watch = await mock.reconnect();
      if (watch.status === 'connected') {
        await apiRequest('/devices', {
          method: 'POST',
          body: { deviceType: 'WATCH' },
        });
      }
      return watch;
    },
    // W03 succeeds again for a watch already unlinked.
    disconnect: async () => {
      const device = await linkedWatch();
      if (device) {
        await apiRequest(`/devices/${device.id}`, { method: 'DELETE' });
      }
      return mock.disconnect();
    },
  };
}
