import { errorCode, type DataErrorCode } from '../data/errors';
import type { Repositories, WatchSessionEvent } from '../data/types';

// 워치 batch를 W07로 중계한다(S15P31E105-311, watch-mobile-server-integration.md 6장, devices-health.md W07).
// 폰은 batch를 이미 네이티브에 영속 저장하고 BATCH_RECEIVED를 보냈다. 여기서는 같은 본문을 서버에 보내고,
// COMMITTED 응답을 확인한 뒤에만 워치에 BATCH_COMMITTED를 보낸다. 본문·값은 로그에 남기지 않는다.

type BatchEvent = Extract<WatchSessionEvent, { type: 'BATCH_DATA' }>;

type Deps = {
  upload: Repositories['session']['uploadBatch'];
  watch: Pick<Repositories['watchSession'], 'commitBatch' | 'failBatch'>;
  // 최초 포함 최대 3회, 추가 1초·2초 + jitter (W07 오류와 재시도).
  retryDelaysMs?: number[];
  jitter?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// 한 batch의 업로드 결과. FAILED는 같은 본문으로 다시 보내도 소용없는 거절, UNCONFIRMED는 저장 미확인이다.
export type BatchOutcome = 'COMMITTED' | 'FAILED' | 'UNCONFIRMED';

export type BatchRelay = {
  handle: (event: BatchEvent) => void;
  // 업로드하고(진행 중이면 그 결과를 기다리고) 결과를 돌려준다. 폰 인계 전 저장 확인에 쓴다(S15P31E105-464).
  settle: (event: BatchEvent) => Promise<BatchOutcome>;
  // 업로드 중인 batch 수. 테스트·화면 표시에 쓴다.
  inflight: () => number;
};

// 결과가 불명확한 응답 없음·서버 장애(5xx)만 같은 본문으로 다시 보낸다.
const RETRYABLE: DataErrorCode[] = ['NETWORK_ERROR', 'SERVER_ERROR'];
// 같은 본문을 다시 보내도 결과가 바뀌지 않는 거절. 워치가 재전송을 멈추도록 알린다.
// 401은 로그인 복구 뒤 워치 재전송으로 다시 올라가도록 남겨 둔다. 429는 Retry-After를 우회하지 않고 이번 시도를 멈춘다.
const FINAL: DataErrorCode[] = [
  'VALIDATION_ERROR',
  'DEVICE_FORBIDDEN',
  'SESSION_FORBIDDEN',
  'CONSENT_REQUIRED',
  'BATCH_HASH_CONFLICT',
  'INVALID_BATCH',
  'FILE_TOO_LARGE',
  'INVALID_SESSION_STATE',
  'CONTROL_DEVICE_CHANGED',
];

export function createBatchRelay({
  upload,
  watch,
  retryDelaysMs = [0, 1000, 2000],
  jitter = () => Math.floor(Math.random() * 500),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}: Deps): BatchRelay {
  // 같은 batch가 재전송·수신함 복구로 여러 번 와도 동시에 한 번만 올린다.
  const uploading = new Map<string, Promise<BatchOutcome>>();

  async function send(event: BatchEvent): Promise<BatchOutcome> {
    let lastCode: DataErrorCode = 'UNKNOWN';
    for (const delay of retryDelaysMs) {
      if (delay > 0) {
        await sleep(delay + jitter());
      }
      try {
        const ack = await upload(event.body);
        // ACK는 원래 batch의 것이어야 한다. 다른 batch·개수의 응답을 저장 확인으로 쓰지 않는다.
        if (
          ack.status !== 'COMMITTED' ||
          ack.batchId !== event.batchId ||
          ack.acceptedCount !== event.itemCount
        ) {
          return 'UNCONFIRMED';
        }
        // 폰 기록에 저장 확인을 남긴 뒤에만 확정으로 본다. 기록하지 못하면 다시 보내 같은 ACK를 받는다.
        await watch.commitBatch(event.batchId, ack.acceptedCount);
        return 'COMMITTED';
      } catch (error) {
        lastCode = errorCode(error);
        if (!RETRYABLE.includes(lastCode)) {
          break;
        }
      }
    }
    if (FINAL.includes(lastCode)) {
      await watch.failBatch(event.batchId, lastCode);
      return 'FAILED';
    }
    // 그 밖(시간 초과·반복 장애)은 저장 미확인으로 남긴다. 워치가 같은 batch를 다시 보내면 다시 올린다.
    return 'UNCONFIRMED';
  }

  const settle = (event: BatchEvent) => {
    const running = uploading.get(event.batchId);
    if (running) {
      return running;
    }
    const next = send(event)
      .catch((): BatchOutcome => 'UNCONFIRMED')
      .finally(() => uploading.delete(event.batchId));
    uploading.set(event.batchId, next);
    return next;
  };

  return {
    handle: event => {
      if (!uploading.has(event.batchId)) {
        settle(event).catch(() => undefined);
      }
    },
    settle,
    inflight: () => uploading.size,
  };
}
