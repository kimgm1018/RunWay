import {
  createWatchApi,
  neverHadWatch,
  watchConnectionLabel,
  watchReadinessDetail,
} from '../devices';
import type { ConnectedWatchNode, WatchBridge } from '../devices';
import { createMockRepositories } from '../../mock/createMockRepositories';
import { tokenStore } from '../tokenStore';

const fetchMock = jest.fn();

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const linked = {
  id: 31,
  deviceType: 'WATCH',
  linkedAt: '2026-11-02T00:00:00Z',
  unlinkedAt: null,
};

const node: ConnectedWatchNode = {
  id: 'node-1',
  displayName: 'Galaxy Watch7',
};

// W02 answers with `devices`; W01 and W03 answer like the server.
function serve(devices: unknown[]) {
  let current = devices;
  fetchMock.mockImplementation(
    async (address: string, init: { method: string }) => {
      const path = new URL(address).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/devices' && init.method === 'GET') {
        return respond(200, { items: current });
      }
      if (path === '/devices' && init.method === 'POST') {
        current = [linked];
        return respond(201, { id: 31, deviceType: 'WATCH' });
      }
      if (path === '/devices/31' && init.method === 'DELETE') {
        current = [];
        return respond(200, {});
      }
      throw new Error(`unexpected request ${init.method} ${address}`);
    },
  );
}

const calls = () =>
  fetchMock.mock.calls.map(([address, init]) => {
    const url = new URL(address);
    return {
      request: `${init.method} ${url.pathname.replace(/^.*\/api\/v1/, '')}${
        url.search
      }`,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
  });

function watchApi(
  findConnectedWatch: () => Promise<ConnectedWatchNode | null>,
  probe: Partial<WatchBridge> = {},
) {
  return createWatchApi(createMockRepositories({ latencyMs: 0 }).watch, {
    findConnectedWatch,
    ...probe,
  });
}

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('a reachable node shows as connected with the OS display name', async () => {
  serve([linked]);

  const watch = await watchApi(async () => node).getConnection();

  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
  ]);
  expect(watch).toMatchObject({
    status: 'connected',
    deviceName: 'Galaxy Watch7',
    batteryPercent: null,
    lastSyncedAt: linked.linkedAt,
  });
  expect(watchConnectionLabel(watch)).toBe('준비 미완료');
});

test('a linked watch with no Data Layer node is 등록/연결 끊김, not mock-connected', async () => {
  serve([linked]);

  const watch = await watchApi(async () => null).getConnection();

  expect(watch).toMatchObject({
    status: 'disconnected',
    deviceName: '워치',
    batteryPercent: null,
    lastSyncedAt: linked.linkedAt,
  });
  expect(watchConnectionLabel(watch)).toBe('등록/연결 끊김');
  // Once linked, a missing watch is really cut off (1.8 look).
  expect(neverHadWatch(watch)).toBe(false);
});

test('no registration and no node is 워치 없음', async () => {
  serve([]);
  const watch = await watchApi(async () => null).getConnection();
  expect(watch.status).toBe('disconnected');
  expect(watch.lastSyncedAt).toBeNull();
  expect(watchConnectionLabel(watch)).toBe('워치 없음');
  // TEAM QA T06 (S15P31E105-784): no watch ever is not shown as 끊김.
  expect(neverHadWatch(watch)).toBe(true);
});

test('W01 links only when a watch node is reachable', async () => {
  serve([]);

  const watch = await watchApi(async () => node).reconnect();

  expect(watch.status).toBe('connected');
  expect(watch.deviceName).toBe('Galaxy Watch7');
  expect(calls()).toEqual([
    { request: 'POST /devices', body: { deviceType: 'WATCH' } },
    { request: 'GET /devices?deviceType=WATCH', body: undefined },
  ]);
});

test('a watch the phone cannot reach is not linked', async () => {
  serve([]);

  const watch = await watchApi(async () => null).reconnect();

  expect(watch.status).toBe('disconnected');
  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
  ]);
  expect(calls().some(call => call.request.startsWith('POST'))).toBe(false);
});

test('W03 unlinks the linked watch', async () => {
  serve([linked]);

  const watch = await watchApi(async () => null).disconnect();

  expect(watch.status).toBe('disconnected');
  expect(watch.lastSyncedAt).toBeNull();
  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
    'DELETE /devices/31',
  ]);
});

test('unlinking with nothing linked asks nothing more of the server', async () => {
  serve([]);

  await watchApi(async () => null).disconnect();

  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
  ]);
});

test('W01 failures reach the screen', async () => {
  fetchMock.mockResolvedValue(
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
  );
  await expect(watchApi(async () => node).reconnect()).rejects.toMatchObject({
    code: 'SERVER_ERROR',
  });
});

test('fresh app response and both sensor grants make the watch ready, independently of phone sleep/GPS', async () => {
  serve([linked]);
  const readReadiness = jest.fn(async () => ({
    appStatus: 'responded' as const,
    heartRate: true,
    activity: true,
  }));
  const watch = await watchApi(async () => node, {
    readReadiness,
    readPhonePermissions: async () => ({
      sleep: 'denied',
      location: 'unknown',
    }),
  }).getConnection();
  expect(readReadiness).toHaveBeenCalledWith(node.id);
  expect(watchConnectionLabel(watch)).toBe('연결됨');
  expect(watchReadinessDetail(watch)).toBeNull();
  expect(watch.permissions).toEqual({
    heartRate: 'connected',
    activity: 'connected',
    sleep: 'denied',
    location: 'unknown',
  });
});

