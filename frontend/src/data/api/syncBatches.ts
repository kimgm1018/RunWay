import type { SyncBatchAck } from '../types';
import { apiRequest } from './http';

// W07 워치 운동 배치 동기화 (docs/design/api/devices-health.md W07, S15P31E105-311).
// 본문은 워치가 해시한 원문 그대로 보낸다. JSON.parse로 다시 만들면 int64 ID·숫자 표기가 바뀔 수 있다.
// ACK 대기 10초(구간별 초기값). 재시도는 호출하는 쪽(batchRelay)이 같은 본문으로 한다.
export const uploadSyncBatch = (body: string) =>
  apiRequest<SyncBatchAck>('/sync/batches', { method: 'POST', jsonText: body, timeoutMs: 10_000 });
