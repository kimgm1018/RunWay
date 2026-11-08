import { errorCode, type DataErrorCode } from '../data/errors';
import type { PhoneFix, PhoneLocation, Repositories } from '../data/types';
import { gpsItem, MAX_ITEMS, phoneBatchBody, type BatchJson } from './phoneBatch';

// 폰 인계 뒤 폰 기록(S15P31E105-464, devices-health.md 폰 인계 후 업로드·종료).
// 폰 GPS를 최대 5초씩 모아 폰 deviceId의 GPS_POINT batch를 만들고 W07에 올린다. 일시정지 중의 위치는 기록하지 않는다.
// 종료(finish)는 GPS를 멈추고 남은 점을 마지막 batch로 만든 뒤, 최대 2분 동안 모든 폰 batch의 COMMITTED를 확인한다.
// batch는 앱 메모리에만 있다. 앱이 꺼지면 아직 올리지 못한 폰 위치는 남지 않는다.

type Deps = {
  sessionId: string;
  deviceId: string;
  location: PhoneLocation;
  upload: Repositories['session']['uploadBatch'];
  newId: () => string;
  flushMs?: number;
  // 최초 포함 최대 3회, 추가 1초·2초 + jitter (W07 오류와 재시도).
  retryDelaysMs?: number[];
  // 종료 후 마무리 전송 상한(2분)과 재시도 간격.
  finishWaitMs?: number;
  finishRetryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type PhoneRecorder = {
  // GPS를 켠다. 권한·GPS가 없으면 false이며 기록은 시간만 이어간다. 처음에는 일시정지 상태다.
  start: () => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  // 측정을 멈추고 폰 batch 전체의 저장 확인(COMMITTED 또는 다시 보내도 소용없는 거절)을 기다린다. 다시 불러도 된다.
  finish: () => Promise<boolean>;
  finished: () => boolean;
  // 저장 확인이 없는 폰 batch 수.
  openCount: () => number;
  dispose: () => void;
};

type Outcome = 'COMMITTED' | 'FAILED' | 'UNCONFIRMED';
type Batch = { id: string; body: string; count: number; outcome: Outcome; sending: Promise<Outcome> | null };

const RETRYABLE: DataErrorCode[] = ['NETWORK_ERROR', 'SERVER_ERROR'];

export function createPhoneRecorder({
  sessionId,
  deviceId,
  location,
  upload,
  newId,
  flushMs = 5000,
  retryDelaysMs = [0, 1000, 2000],
  finishWaitMs = 120_000,
  finishRetryMs = 2000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
}: Deps): PhoneRecorder {
  let collecting = false;
  let stopped = false;
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let points: BatchJson[] = [];
  const batches: Batch[] = [];

  async function send(batch: Batch): Promise<Outcome> {
    for (const delay of retryDelaysMs) {
      if (disposed) {
        return 'UNCONFIRMED';
      }
      if (delay > 0) {
        await sleep(delay + Math.floor(Math.random() * Math.min(500, delay)));
      }
      try {
        const ack = await upload(batch.body);
        // 다른 batch·개수의 응답은 저장 확인으로 쓰지 않는다.
        return ack.status === 'COMMITTED' && ack.batchId === batch.id && ack.acceptedCount === batch.count
          ? 'COMMITTED'
          : 'UNCONFIRMED';
      } catch (error) {
        if (!RETRYABLE.includes(errorCode(error))) {
          // 401은 로그인 복구 뒤 다시 보낸다. 나머지 4xx는 같은 본문으로 다시 보내도 결과가 바뀌지 않는다.
          return errorCode(error) === 'UNAUTHORIZED' ? 'UNCONFIRMED' : 'FAILED';
        }
      }
    }
    return 'UNCONFIRMED';
  }

  const settle = (batch: Batch): Promise<Outcome> => {
    if (batch.outcome !== 'UNCONFIRMED') {
      return Promise.resolve(batch.outcome);
    }
    batch.sending =
      batch.sending ??
      send(batch).then(outcome => {
        batch.outcome = outcome;
        batch.sending = null;
        return outcome;
      });
    return batch.sending;
  };

  // 모은 점을 batch로 확정한다. 한 번 만든 본문·ID는 바꾸지 않는다.
  const flush = () => {
    while (points.length > 0) {
      const items = points.slice(0, MAX_ITEMS);
      points = points.slice(MAX_ITEMS);
      const id = newId();
      try {
        batches.push({
          id,
          body: phoneBatchBody(id, deviceId, sessionId, items),
          count: items.length,
          outcome: 'UNCONFIRMED',
          sending: null,
        });
      } catch {
        // ID 형식 오류 등으로 만들 수 없는 본문은 보내지 않는다.
      }
    }
    batches.forEach(batch => {
      settle(batch).catch(() => undefined);
    });
  };

  const onFix = (fix: PhoneFix) => {
    if (!collecting || stopped) {
      return;
    }
    const item = gpsItem(fix);
    if (item) {
      points.push(item);
    }
  };

  const stopGps = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    location.stop().catch(() => undefined);
  };

  return {
    start: async () => {
      if (stopped || disposed) {
        return false;
      }
      unsubscribe = unsubscribe ?? location.subscribe(onFix);
      if (timer === null) {
        timer = setInterval(flush, flushMs);
        (timer as unknown as { unref?: () => void }).unref?.();
      }
      return location.start().catch(() => false);
    },
    pause: () => {
      collecting = false;
      flush();
    },
    resume: () => {
      if (!stopped) {
        collecting = true;
      }
    },
    finish: async () => {
      collecting = false;
      if (!stopped) {
        stopped = true;
        stopGps();
      }
      flush();
      const deadline = now() + finishWaitMs;
      for (;;) {
        const outcomes = await Promise.all(batches.map(settle));
        if (outcomes.every(outcome => outcome !== 'UNCONFIRMED')) {
          return true;
        }
        if (disposed || now() + finishRetryMs > deadline) {
          return false;
        }
        await sleep(finishRetryMs);
      }
    },
    finished: () => stopped,
    openCount: () => batches.filter(batch => batch.outcome === 'UNCONFIRMED').length,
    dispose: () => {
      disposed = true;
      collecting = false;
      stopGps();
    },
  };
}
