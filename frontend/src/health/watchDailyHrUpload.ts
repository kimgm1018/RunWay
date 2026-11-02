import { apiRequest } from '../data/api/http';
import { tokenStore } from '../data/api/tokenStore';
import { DataError } from '../data/errors';
import {
  markWatchDailyHrRejected,
  markWatchDailyHrUploaded,
  readWatchDailyHr,
  setWatchHealthConsent,
  type WatchDailyHr,
} from './watchHealth';

// W06 건강 기록 동기화 (docs/design/api/devices-health.md, S15P31E105-252 확정 계약).
type SyncRecord = {
  type: 'DAILY_HR_ESTIMATE';
  metricDate: string;
  revision: number;
  estimatedRestingHrBpm: number;
  method: string;
  validSampleCount: number;
  computedAt: string;
};

export type SyncRequest = { provider: 'RUNWAY_WATCH'; records: SyncRecord[] };

export type SyncResponse = {
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  errors: { index: number }[];
};

export type UploadDeps = {
  read: () => Promise<WatchDailyHr[]>;
  mark: (date: string, revision: number) => Promise<void>;
  // Persists a rejection on the phone so the same revision is not resent after a restart.
  reject: (date: string, revision: number) => Promise<void>;
  send: (body: SyncRequest) => Promise<SyncResponse>;
  // Server says consent is withdrawn: clear the phone records the same way sign-out does.
  withdraw: () => Promise<void>;
  accessToken: () => string | undefined;
  wait: (ms: number) => Promise<void>;
};

export type UploadResult =
  | 'done'
  | 'nothing'
  | 'signed-out'
  | 'consent-withdrawn'
  | 'retry-later';

// The contract allows 1~31 records per request.
const maxRecordsPerRequest = 31;
// No answer or 503: the same request may be resent (conditional upsert). Three tries per run, then wait for the next run.
export const retryDelaysMs = [2_000, 10_000];

// Records the server rejected (record errors, 400·413·422). Resending the same content cannot succeed: the phone store
// keeps the rejection across restarts, and this set still skips them in this run if that write fails.
const rejected = new Set<string>();

const recordKey = (date: string, revision: number) => `${date}#${revision}`;

export function resetWatchDailyHrUploadState() {
  rejected.clear();
}

