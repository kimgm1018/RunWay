import { createWatchApi, watchConnectionLabel } from '../devices';
import type { ConnectedWatchNode } from '../devices';
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
  fetchMock.mockImplementation(
    async (address: string, init: { method: string }) => {
      const path = new URL(address).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/devices' && init.method === 'GET') {
        return respond(200, { items: devices });
      }
      if (path === '/devices' && init.method === 'POST') {
        return respond(201, { id: 31, deviceType: 'WATCH' });
      }
      if (path === '/devices/31' && init.method === 'DELETE') {
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

function watchApi(findConnectedWatch: () => Promise<ConnectedWatchNode | null>) {
  return createWatchApi(createMockRepositories({ latencyMs: 0 }).watch, {
    findConnectedWatch,
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
});

test('no registration and no node is 워치 없음', async () => {
  serve([]);
  const watch = await watchApi(async () => null).getConnection();
  expect(watch.status).toBe('disconnected');
  expect(watch.lastSyncedAt).toBeNull();
  expect(watchConnectionLabel(watch)).toBe('워치 없음');
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
