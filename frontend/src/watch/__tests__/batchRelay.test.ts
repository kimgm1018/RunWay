import { DataError } from '../../data/errors';
import type { SyncBatchAck, WatchSessionEvent } from '../../data/types';
import { createBatchRelay } from '../batchRelay';

// 워치 batch의 W07 중계 (S15P31E105-311, devices-health.md W07 오류와 재시도). 합성 값만 쓴다.

type BatchEvent = Extract<WatchSessionEvent, { type: 'BATCH_DATA' }>;

const batchId = '00000000-0000-4000-8000-000000000101';
const body = `{"deviceId":101,"id":"${batchId}","items":[{},{}],"payloadHash":"x","schemaVersion":"1","sessionId":9007199254740993}`;
const event: BatchEvent = { type: 'BATCH_DATA', sessionId: '9007199254740993', batchId, deviceId: '101', itemCount: 2, body };
const ack: SyncBatchAck = { status: 'COMMITTED', batchId, acceptedCount: 2 };

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function setup(upload: jest.Mock) {
  const watch = { commitBatch: jest.fn().mockResolvedValue(undefined), failBatch: jest.fn().mockResolvedValue(undefined) };
  const sleeps: number[] = [];
  const relay = createBatchRelay({
    upload,
    watch,
    jitter: () => 0,
    sleep: async ms => {
      sleeps.push(ms);
    },
  });
  return { relay, watch, sleeps };
}

async function drain(relay: { inflight: () => number }) {
  for (let i = 0; i < 20 && relay.inflight() > 0; i++) {
    await settle();
  }
}

test('uploads the body text unchanged and sends BATCH_COMMITTED only after a matching ACK', async () => {
  const upload = jest.fn().mockResolvedValue(ack);
  const { relay, watch } = setup(upload);

  relay.handle(event);
  relay.handle(event);
  await drain(relay);

  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(body);
  expect(watch.commitBatch).toHaveBeenCalledWith(batchId, 2);
});

test('an ACK for another batch or count is not a save confirmation', async () => {
  for (const wrong of [{ ...ack, batchId: '00000000-0000-4000-8000-000000000999' }, { ...ack, acceptedCount: 1 }, { ...ack, status: 'RECEIVED' }]) {
    const { relay, watch } = setup(jest.fn().mockResolvedValue(wrong));
    relay.handle(event);
    await drain(relay);
    expect(watch.commitBatch).not.toHaveBeenCalled();
    expect(watch.failBatch).not.toHaveBeenCalled();
  }
});

test('no answer or a server failure is retried with the same body, three tries in all', async () => {
  const upload = jest
    .fn()
    .mockRejectedValueOnce(new DataError('NETWORK_ERROR', 'x'))
    .mockRejectedValueOnce(new DataError('SERVER_ERROR', 'x'))
    .mockResolvedValue(ack);
  const { relay, watch, sleeps } = setup(upload);

  relay.handle(event);
  await drain(relay);

  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls.every(([sent]) => sent === body)).toBe(true);
  expect(sleeps).toEqual([1000, 2000]);
  expect(watch.commitBatch).toHaveBeenCalledWith(batchId, 2);
});

test('after three unanswered tries the batch stays unconfirmed without an error to the watch', async () => {
  const upload = jest.fn().mockRejectedValue(new DataError('NETWORK_ERROR', 'x'));
  const { relay, watch } = setup(upload);

  relay.handle(event);
  await drain(relay);

  expect(upload).toHaveBeenCalledTimes(3);
  expect(watch.commitBatch).not.toHaveBeenCalled();
  expect(watch.failBatch).not.toHaveBeenCalled();
  // 워치가 같은 batch를 다시 보내면 다시 올린다.
  relay.handle(event);
  await drain(relay);
  expect(upload).toHaveBeenCalledTimes(6);
});

test('a final refusal is not retried and tells the watch to stop resending', async () => {
  const upload = jest.fn().mockRejectedValue(new DataError('INVALID_BATCH', 'x'));
  const { relay, watch } = setup(upload);

  relay.handle(event);
  await drain(relay);

  expect(upload).toHaveBeenCalledTimes(1);
  expect(watch.failBatch).toHaveBeenCalledWith(batchId, 'INVALID_BATCH');
});

// 폰 인계 전 저장 확인(S15P31E105-464): settle은 업로드 결과를 돌려주고, 진행 중인 같은 batch는 다시 올리지 않는다.
test('settle reports COMMITTED, FAILED or UNCONFIRMED and joins an upload already running', async () => {
  const upload = jest.fn().mockResolvedValue(ack);
  const { relay } = setup(upload);
  relay.handle(event);
  expect(await relay.settle(event)).toBe('COMMITTED');
  expect(upload).toHaveBeenCalledTimes(1);

  const refused = setup(jest.fn().mockRejectedValue(new DataError('INVALID_BATCH', 'x')));
  expect(await refused.relay.settle(event)).toBe('FAILED');

  const silent = setup(jest.fn().mockRejectedValue(new DataError('NETWORK_ERROR', 'x')));
  expect(await silent.relay.settle(event)).toBe('UNCONFIRMED');
});
