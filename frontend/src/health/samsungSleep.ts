import { DataError } from '../data/errors';
import type { HealthRecord, ReadWindow } from './types';
import { localWakeDate, sleepByWakeDate } from './sleep';
import {
  readDailyRestingHr,
  restingHrMethod,
  type DailyRestingHr,
} from './samsungRestingHr';

// S15P31E105-572: Samsung Health sleep read directly on the phone (never through Health Connect), summed per local
// wake date, sent to W06 as `SAMSUNG_HEALTH` / `DAILY_SLEEP_SUMMARY` and shown on 2.1 when R02 has no sleep for today.
// Health values stay out of logs.

export type SleepAccess =
  | 'unavailable'
  | 'notRequested'
  | 'denied'
  | 'revoked'
  | 'granted';

export type NativeSleepAccess = 'granted' | 'required' | 'unavailable';

export type SleepNative = {
  status(): Promise<NativeSleepAccess>;
  // Resolves whether sleep read is granted after the system dialog.
  request(): Promise<boolean>;
  read(window: ReadWindow): Promise<HealthRecord[]>;
  loadState(): Promise<string | null>;
  saveState(json: string | null): Promise<unknown>;
};

// Persisted on the phone. The access history is the OS's; `uploaded` belongs to the account in `owner` and is only
// trusted for that account, so a sign-out that never finished clearing it cannot hide another account's sleep.
export type SleepState = {
  requested: boolean;
  everGranted: boolean;
  owner: string | null;
  uploaded: Record<string, number>;
};

const emptyState = (): SleepState => ({
  requested: false,
  everGranted: false,
  owner: null,
  uploaded: {},
});

export async function loadSleepState(native: SleepNative): Promise<SleepState> {
  try {
    const saved = await native.loadState();
    const value = saved ? JSON.parse(saved) : null;
    if (!value || typeof value !== 'object') {
      return emptyState();
    }
    const uploaded: Record<string, number> = {};
    if (value.uploaded && typeof value.uploaded === 'object') {
      for (const [date, minutes] of Object.entries(value.uploaded)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof minutes === 'number') {
          uploaded[date] = minutes;
        }
      }
    }
    return {
      requested: value.requested === true,
      everGranted: value.everGranted === true,
      owner: typeof value.owner === 'string' ? value.owner : null,
      uploaded,
    };
  } catch {
    return emptyState();
  }
}

// Every read-modify-write of the state runs one after another, so a sign-out reset and an upload mark cannot
// overwrite each other.
let stateQueue: Promise<unknown> = Promise.resolve();