test('missing permissions identify the watch-side action instead of pretending the transport disconnected', async () => {
  serve([linked]);
  const watch = await watchApi(async () => node, {
    readReadiness: async () => ({
      appStatus: 'responded',
      heartRate: false,
      activity: false,
    }),
  }).getConnection();
  expect(watch.status).toBe('connected');
  expect(watchConnectionLabel(watch)).toBe('준비 미완료');
  expect(watchReadinessDetail(watch)).toBe(
    '워치 심박 권한 필요 · 워치 활동 권한 필요',
  );
  expect(watch.permissions.heartRate).toBe('denied');
});

test.each([
  ['missingOrOutdated', '워치 RunWay 앱 설치·업데이트 필요'],
  ['noResponse', '워치 앱 응답 없음'],
] as const)(
  '%s does not turn an unknown sensor into a grant or denial',
  async (appStatus, detail) => {
    serve([linked]);
    const watch = await watchApi(async () => node, {
      readReadiness: async () => ({ appStatus }),
    }).getConnection();
    expect(watchConnectionLabel(watch)).toBe('준비 미완료');
    expect(watchReadinessDetail(watch)).toBe(detail);
    expect(watch.permissions.heartRate).toBe('unknown');
    expect(watch.permissions.activity).toBe('unknown');
  },
);

test('partial/invalid response and bridge failures never grant permissions', async () => {
  serve([linked]);
  const api = watchApi(async () => node, {
    readReadiness: async () => ({ appStatus: 'responded', heartRate: true }),
    readPhonePermissions: async () => {
      throw new Error('unavailable');
    },
  });
  const watch = await api.getConnection();
  expect(watch.permissions.activity).toBe('unknown');
  expect(watch.permissions.sleep).toBe('unknown');
  expect(watch.permissions.location).toBe('unknown');
  expect(watchConnectionLabel(watch)).toBe('준비 미완료');
  expect(watchReadinessDetail(watch)).toBe('준비 상태 미확인');
});

test('refresh reads revocation and disconnection instead of keeping an earlier ready answer', async () => {
  serve([linked]);
  const find = jest.fn().mockResolvedValue(node);
  const probe = jest
    .fn()
    .mockResolvedValue({
      appStatus: 'responded',
      heartRate: true,
      activity: true,
    });
  const api = watchApi(find, { readReadiness: probe });
  expect(watchConnectionLabel(await api.getConnection())).toBe('연결됨');
  probe.mockResolvedValue({
    appStatus: 'responded',
    heartRate: false,
    activity: true,
  });
  expect(watchReadinessDetail(await api.getConnection())).toBe(
    '워치 심박 권한 필요',
  );
  find.mockResolvedValue(null);
  expect(watchConnectionLabel(await api.getConnection())).toBe(
    '등록/연결 끊김',
  );
  expect(probe).toHaveBeenCalledTimes(2);
});

test('phone sleep/location can be granted without a connected watch; watch sensors remain unknown', async () => {
  serve([]);
  const watch = await watchApi(async () => null, {
    readPhonePermissions: async () => ({
      sleep: 'connected',
      location: 'connected',
    }),
  }).getConnection();
  expect(watchConnectionLabel(watch)).toBe('워치 없음');
  expect(watch.permissions).toEqual({
    sleep: 'connected',
    location: 'connected',
    heartRate: 'unknown',
    activity: 'unknown',
  });
});

test('disconnection during a probe does not leave a connected label', async () => {
  serve([linked]);
  const watch = await watchApi(async () => node, {
    readReadiness: async () => ({ appStatus: 'disconnected' }),
  }).getConnection();
  expect(watchConnectionLabel(watch)).toBe('등록/연결 끊김');
  expect(watch.permissions.heartRate).toBe('unknown');
});

test('manual W03 unlink survives a later home read even while the OS node is reachable', async () => {
  serve([linked]);
  const api = watchApi(async () => node, {
    readReadiness: async () => ({ appStatus: 'responded', heartRate: true, activity: true }),
  });
  expect(watchConnectionLabel(await api.getConnection())).toBe('연결됨');
  await api.disconnect();
  const afterHome = await api.getConnection();
  expect(afterHome.status).toBe('disconnected');
  expect(watchConnectionLabel(afterHome)).toBe('등록 안 됨');
  expect(calls().filter(call => call.request.startsWith('POST'))).toEqual([]);
  expect(watchConnectionLabel(await api.reconnect())).toBe('연결됨');
  expect(calls().filter(call => call.request.startsWith('POST'))).toHaveLength(1);
});

test('a failed W02 read cannot infer registration from an available OS node', async () => {
  fetchMock.mockResolvedValue(respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }));
  const readReadiness = jest.fn(async () => ({ appStatus: 'responded' as const, heartRate: true, activity: true }));
  const watch = await watchApi(async () => node, { readReadiness }).getConnection();
  expect(watchConnectionLabel(watch)).toBe('등록 상태 미확인');
  expect(watch.status).toBe('disconnected');
  expect(readReadiness).not.toHaveBeenCalled();
  expect(calls().filter(call => call.request.startsWith('POST'))).toEqual([]);
});
