import { DataError } from '../data/errors';
import type { HealthRecord, ReadWindow } from './types';
import { localWakeDate, sleepByWakeDate } from './sleep';

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
  await updateSleepState(native, state => ({
    ...state,
    requested: true,
    everGranted: state.everGranted || granted,
  }));
  return granted ? 'granted' : checkSleepAccess(native);
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
export type SleepSyncRequest = {
  provider: 'SAMSUNG_HEALTH';
  records: {
    type: 'DAILY_SLEEP_SUMMARY';
    metricDate: string;
    sleepDurationMin: number;
    computedAt: string;
  }[];
};

export type SleepSyncResponse = {
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  errors: { index: number }[];
};

export type SleepUploadDeps = {
  native: SleepNative;
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
  sent: DailySleep[],
  earliest: string,
) {
  return updateSleepState(native, state => {
    const uploaded: Record<string, number> = {};
    if (owner !== undefined && state.owner === owner) {
      for (const [date, minutes] of Object.entries(state.uploaded)) {
        if (date >= earliest) {
          uploaded[date] = minutes;
        }
      }
    }
    sent.forEach(day => {
      uploaded[day.date] = day.minutes;
    });
    return { ...state, owner: owner ?? null, uploaded };
  });
}

async function runUpload(deps: SleepUploadDeps): Promise<SleepUploadResult> {
  const token = deps.sessionKey();
  if (!token) {
    return 'signed-out';
  }
  const owner = deps.owner();
  if ((await checkSleepAccess(deps.native)) !== 'granted') {
    return 'no-access';
  }
  const now = deps.now();
  const read = await readDailySleep(deps.native, now);
  if (read.status !== 'ready') {
    return read.status === 'error' ? 'retry-later' : 'no-access';
  }
  const state = await loadSleepState(deps.native);
  const sent =
    owner !== undefined && state.owner === owner ? state.uploaded : {};
  const changed = read.days.filter(day => sent[day.date] !== day.minutes);
  if (!changed.length) {
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
  const earliest = localWakeDate(Date.parse(sleepWindow(now).start));
  const body: SleepSyncRequest = {
    provider: 'SAMSUNG_HEALTH',
    records: changed.map(day => ({
      type: 'DAILY_SLEEP_SUMMARY',
      metricDate: day.date,
      sleepDurationMin: day.minutes,
      computedAt: now.toISOString(),
    })),
  };
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
    if (!countsAddUp(response, changed.length)) {
      return 'retry-later';
    }
    // accepted·duplicate are stored; a record rejected inside a 200 cannot succeed with the same content. Either way
    // it is marked, and a changed value is sent again.
    await markSent(deps.native, owner, changed, earliest);
    return response.rejectedCount === changed.length ? 'nothing' : 'done';
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
