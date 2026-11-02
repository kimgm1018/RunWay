import { DataError } from '../../errors';
import type { ApiRequest } from '../request';
import { createLinkedDevices } from '../sessionDevices';

// S01의 controlDeviceId(워치)·relayDeviceId(폰)를 W01·W02(docs/design/api/devices-health.md)로 얻는다 (S15P31E105-256).

type Call = { method: string; path: string; body?: unknown };

function fake(responses: unknown[]) {
  const calls: Call[] = [];
  const request = (async (method: string, path: string, body?: unknown) => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as ApiRequest;
  return { calls, linkedDevices: createLinkedDevices(request) };
}

const watch = { id: 101, deviceType: 'WATCH', linkedAt: '2026-11-01T00:00:00Z', unlinkedAt: null };
const phone = { id: 102, deviceType: 'PHONE', linkedAt: '2026-11-01T00:00:00Z', unlinkedAt: null };

test('both linked devices come from W02 as strings', async () => {
  const { calls, linkedDevices } = fake([{ items: [watch, phone] }]);

  expect(await linkedDevices()).toEqual({ watchDeviceId: '101', phoneDeviceId: '102' });
  expect(calls).toEqual([{ method: 'GET', path: '/devices' }]);
});

test('without a linked watch there is no run to start and the phone is not linked', async () => {
  const { calls, linkedDevices } = fake([{ items: [phone] }]);

  expect(await linkedDevices()).toBeNull();
  expect(calls).toHaveLength(1);
});

test('a phone that is not linked yet is linked with W01 for the run', async () => {
  const { calls, linkedDevices } = fake([{ items: [watch] }, { ...phone, id: 205 }]);

  expect(await linkedDevices()).toEqual({ watchDeviceId: '101', phoneDeviceId: '205' });
  expect(calls[1]).toEqual({ method: 'POST', path: '/devices', body: { deviceType: 'PHONE' } });
});

test('a failed lookup reaches the caller unchanged', async () => {
  const { linkedDevices } = fake([new DataError('NETWORK_ERROR', '서버에 연결하지 못했어요.')]);

  await expect(linkedDevices()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
});
