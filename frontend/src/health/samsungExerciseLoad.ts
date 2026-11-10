import { sha256 } from 'js-sha256';
import { DataError } from '../data/errors';
import type { ReadWindow } from './types';
import { localWakeDate } from './sleep';
import {
  checkSleepAccess,
  countsAddUp,
  sleepRetryDelaysMs,
  transient,
  uploadSamsungSleep,
  type NativeSleepAccess,
  type SleepNative,
  type SleepSyncResponse,
  type SleepUploadDeps,
  type SleepUploadResult,
} from './samsungSleep';

// S15P31E105-599: Samsung Health exercises (any type) with heart rate logs, summarised on the phone as "seconds spent
// at each bpm" and sent to W06 as `SAMSUNG_HEALTH` / `EXERCISE_HR_SUMMARY`. The server turns the summary into training
// load (TRIMP); zones and the formula live only there. Health values stay out of logs.

// One exercise session from SamsungHealthModule.readExerciseHeartRate: only log entries with a heart rate.
export type ExerciseHeartRate = {
  id: string;
  startTime: string;
  endTime: string;
  exerciseType: string;
  // [epoch ms, bpm]
  logs: [number, number][];
};

export type ExerciseNative = {
  status(): Promise<NativeSleepAccess>;
  read(window: ReadWindow): Promise<ExerciseHeartRate[]>;
  loadState(): Promise<string | null>;
  saveState(json: string | null): Promise<unknown>;
};

// docs/design/api/devices-health.md W06 EXERCISE_HR_SUMMARY.
const minBpm = 30;
const maxBpm = 220;
const maxDwellMs = 60_000;
const maxDurationMs = 24 * 60 * 60 * 1000;
const exerciseIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export type HeartRateSeconds = { bpm: number; seconds: number };

// Plan 3.1, the same rule as the server's RunWay run histogram: valid samples (30~220 bpm) in time order, one per
// timestamp (the first), each held until the next sample but at most 60 s, the last one 0 s. Time is summed in
// milliseconds per bpm rounded half-up, then each bucket is rounded to whole seconds; empty buckets are dropped.
export function heartRateHistogram(
  logs: readonly (readonly [number, number])[],
): HeartRateSeconds[] {
  const valid = logs
    .filter(
      ([time, bpm]) =>
        Number.isFinite(time) &&
        Number.isFinite(bpm) &&
        bpm >= minBpm &&
        bpm <= maxBpm,
    )
    // Array#sort is stable, so the first of equal timestamps stays first.
    .sort((a, b) => a[0] - b[0]);
  const samples: (readonly [number, number])[] = [];
  for (const sample of valid) {
    if (samples.length && samples[samples.length - 1][0] === sample[0]) {
      continue;
    }
    samples.push(sample);
  }
  const msByBpm = new Map<number, number>();
  samples.forEach(([time, bpm], i) => {
    const next = samples[i + 1];
    const dwell = next ? Math.min(next[0] - time, maxDwellMs) : 0;
    const key = Math.round(bpm);
    msByBpm.set(key, (msByBpm.get(key) ?? 0) + dwell);
  });
  return [...msByBpm]
    .map(([bpm, ms]) => ({ bpm, seconds: Math.round(ms / 1000) }))
    .filter(bucket => bucket.seconds > 0)
    .sort((a, b) => a.bpm - b.bpm);
}

export type ExerciseSyncRecord = {
  type: 'EXERCISE_HR_SUMMARY';
  exerciseId: string;
  metricDate: string;
  startedAt: string;
  endedAt: string;
  heartRateSeconds: HeartRateSeconds[];
  computedAt: string;
};

export type ExerciseSyncRequest = {
  provider: 'SAMSUNG_HEALTH';
  records: ExerciseSyncRecord[];
};

// The W06 record of one exercise, or null when it cannot be sent (bad id or times, no heart rate time, or more
// heart rate time than the exercise itself). metricDate is the phone's local date of the start.
export function exerciseRecord(
  exercise: ExerciseHeartRate,
  computedAt: string,
): ExerciseSyncRecord | null {
  if (typeof exercise.id !== 'string' || !exerciseIdPattern.test(exercise.id)) {
    return null;
  }
  const start = Date.parse(exercise.startTime);
  const end = Date.parse(exercise.endTime);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > maxDurationMs
  ) {
    return null;
  }
  // Only logs inside the exercise count (리뷰 B-8), so the heart rate time never exceeds the exercise itself.
  const heartRateSeconds = heartRateHistogram(
    (Array.isArray(exercise.logs) ? exercise.logs : []).filter(
      log => Array.isArray(log) && log[0] >= start && log[0] <= end,
    ),
  );
  if (!heartRateSeconds.length) {
    return null;
  }
  const total = heartRateSeconds.reduce((sum, b) => sum + b.seconds, 0);
  if (total > (end - start) / 1000 + 60) {
    return null;
  }
  return {
    type: 'EXERCISE_HR_SUMMARY',
    exerciseId: exercise.id,
    metricDate: localWakeDate(start),
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(end).toISOString(),
    heartRateSeconds,
    computedAt,
  };
}