const defaultDeps: UploadDeps = {
  read: readWatchDailyHr,
  mark: markWatchDailyHrUploaded,
  reject: markWatchDailyHrRejected,
  send: body =>
    apiRequest<SyncResponse>('/health-records/sync', { method: 'POST', body }),
  withdraw: () => setWatchHealthConsent('DISAGREE'),
  accessToken: () => tokenStore.current()?.accessToken,
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

function toSyncRecord(record: WatchDailyHr): SyncRecord {
  return {
    type: 'DAILY_HR_ESTIMATE',
    metricDate: record.metricDate,
    revision: record.revision,
    estimatedRestingHrBpm: record.estimatedRestingHrBpm,
    method: record.method,
    validSampleCount: record.validSampleCount,
    computedAt: record.computedAt,
  };
}

// A 200 is only trusted when its counts add up to what was sent.
function rejectedIndexes(response: SyncResponse, sent: number) {
  if (
    !response ||
    !Array.isArray(response.errors) ||
    response.acceptedCount +
      response.duplicateCount +
      response.rejectedCount !==
      sent ||
    response.errors.length !== response.rejectedCount
  ) {
    return null;
  }
  const indexes = new Set<number>();
  for (const error of response.errors) {
    if (
      !Number.isInteger(error?.index) ||
      error.index < 0 ||
      error.index >= sent
    ) {
      return null;
    }
    indexes.add(error.index);
  }
  // A repeated index leaves another record's outcome unknown.
  return indexes.size === response.rejectedCount ? indexes : null;
}

const transient = (error: unknown) =>
  error instanceof DataError &&
  (error.code === 'NETWORK_ERROR' || error.status === 503);

const permanent = (error: unknown) =>
  error instanceof DataError &&
  (error.status === 400 || error.status === 413 || error.status === 422);

async function skip(deps: UploadDeps, record: WatchDailyHr) {
  rejected.add(recordKey(record.metricDate, record.revision));
  await deps.reject(record.metricDate, record.revision);
}

type BatchResult = 'sent' | Exclude<UploadResult, 'done' | 'nothing'>;

async function uploadBatch(
  deps: UploadDeps,
  token: string,
  batch: WatchDailyHr[],
): Promise<BatchResult> {
  const body: SyncRequest = {
    provider: 'RUNWAY_WATCH',
    records: batch.map(toSyncRecord),
  };
  for (let attempt = 0; ; attempt++) {
    // Never send one account's records with another account's token.
    if (deps.accessToken() !== token) {
      return 'signed-out';
    }
    let response: SyncResponse;
    try {
      response = await deps.send(body);
    } catch (error) {
      // The answer belongs to the previous session: no retry, skip or consent change for the current one.
      if (deps.accessToken() !== token) {
        return 'signed-out';
      }
      if (transient(error) && attempt < retryDelaysMs.length) {
        await deps.wait(retryDelaysMs[attempt]);
        continue;
      }
      if (transient(error)) {
        return 'retry-later';
      }
      if (error instanceof DataError && error.code === 'CONSENT_REQUIRED') {
        await deps.withdraw();
        return 'consent-withdrawn';
      }
      if (permanent(error)) {
        for (const record of batch) {
          await skip(deps, record);
        }
        return 'sent';
      }
      // 401 signs out through http.ts; 500 and unknown errors wait for the next run (no immediate rerun).
      return error instanceof DataError && error.code === 'UNAUTHORIZED'
        ? 'signed-out'
        : 'retry-later';
    }
    const failed = rejectedIndexes(response, batch.length);
    if (!failed) {
      return 'retry-later';
    }
    if (deps.accessToken() !== token) {
      return 'signed-out';
    }
    for (const [index, record] of batch.entries()) {
      if (failed.has(index)) {
        await skip(deps, record);
      } else {
        await deps.mark(record.metricDate, record.revision);
      }
    }
    return 'sent';
  }
}

async function run(deps: UploadDeps): Promise<UploadResult> {
  const token = deps.accessToken();
  if (!token) {
    return 'signed-out';
  }
  const pending = (await deps.read())
    .filter(
      r =>
        !r.uploaded &&
        !r.rejected &&
        !rejected.has(recordKey(r.metricDate, r.revision)),
    )
    .sort((a, b) => a.metricDate.localeCompare(b.metricDate));
  if (pending.length === 0) {
    return 'nothing';
  }
  for (let start = 0; start < pending.length; start += maxRecordsPerRequest) {
    const result = await uploadBatch(
      deps,
      token,
      pending.slice(start, start + maxRecordsPerRequest),
    );
    if (result !== 'sent') {
      return result;
    }
  }
  return 'done';
}

// The latest queued or running upload and the token it was started for.
let inFlight: {
  token: string | undefined;
  promise: Promise<UploadResult>;
} | null = null;

// Uploads the latest revision of each date the watch sent, one request at a time (W06 forbids concurrent requests).
// Only a 200 marks a record uploaded; failures keep it on the phone for the next run. Health values never reach logs.
export function uploadWatchDailyHr(
  deps: UploadDeps = defaultDeps,
): Promise<UploadResult> {
  const token = deps.accessToken();
  if (inFlight && inFlight.token === token) {
    return inFlight.promise;
  }
  // A run started for the previous session ends as 'signed-out'; this session's run follows it instead of
  // sharing that result, and never overlaps it.
  const previous =
    inFlight?.promise ?? Promise.resolve<UploadResult>('nothing');
  const entry = {
    token,
    promise: previous
      .then(() => run(deps))
      .catch((): UploadResult => 'retry-later')
      .finally(() => {
        if (inFlight === entry) {
          inFlight = null;
        }
      }),
  };
  inFlight = entry;
  return entry.promise;
}
