import { createMockRepositories } from '../../mock/createMockRepositories';
import type { MockScenario } from '../../mock/createMockRepositories';
import { createWatchApi } from '../devices';
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

const watchApi = (scenario: MockScenario = 'default') =>
  createWatchApi(createMockRepositories({ latencyMs: 0, scenario }).watch);

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await tokenStore.save({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

test('W02 with a linked watch shows the watch as connected', async () => {
  serve([linked]);

  const watch = await watchApi().getConnection();

  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
  ]);
  expect(watch).toMatchObject({
    status: 'connected',
    deviceName: 'Galaxy Watch7',
  });
});

test('W02 without a linked watch shows 연결 끊김', async () => {
  serve([]);
  expect((await watchApi().getConnection()).status).toBe('disconnected');
});

test('W01 links a reachable watch', async () => {
  serve([]);

  const watch = await watchApi().reconnect();

  expect(watch.status).toBe('connected');
  expect(calls()).toEqual([
    { request: 'POST /devices', body: { deviceType: 'WATCH' } },
  ]);
});

test('a watch the phone cannot reach is not linked', async () => {
  serve([]);

  const watch = await watchApi('watchDisconnected').reconnect();

  expect(watch.status).toBe('disconnected');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('W03 unlinks the linked watch', async () => {
  serve([linked]);

  const watch = await watchApi().disconnect();

  expect(watch.status).toBe('disconnected');
  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
    'DELETE /devices/31',
  ]);
});

test('unlinking with nothing linked asks nothing more of the server', async () => {
  serve([]);

  await watchApi().disconnect();

  expect(calls().map(call => call.request)).toEqual([
    'GET /devices?deviceType=WATCH',
  ]);
});

test('W01 failures reach the screen', async () => {
  fetchMock.mockResolvedValue(
    respond(503, { code: 'SERVICE_UNAVAILABLE', message: '', details: {} }),
  );
  await expect(watchApi().reconnect()).rejects.toMatchObject({
    code: 'SERVER_ERROR',
  });
});
