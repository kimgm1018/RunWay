import type {
  Repositories,
  WatchConnection,
  WatchReadinessReason,
} from '../types';
import type {
  PhoneHealthPermissions,
  WatchReadiness,
} from '../../watch/watchReadiness';
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
  readReadiness?: (nodeId: string) => Promise<WatchReadiness>;
  readPhonePermissions?: () => Promise<PhoneHealthPermissions>;
};

// Phone GPS can stay connected; watch-side sensors stay unknown until a real probe exists.
const basePermissions = (): WatchConnection['permissions'] => ({
  heartRate: 'unknown',
  location: 'unknown',
  sleep: 'unknown',
  activity: 'unknown',
});

const offlineWatch = (linkedAt: string | null): WatchConnection => ({
  status: 'disconnected',
  deviceName: '워치',
  lastSyncedAt: linkedAt,
  batteryPercent: null,
  permissions: basePermissions(),
});

const reasonLabels: Record<WatchReadinessReason, string> = {
  APP_MISSING_OR_OUTDATED: '워치 RunWay 앱 설치·업데이트 필요',
  NO_RESPONSE: '워치 앱 응답 없음',
  HEART_RATE_PERMISSION: '워치 심박 권한 필요',
  ACTIVITY_PERMISSION: '워치 활동 권한 필요',
  UNKNOWN: '준비 상태 미확인',
};

export function watchReadinessDetail(watch: WatchConnection): string | null {
  if (watch.status !== 'connected') return null;
  const reasons = watch.readinessReasons ?? [];
  return reasons.length
    ? reasons.map(reason => reasonLabels[reason]).join(' · ')
    : null;
}

// 설정·연결 화면 상태 문구(S15P31E105-571 완료 조건).
export function isWatchReady(watch: WatchConnection): boolean {
  return (
    watch.status === 'connected' &&
    watch.registrationStatus !== 'unregistered' &&
    watch.registrationStatus !== 'unknown' &&
    !watch.readinessReasons?.length &&
    watch.permissions.heartRate === 'connected' &&
    watch.permissions.activity === 'connected'
  );
}

// No watch now and none ever linked to this account: nothing was cut off, so screens show a neutral state instead of
// 1.8's 끊김 look (TEAM QA T06, S15P31E105-784).
export function neverHadWatch(watch: WatchConnection): boolean {
  return (
    watch.status !== 'connected' &&
    !watch.lastSyncedAt &&
    watch.registrationStatus !== 'unregistered'
  );
}

export function watchConnectionLabel(watch: WatchConnection): string {
  if (watch.registrationStatus === 'unregistered') return '등록 안 됨';
  if (watch.registrationStatus === 'unknown') return '등록 상태 미확인';
  if (watch.status === 'connected') {
    return isWatchReady(watch) ? '연결됨' : '준비 미완료';
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
  const inspect = async (
    node: ConnectedWatchNode | null,
    linkedAt: string | null,
    registrationStatus: NonNullable<WatchConnection['registrationStatus']> = 'registered',
  ): Promise<WatchConnection> => {
    const permissions = basePermissions();
    try {
      Object.assign(permissions, await bridge.readPhonePermissions?.());
    } catch {
      // An unavailable phone SDK/OS permission stays unknown, independently of the watch link.
    }
    if (!node) return {
      ...offlineWatch(linkedAt),
      permissions,
      ...(registrationStatus === 'unknown' ? { registrationStatus } : {}),
    };
    if (registrationStatus !== 'registered') {
      return {
        ...offlineWatch(linkedAt),
        deviceName: node.displayName.trim() || '워치',
        registrationStatus,
        permissions,
      };
    }
    let readiness: WatchReadiness | undefined;
    try {
      readiness = await bridge.readReadiness?.(node.id);
    } catch {
      // Transport acceptance and cached snapshots cannot stand in for a fresh watch response.
    }
    if (readiness?.appStatus === 'disconnected') {
      return { ...offlineWatch(linkedAt), permissions };
    }
    const reasons: WatchReadinessReason[] = [];
    if (readiness?.appStatus === 'responded') {
      for (const key of ['heartRate', 'activity'] as const) {
        permissions[key] =
          readiness[key] === true
            ? 'connected'
            : readiness[key] === false
            ? 'denied'
            : 'unknown';
      }
      if (permissions.heartRate === 'denied')
        reasons.push('HEART_RATE_PERMISSION');
      if (permissions.activity === 'denied')
        reasons.push('ACTIVITY_PERMISSION');
      if (
        permissions.heartRate === 'unknown' ||
        permissions.activity === 'unknown'
      )
        reasons.push('UNKNOWN');
    } else {
      reasons.push(
        readiness?.appStatus === 'missingOrOutdated'
          ? 'APP_MISSING_OR_OUTDATED'
          : 'NO_RESPONSE',
      );
    }
    return {
      status: 'connected',
      deviceName: node.displayName.trim() || '워치',
      lastSyncedAt: linkedAt,
      batteryPercent: null,
      permissions,
      readinessReasons: reasons,
      registrationStatus,
    };
  };
  const read = async (): Promise<WatchConnection> => {
    const [node, registration] = await Promise.all([
      bridge.findConnectedWatch().catch(() => null),
      linkedWatch().then(
        device => ({ device, status: device ? 'registered' as const : 'unregistered' as const }),
        () => ({ device: null, status: 'unknown' as const }),
      ),
    ]);
    const linkedAt = registration.device?.linkedAt ?? null;
    return inspect(node, linkedAt, registration.status);
  };

  return {
    getConnection: read,
    // W01 only when a Data Layer node is reachable; repeating it returns the same server device.
    reconnect: async () => {
      const node = await bridge.findConnectedWatch().catch(() => null);
      if (!node) {
        const device = await linkedWatch().catch(() => null);
        return inspect(null, device?.linkedAt ?? null);
      }
      await apiRequest('/devices', {
        method: 'POST',
        body: { deviceType: 'WATCH' },
      });
      const device = await linkedWatch().catch(() => null);
      return inspect(node, device?.linkedAt ?? null);
    },
    // W03 succeeds again for a watch already unlinked.
    disconnect: async () => {
      const device = await linkedWatch();
      if (device) {
        await apiRequest(`/devices/${device.id}`, { method: 'DELETE' });
      }
      return inspect(null, null);
    },
  };
}