// The first full upload reads four weeks so "평소 대비" works from the first day; later runs re-read one week.
export const fullDays = 28;
export const recentDays = 7;
// Sent marks older than this are dropped; they can no longer be read again.
const keepDays = 35;

const startOfLocalDay = (time: Date) =>
  new Date(time.getFullYear(), time.getMonth(), time.getDate());

const daysBefore = (now: Date, days: number) => {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - days);
  return start;
};

// Local midnight (days - 1) back until now.
export function exerciseWindow(now: Date, days: number): ReadWindow {
  return {
    start: daysBefore(now, days - 1).toISOString(),
    end: now.toISOString(),
  };
}

// Content hash of a record without computedAt, so an unchanged exercise is not sent again.
export function recordHash(record: ExerciseSyncRecord): string {
  return sha256(
    JSON.stringify([
      record.exerciseId,
      record.metricDate,
      record.startedAt,
      record.endedAt,
      record.heartRateSeconds.map(b => [b.bpm, b.seconds]),
    ]),
  );
}

const utf8Length = (text: string) => {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes += 1;
    } else if (c < 0x800) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

// W06 takes at most 31 records and 32 KiB; the phone keeps each body within 24 KiB (plan 3.4).
export const maxRecordsPerRequest = 31;
export const maxBodyBytes = 24 * 1024;

