import type { HealthRecord, ReadWindow } from './types';
import { localWakeDate } from './sleep';
import {
  checkSleepAccess,
  recordAccessRequest,
  sleepWindow,
  type SleepAccess,
  type SleepNative,
} from './samsungSleep';

// S15P31E105-600: resting heart rate computed on the phone from Samsung Health heart rate samples (SDK 1.1.0 has no
// resting heart rate), sent to W06 as `SAMSUNG_HEALTH` / `DAILY_RESTING_HR` and shown on 2.1 when R02 has none for
// today. The heart rate boundary has the same shape as the sleep one (SleepNative), so access and upload marks follow
// the sleep rules. Health values stay out of logs.

export const restingHrMethod = 'DAILY_LOWER_10PCT_MINUTE_MEAN_V1';

// docs/design/api/devices-health.md W06 DAILY_RESTING_HR (2026-11-09 사용자 결정 D-1·D-4).
const minBpm = 30;
const maxBpm = 220;
export const minValidMinutes = 30;
const lowerFraction = 0.1;
const minuteMs = 60_000;
const maxMinutesPerDay = 1440;

export type DailyRestingHr = { date: string; bpm: number; minutes: number };

export type DailyRestingHrRead = {
  days: DailyRestingHr[];
  // Dates in the window that had heart rate samples but fewer than 30 valid minutes.
  insufficient: string[];
};

// Same seven local days as sleep: today plus the six days before.
export const restingHrWindow = (now: Date): ReadWindow => sleepWindow(now);

// Mean of the lowest ceil(10%) minute means per local date, rounded half-up to one decimal like the watch. Samples
// outside 30~220 bpm or the window are dropped; samples in the same minute are averaged first; a repeated record id
// counts once. A date with fewer than 30 valid minutes has no value.
export function dailyRestingHr(
  records: HealthRecord[],
  window: ReadWindow,
): DailyRestingHrRead {
  const from = Date.parse(window.start);
  const to = Date.parse(window.end);
  const seen = new Set<string>();
  // date → minute → [sum, count]
  const byDate = new Map<string, Map<number, [number, number]>>();
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    const value = record.value;
    const time = Date.parse(record.startTime);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < minBpm ||
      value > maxBpm ||
      !Number.isFinite(time) ||
      time < from ||
      time >= to
    ) {
      continue;
    }
    const date = localWakeDate(time);
    const minute = Math.floor(time / minuteMs);
    const minutes = byDate.get(date) ?? new Map<number, [number, number]>();
    byDate.set(date, minutes);
    const sum = minutes.get(minute) ?? [0, 0];
    minutes.set(minute, [sum[0] + value, sum[1] + 1]);
  }
  const days: DailyRestingHr[] = [];
  const insufficient: string[] = [];
  for (const [date, minutes] of [...byDate].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const means = [...minutes.values()]
      .map(([sum, count]) => sum / count)
      .sort((a, b) => a - b);
    if (means.length < minValidMinutes) {
      insufficient.push(date);
      continue;
    }
    const lowest = means.slice(0, Math.ceil(means.length * lowerFraction));
    const mean = lowest.reduce((total, v) => total + v, 0) / lowest.length;
    days.push({
      date,
      bpm: Math.round((mean + Number.EPSILON) * 10) / 10,
      // A 25-hour day (daylight saving) can exceed W06's 1440 limit (리뷰 A-9·B-7).
      minutes: Math.min(means.length, maxMinutesPerDay),
    });
  }
  return { days, insufficient };
}

export type TodayRestingHr =
  | { status: 'ready'; date: string; bpm: number }
  | {
      status: 'insufficient' | 'error' | 'accessRequired' | 'unavailable';
    };

type ReadFailure = { status: 'error' | 'accessRequired' | 'unavailable' };

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

export async function readDailyRestingHr(
  native: SleepNative,
  now: Date,
): Promise<({ status: 'ready' } & DailyRestingHrRead) | ReadFailure> {
  const window = restingHrWindow(now);
  try {
    const records = await native.read(window);
    return { status: 'ready', ...dailyRestingHr(records, window) };
  } catch (error) {
    return readFailure(error);
  }
}

// 2.1 shows only today's value; there is no fallback to an earlier day (a resting heart rate is a value of the day).
// Only today's samples are read for it (리뷰 A-2·B-5); the upload reads the seven days.
export async function readTodayRestingHr(
  native: SleepNative,
  now: Date,
): Promise<TodayRestingHr> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const window = { start: start.toISOString(), end: now.toISOString() };
  let result: DailyRestingHrRead;
  try {
    result = dailyRestingHr(await native.read(window), window);
  } catch (error) {
    return readFailure(error);
  }
  const today = localWakeDate(now.getTime());
  const day = result.days.find(d => d.date === today);
  return day
    ? { status: 'ready', date: day.date, bpm: day.bpm }
    : { status: 'insufficient' };
}

export const checkHeartRateAccess = (native: SleepNative) =>
  checkSleepAccess(native);

// One dialog for both (D-8). Returns the resulting access of each.
export type SamsungAccessRequest = () => Promise<{
  sleep: boolean;
  heartRate: boolean;
}>;

export async function requestSamsungAccess(
  sleep: SleepNative,
  heart: SleepNative,
  request: SamsungAccessRequest,
): Promise<{ sleep: SleepAccess; heartRate: SleepAccess }> {
  let granted: { sleep: boolean; heartRate: boolean };
  try {
    granted = await request();
  } catch {
    // The dialog never showed (no activity, SDK error): that is not the user's denial.
    return {
      sleep: await checkSleepAccess(sleep),
      heartRate: await checkSleepAccess(heart),
    };
  }
  await recordAccessRequest(sleep, granted.sleep);
  await recordAccessRequest(heart, granted.heartRate);
  return {
    sleep: granted.sleep ? 'granted' : await checkSleepAccess(sleep),
    heartRate: granted.heartRate ? 'granted' : await checkSleepAccess(heart),
  };
}