function updateSleepState(
  native: SleepNative,
  change: (state: SleepState) => SleepState | null,
): Promise<SleepState> {
  const next = stateQueue
    .catch(() => {})
    .then(async () => {
      const state = await loadSleepState(native);
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

export function accessFrom(
  status: NativeSleepAccess,
  state: Pick<SleepState, 'requested' | 'everGranted'>,
): SleepAccess {
  if (status === 'unavailable') {
    return 'unavailable';
  }
  if (status === 'granted') {
    return 'granted';
  }
  return state.everGranted
    ? 'revoked'
    : state.requested
    ? 'denied'
    : 'notRequested';
}

// Reads the OS state; remembers a grant so a later loss shows as revoked rather than never asked.
export async function checkSleepAccess(
  native: SleepNative,
): Promise<SleepAccess> {
  let status: NativeSleepAccess;
  try {
    status = await native.status();
  } catch (error) {
    // Policy or SDK errors mean the app cannot read Samsung Health right now; permission errors mean not granted.
    status =
      (error as { code?: string })?.code === 'SAMSUNG_PERMISSION'
        ? 'required'
        : 'unavailable';
  }
  const state = await updateSleepState(native, current =>
    status === 'granted' && !current.everGranted
      ? { ...current, everGranted: true }
      : null,
  );
  return accessFrom(status, state);
}

export async function requestSleepAccess(
  native: SleepNative,
): Promise<SleepAccess> {
  let granted: boolean;
  try {
    granted = await native.request();
  } catch {
    // The dialog never showed (no activity, SDK error): that is not the user's denial.
    return checkSleepAccess(native);
  }
  await recordAccessRequest(native, granted);
  return granted ? 'granted' : checkSleepAccess(native);
}

// Remembers that the dialog was shown, so a later 'required' reads as denied (never granted) or revoked.
export async function recordAccessRequest(native: SleepNative, granted: boolean) {
  await updateSleepState(native, state => ({
    ...state,
    requested: true,
    everGranted: state.everGranted || granted,
  }));
}

export const sleepDays = 7;

const startOfLocalDay = (time: Date) =>
  new Date(time.getFullYear(), time.getMonth(), time.getDate());

// Local midnight six days back until now: today plus the six days before.
export function sleepWindow(now: Date): ReadWindow {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - (sleepDays - 1));
  return { start: start.toISOString(), end: now.toISOString() };
}

// W06 accepts more than 0 and at most 1440 minutes a day.
const maxDailyMinutes = 1440;

export type DailySleep = { date: string; minutes: number };

export type DailySleepRead = { days: DailySleep[]; unresolved: string[] };

// Confirmed sleep minutes per wake date (two decimals). A day whose sleep cannot be resolved, or whose total is
// beyond a day, is unresolved and never sent; a day without positive sleep is left out.
export function dailySleep(
  records: HealthRecord[],
  window: ReadWindow,
): DailySleepRead {
  const days: DailySleep[] = [];
  const unresolved: string[] = [];
  for (const day of sleepByWakeDate(records, window)) {
    const minutes = day.ms === null ? null : Math.round(day.ms / 600) / 100;
    if (minutes === null || minutes > maxDailyMinutes) {
      unresolved.push(day.date);
    } else if (minutes > 0) {
      days.push({ date: day.date, minutes });
    }
  }
  return { days, unresolved };
}

export type TodaySleep =
  | { status: 'ready'; date: string; minutes: number }
  | {
      status:
        | 'empty'
        | 'unresolved'
        | 'error'
        | 'accessRequired'
        | 'unavailable';
    };

type ReadFailure = {
  status: 'error' | 'accessRequired' | 'unavailable';
};

const readFailure = (error: unknown): ReadFailure => {
  const code = (error as { code?: string })?.code;
  return {
    status:
      code === 'SAMSUNG_PERMISSION' || code === 'SAMSUNG_POLICY'
        ? 'accessRequired'
        : code === 'SAMSUNG_UNAVAILABLE'
        ? 'unavailable'
        : 'error',
  };
};

export async function readDailySleep(
  native: SleepNative,
  now: Date,
): Promise<({ status: 'ready' } & DailySleepRead) | ReadFailure> {
  const window = sleepWindow(now);
  try {
    const records = await native.read(window);
    return { status: 'ready', ...dailySleep(records, window) };
  } catch (error) {
    return readFailure(error);
  }
}

// 2.1 partial display: today's wake date first. Without a night ending today, the latest night in the window is
// shown with its own wake date (2026-11-09 사용자 결정, 실기기 E2E). A night today whose time cannot be resolved
// says so rather than falling back to an older night.
export async function readTodaySleep(
  native: SleepNative,
  now: Date,
): Promise<TodaySleep> {
  const result = await readDailySleep(native, now);
  if (result.status !== 'ready') {
    return result;
  }
  const today = localWakeDate(now.getTime());
  if (result.unresolved.includes(today)) {
    return { status: 'unresolved' };
  }
  const latest = result.days.reduce<DailySleep | null>(
    (best, day) => (best === null || day.date > best.date ? day : best),
    null,
  );
  return latest
    ? { status: 'ready', date: latest.date, minutes: latest.minutes }
    : { status: 'empty' };
}

// W06 (docs/design/api/devices-health.md, S15P31E105-572).
// S15P31E105-600: the same request also carries the phone's daily resting heart rate.
export type SleepSyncRecord =
  | {
      type: 'DAILY_SLEEP_SUMMARY';
      metricDate: string;
      sleepDurationMin: number;
      computedAt: string;
    }
  | {
      type: 'DAILY_RESTING_HR';
      metricDate: string;
      restingHrBpm: number;
      method: typeof restingHrMethod;
      validMinuteCount: number;
      computedAt: string;
    };

export type SleepSyncRequest = {
  provider: 'SAMSUNG_HEALTH';
  records: SleepSyncRecord[];
};

export type SleepSyncResponse = {
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  errors: { index: number; code?: string; reason?: string }[];
};

export type SleepUploadDeps = {
  native: SleepNative;
  // S15P31E105-600: heart rate boundary. When given, the phone's daily resting heart rate goes in the same request,
  // so this phone never sends two SAMSUNG_HEALTH W06 requests at once.
  heart?: SleepNative;
  send: (body: SleepSyncRequest) => Promise<SleepSyncResponse>;
  // Server health consent (W05), null when unknown. OS permission is a different thing; without consent nothing is sent.
  consent: () => Promise<'AGREE' | 'DISAGREE' | null>;
  // Login generation; a change while a request is in flight means another account.
  sessionKey: () => string | undefined;
  // The signed-in account the sent marks belong to; undefined when not known (then nothing is skipped).
  owner: () => string | undefined;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
};

export type SleepUploadResult =
  | 'done'
  | 'nothing'
  | 'no-access'
  | 'consent-required'
  | 'signed-out'
  | 'retry-later';

// No answer or 503: the same request may be resent. Three tries per run, then wait for the next run (as 281).
export const sleepRetryDelaysMs = [2_000, 10_000];

const transient = (error: unknown) =>
  error instanceof DataError &&
  (error.code === 'NETWORK_ERROR' || error.status === 503);

// A 200 is only trusted when its counts add up to what was sent.
function countsAddUp(response: SleepSyncResponse, sent: number) {
  return (
    !!response &&
    Array.isArray(response.errors) &&
    response.acceptedCount +
      response.duplicateCount +
      response.rejectedCount ===
      sent &&
    response.errors.length === response.rejectedCount
  );
}

let running: Promise<SleepUploadResult> | null = null;

// One run at a time: W06 requests from one phone are never concurrent, so the last value stays the newest.
export function uploadSamsungSleep(
  deps: SleepUploadDeps,
): Promise<SleepUploadResult> {
  if (!running) {
    running = runUpload(deps).finally(() => {
      running = null;
    });
  }
  return running;
}

// Marks the sent values for this account so a repeated read does not resend them, and drops dates older than the
// read window. Marks of another account are replaced, never merged.
function markSent(
  native: SleepNative,
  owner: string | undefined,
  sent: [date: string, value: number][],
  earliest: string,
) {
  return updateSleepState(native, state => {
    const uploaded: Record<string, number> = {};
    if (owner !== undefined && state.owner === owner) {
      for (const [date, value] of Object.entries(state.uploaded)) {
        if (date >= earliest) {
          uploaded[date] = value;
        }
      }
    }
    sent.forEach(([date, value]) => {
      uploaded[date] = value;
    });
    return { ...state, owner: owner ?? null, uploaded };
  });
}

type ReadFailureStatus = 'error' | 'accessRequired' | 'unavailable';

// What one metric adds to the request: the changed days, or why it could not be read.
type Part<T> = { changed: T[] } | { failed: ReadFailureStatus } | null;

async function sentMarks(native: SleepNative, owner: string | undefined) {
  const state = await loadSleepState(native);
  return owner !== undefined && state.owner === owner ? state.uploaded : {};
}

async function sleepPart(
  native: SleepNative,
  owner: string | undefined,
  now: Date,
): Promise<Part<DailySleep>> {
  if ((await checkSleepAccess(native)) !== 'granted') {
    return null;
  }
  const read = await readDailySleep(native, now);
  if (read.status !== 'ready') {
    return { failed: read.status };
  }
  const sent = await sentMarks(native, owner);
  return { changed: read.days.filter(day => sent[day.date] !== day.minutes) };
}

async function restingHrPart(
  heart: SleepNative | undefined,
  owner: string | undefined,
  now: Date,
): Promise<Part<DailyRestingHr>> {
  if (!heart || (await checkSleepAccess(heart)) !== 'granted') {
    return null;
  }
  const read = await readDailyRestingHr(heart, now);
  if (read.status !== 'ready') {
    return { failed: read.status };
  }
  const sent = await sentMarks(heart, owner);
  return { changed: read.days.filter(day => sent[day.date] !== day.bpm) };
}

const changedOf = <T,>(part: Part<T>): T[] =>
  part && 'changed' in part ? part.changed : [];

async function runUpload(deps: SleepUploadDeps): Promise<SleepUploadResult> {
  const token = deps.sessionKey();
  if (!token) {
    return 'signed-out';
  }
  const owner = deps.owner();
  const now = deps.now();
  const sleep = await sleepPart(deps.native, owner, now);
  const heart = await restingHrPart(deps.heart, owner, now);
  if (!sleep && !heart) {
    return 'no-access';
  }
  const sleepChanged = changedOf(sleep);
  const heartDays = changedOf(heart);
  if (!sleepChanged.length && !heartDays.length) {
    // Nothing readable changed. A failed read waits for the next run (error) or for access (permission/policy).
    const failures = [sleep, heart].flatMap(part =>
      part && 'failed' in part ? [part.failed] : [],
    );
    if (failures.includes('error')) {
      return 'retry-later';
    }
    return failures.length && failures.length === [sleep, heart].filter(Boolean).length
      ? 'no-access'
      : 'nothing';
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
  const earliest = localWakeDate(Date.parse(sleepWindow(now).start));
  const computedAt = now.toISOString();
  const body: SleepSyncRequest = {
    provider: 'SAMSUNG_HEALTH',
    records: [
      ...sleepChanged.map(
        (day): SleepSyncRecord => ({
          type: 'DAILY_SLEEP_SUMMARY',
          metricDate: day.date,
          sleepDurationMin: day.minutes,
          computedAt,
        }),
      ),
      ...heartDays.map(
        (day): SleepSyncRecord => ({
          type: 'DAILY_RESTING_HR',
          metricDate: day.date,
          restingHrBpm: day.bpm,
          method: restingHrMethod,
          validMinuteCount: day.minutes,
          computedAt,
        }),
      ),
    ],
  };
  const total = body.records.length;
  for (let attempt = 0; ; attempt++) {
    if (deps.sessionKey() !== token) {
      return 'signed-out';
    }
    let response: SleepSyncResponse;
    try {
      response = await deps.send(body);
    } catch (error) {
      // The answer belongs to the previous session: no retry or marks for the current one.
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
      // A whole-request 400·413·422, a 500 or an unknown error is not marked and waits for the next run, without an
      // immediate rerun. A server without this contract answers 422 for SAMSUNG_HEALTH; once it is deployed the same
      // days go through (2026-11-09 사용자 결정, 리뷰 A-2·B-1).
      return 'retry-later';
    }
    if (deps.sessionKey() !== token) {
      return 'signed-out';
    }
    if (!countsAddUp(response, total)) {
      return 'retry-later';
    }
    // accepted·duplicate are stored (a resting heart rate on a day with a watch value is a duplicate: the watch wins);
    // a record rejected inside a 200 cannot succeed with the same content. Either way it is marked, and a changed value
    // is sent again.
    if (sleep && 'changed' in sleep) {
      await markSent(
        deps.native,
        owner,
        sleepChanged.map(day => [day.date, day.minutes]),
        earliest,
      );
    }
    if (deps.heart && heart && 'changed' in heart) {
      // A server without DAILY_RESTING_HR (before S15P31E105-600) rejects it inside a 200 as an unknown field or
      // type. Those are left unmarked so they go through once the server is updated (리뷰 A-1).
      const notUnderstood = new Set(
        response.errors
          .filter(
            e =>
              e.code === 'UNSUPPORTED_RECORD_TYPE' ||
              e.reason === 'UNKNOWN_FIELD',
          )
          .map(e => e.index),
      );
      await markSent(
        deps.heart,
        owner,
        heartDays
          .filter((_, i) => !notUnderstood.has(sleepChanged.length + i))
          .map(day => [day.date, day.bpm]),
        earliest,
      );
    }
    return response.rejectedCount === total ? 'nothing' : 'done';
  }
}

// A different account must not inherit the previous account's sent marks.
export async function resetSleepUploads(native: SleepNative) {
  await updateSleepState(native, state => ({
    ...state,
    owner: null,
    uploaded: {},
  }));
}