export function chunkRecords(
  records: ExerciseSyncRecord[],
  maxCount = maxRecordsPerRequest,
  maxBytes = maxBodyBytes,
): ExerciseSyncRecord[][] {
  const size = (chunk: ExerciseSyncRecord[]) =>
    utf8Length(
      JSON.stringify({ provider: 'SAMSUNG_HEALTH', records: chunk }),
    );
  const chunks: ExerciseSyncRecord[][] = [];
  let current: ExerciseSyncRecord[] = [];
  for (const record of records) {
    const next = [...current, record];
    if (current.length && (next.length > maxCount || size(next) > maxBytes)) {
      chunks.push(current);
      current = [record];
    } else {
      current = next;
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

// Persisted on the phone under its own key. requested/everGranted are the exercise access history (as sleep);
// `uploaded` (exerciseId → content hash and date), `full` (the four-week read went through) and `syncedOn` (local
// date of the last run that went through completely) belong to `owner`.
type ExerciseMark = { hash: string; date: string };

export type ExerciseState = {
  requested: boolean;
  everGranted: boolean;
  owner: string | null;
  full: boolean;
  syncedOn: string | null;
  uploaded: Record<string, ExerciseMark>;
};

const emptyState = (): ExerciseState => ({
  requested: false,
  everGranted: false,
  owner: null,
  full: false,
  syncedOn: null,
  uploaded: {},
});

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

// Whole days from one local date to another ('YYYY-MM-DD').
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
      Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) /
      86_400_000,
  );

// Days to read: four weeks until a four-week read went through; then from the day of the last complete run
// (리뷰 B-5: a phone that was not opened for more than a week must not skip the exercises in between), at least one
// week and at most four.
export function readDays(state: Pick<ExerciseState, 'full' | 'syncedOn'>, today: string) {
  if (!state.full || !state.syncedOn) {
    return fullDays;
  }
  return Math.min(
    fullDays,
    Math.max(recentDays, daysBetween(state.syncedOn, today) + 1),
  );
}

export async function loadExerciseState(
  native: ExerciseNative,
): Promise<ExerciseState> {
  try {
    const saved = await native.loadState();
    const value = saved ? JSON.parse(saved) : null;
    if (!value || typeof value !== 'object') {
      return emptyState();
    }
    const uploaded: Record<string, ExerciseMark> = {};
    if (value.uploaded && typeof value.uploaded === 'object') {
      for (const [id, mark] of Object.entries(value.uploaded)) {
        const m = mark as Partial<ExerciseMark> | null;
        if (
          exerciseIdPattern.test(id) &&
          typeof m?.hash === 'string' &&
          typeof m?.date === 'string' &&
          localDatePattern.test(m.date)
        ) {
          uploaded[id] = { hash: m.hash, date: m.date };
        }
      }
    }
    return {
      requested: value.requested === true,
      everGranted: value.everGranted === true,
      owner: typeof value.owner === 'string' ? value.owner : null,
      full: value.full === true,
      syncedOn:
        typeof value.syncedOn === 'string' && localDatePattern.test(value.syncedOn)
          ? value.syncedOn
          : null,
      uploaded,
    };
  } catch {
    return emptyState();
  }
}

// Every read-modify-write of the exercise state runs one after another.
let stateQueue: Promise<unknown> = Promise.resolve();

function updateExerciseState(
  native: ExerciseNative,
  change: (state: ExerciseState) => ExerciseState | null,
): Promise<ExerciseState> {
  const next = stateQueue
    .catch(() => {})
    .then(async () => {
      const state = await loadExerciseState(native);
      const changed = change(state);
      if (!changed) {
        return state;
      }
      try {
        await native.saveState(JSON.stringify(changed));
      } catch {
        // Losing the bookkeeping only means a duplicate W06 request later, which the server answers as duplicate.
      }
      return changed;
    });
  stateQueue = next;
  return next;
}

// The exercise access as a SleepNative, so the shared access rules (checkSleepAccess, recordAccessRequest,
// requestSamsungAccess) apply. Only requested/everGranted pass through it; the upload marks stay untouched.
const accessViews = new WeakMap<ExerciseNative, SleepNative>();

export function exerciseAccessNative(native: ExerciseNative): SleepNative {
  const known = accessViews.get(native);
  if (known) {
    return known;
  }
  const view: SleepNative = {
    status: () => native.status(),
    // Exercise is asked only in the combined dialog (requestSamsungHealthAccess).
    request: async () => false,
    read: async () => [],
    loadState: async () => {
      const state = await loadExerciseState(native);
      return JSON.stringify({
        requested: state.requested,
        everGranted: state.everGranted,
        owner: null,
        uploaded: {},
      });
    },
    saveState: async json => {
      const access = json ? JSON.parse(json) : {};
      await updateExerciseState(native, state => ({
        ...state,
        requested: access?.requested === true,
        everGranted: access?.everGranted === true,
      }));
      return true;
    },
  };
  accessViews.set(native, view);
  return view;
}

export const checkExerciseAccess = (native: ExerciseNative) =>
  checkSleepAccess(exerciseAccessNative(native));

export type ExerciseUploadDeps = Omit<
  SleepUploadDeps,
  'native' | 'heart' | 'send'
> & {
  native: ExerciseNative;
  send: (body: ExerciseSyncRequest) => Promise<SleepSyncResponse>;
};

export type ExerciseUploadResult = SleepUploadResult;

// Marks the sent records for this account and drops marks older than 35 days. Marks of another account are
// replaced, never merged. `complete` means this run went through completely: `full` is set and `syncedOn` moves
// to `today`.
function markSent(
  native: ExerciseNative,
  owner: string | undefined,
  sent: ExerciseSyncRecord[],
  earliest: string,
  complete: boolean,
  today: string,
) {
  return updateExerciseState(native, state => {
    const same = owner !== undefined && state.owner === owner;
    const uploaded: Record<string, ExerciseMark> = {};
    if (same) {
      for (const [id, mark] of Object.entries(state.uploaded)) {
        if (mark.date >= earliest) {
          uploaded[id] = mark;
        }
      }
    }
    sent.forEach(record => {
      uploaded[record.exerciseId] = {
        hash: recordHash(record),
        date: record.metricDate,
      };
    });
    return {
      ...state,
      owner: owner ?? null,
      full: owner !== undefined && ((same && state.full) || complete),
      syncedOn:
        owner === undefined ? null : complete ? today : same ? state.syncedOn : null,
      uploaded,
    };
  });
}

let running: Promise<ExerciseUploadResult> | null = null;

// One run at a time, and every request of a run strictly one after another.
export function uploadSamsungExerciseLoad(
  deps: ExerciseUploadDeps,
): Promise<ExerciseUploadResult> {
  if (!running) {
    running = runUpload(deps).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runUpload(
  deps: ExerciseUploadDeps,
): Promise<ExerciseUploadResult> {
  const token = deps.sessionKey();
  if (!token) {
    return 'signed-out';
  }
  if ((await checkExerciseAccess(deps.native)) !== 'granted') {
    return 'no-access';
  }
  const owner = deps.owner();
  const now = deps.now();
  const state = await loadExerciseState(deps.native);
  const owned = owner !== undefined && state.owner === owner;
  const today = localWakeDate(now.getTime());
  const marks = owned ? state.uploaded : {};
  let exercises: ExerciseHeartRate[];
  try {
    exercises = await deps.native.read(
      exerciseWindow(
        now,
        owned ? readDays(state, today) : fullDays,
      ),
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    return code === 'SAMSUNG_PERMISSION' ||
      code === 'SAMSUNG_POLICY' ||
      code === 'SAMSUNG_UNAVAILABLE'
      ? 'no-access'
      : 'retry-later';
  }
  const computedAt = now.toISOString();
  const seen = new Set<string>();
  const records: ExerciseSyncRecord[] = [];
  for (const exercise of Array.isArray(exercises) ? exercises : []) {
    const record = exerciseRecord(exercise, computedAt);
    if (record && !seen.has(record.exerciseId)) {
      seen.add(record.exerciseId);
      records.push(record);
    }
  }
  const earliest = localWakeDate(daysBefore(now, keepDays).getTime());
  const changed = records.filter(
    record => marks[record.exerciseId]?.hash !== recordHash(record),
  );
  if (!changed.length) {
    if (owner !== undefined) {
      await markSent(deps.native, owner, [], earliest, true, today);
    }
    return 'nothing';
  }
  let consent: 'AGREE' | 'DISAGREE' | null;
  try {
    consent = await deps.consent();
  } catch {
    return 'retry-later';
  }
  if (deps.sessionKey() !== token) {
    return 'signed-out';
  }
  if (consent !== 'AGREE') {
    return consent === 'DISAGREE' ? 'consent-required' : 'retry-later';
  }
  const chunks = chunkRecords(changed);
  let allMarked = true;
  for (const [n, chunk] of chunks.entries()) {
    const body: ExerciseSyncRequest = {
      provider: 'SAMSUNG_HEALTH',
      records: chunk,
    };
    let response: SleepSyncResponse | null = null;
    for (let attempt = 0; response === null; attempt++) {
      if (deps.sessionKey() !== token) {
        return 'signed-out';
      }
      try {
        response = await deps.send(body);
      } catch (error) {
        if (deps.sessionKey() !== token) {
          return 'signed-out';
        }
        if (transient(error) && attempt < sleepRetryDelaysMs.length) {
          await deps.wait(sleepRetryDelaysMs[attempt]);
          continue;
        }
        if (error instanceof DataError && error.code === 'CONSENT_REQUIRED') {
          return 'consent-required';
        }
        if (error instanceof DataError && error.code === 'UNAUTHORIZED') {
          return 'signed-out';
        }
        // Not marked; the rest waits for the next run. A server without this contract answers 422 here.
        return 'retry-later';
      }
    }
    if (deps.sessionKey() !== token) {
      return 'signed-out';
    }
    if (!countsAddUp(response, chunk.length)) {
      return 'retry-later';
    }
    // accepted·duplicate are stored; a record rejected inside a 200 cannot succeed with the same content, so it is
    // marked too and only a changed exercise is sent again. A server that does not know the type is not marked.
    const notUnderstood = new Set(
      response.errors
        .filter(
          e =>
            e.code === 'UNSUPPORTED_RECORD_TYPE' ||
            e.reason === 'UNKNOWN_FIELD',
        )
        .map(e => e.index),
    );
    if (notUnderstood.size) {
      allMarked = false;
    }
    await markSent(
      deps.native,
      owner,
      chunk.filter((_, i) => !notUnderstood.has(i)),
      earliest,
      allMarked && n === chunks.length - 1,
      today,
    );
  }
  return 'done';
}

// A different account must not inherit the previous account's sent marks or four-week read.
export async function resetExerciseUploads(native: ExerciseNative) {
  await updateExerciseState(native, state => ({
    ...state,
    owner: null,
    full: false,
    syncedOn: null,
    uploaded: {},
  }));
}

let runningAll: Promise<ExerciseUploadResult> | null = null;

// The W06 uploads of Samsung Health in order: sleep and resting heart rate first, then the exercise summaries, so
// this phone never has two W06 requests in flight. A call while one runs joins it.
export function uploadSamsungHealth(
  sleep: SleepUploadDeps,
  exercise: ExerciseUploadDeps,
): Promise<ExerciseUploadResult> {
  if (!runningAll) {
    runningAll = (async () => {
      await uploadSamsungSleep(sleep);
      return uploadSamsungExerciseLoad(exercise);
    })().finally(() => {
      runningAll = null;
    });
  }
  return runningAll;
}
