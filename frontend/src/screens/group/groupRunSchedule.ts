// 6.8 그룹런 시작 일시 범위 (S15P31E105-798). The server (S15P31E105-779, GroupRunSchedulePolicy) takes a start that is
// after now, no later than 13 days from today in Korea, and between 05:00 and 22:00 Korea time. The picker offers
// only those, in 30 minute steps, so the form never builds a request the server refuses.
export const MAX_DAYS_AHEAD = 13;
export const EARLIEST_MINUTES = 5 * 60;
export const LATEST_MINUTES = 22 * 60;
const STEP_MINUTES = 30;
export const kstOffsetMs = 9 * 3600 * 1000;

// Start times offered on 6.8, every 30 minutes from 05:00 to 22:00.
export const startTimes: number[] = Array.from(
  { length: (LATEST_MINUTES - EARLIEST_MINUTES) / STEP_MINUTES + 1 },
  (_, index) => EARLIEST_MINUTES + index * STEP_MINUTES,
);

// YYYY-MM-DD in Korea, `days` after `from`.
export const dayAfter = (from: Date, days: number) =>
  new Date(from.getTime() + kstOffsetMs + days * 86400000)
    .toISOString()
    .slice(0, 10);

export const minutesOfDayKst = (at: Date) => {
  const kst = new Date(at.getTime() + kstOffsetMs);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
};

// Today (KST) is offered too, but only the start times still ahead of now.
export function timesOn(day: string | null, now: Date): number[] {
  return day === dayAfter(now, 0)
    ? startTimes.filter(item => item > minutesOfDayKst(now))
    : startTimes;
}

// Today through 13 days ahead, leaving out a day with no start time left.
export function scheduleDays(now: Date): string[] {
  return Array.from({ length: MAX_DAYS_AHEAD + 1 }, (_, index) =>
    dayAfter(now, index),
  ).filter(value => timesOn(value, now).length > 0);
}

export type ScheduleProblem = 'PAST' | 'TOO_FAR' | 'OUT_OF_HOURS';

// Why a chosen day and time (minutes of the day, KST) cannot be started, or null when the server takes it. A day
// and time that became stale while the form stayed open (a start time that has passed, a new day) shows up here.
export function scheduleProblem(
  day: string | null,
  time: number,
  now: Date,
): ScheduleProblem | null {
  if (!day) {
    return null;
  }
  if (day < dayAfter(now, 0)) {
    return 'PAST';
  }
  if (day > dayAfter(now, MAX_DAYS_AHEAD)) {
    return 'TOO_FAR';
  }
  if (time < EARLIEST_MINUTES || time > LATEST_MINUTES) {
    return 'OUT_OF_HOURS';
  }
  if (day === dayAfter(now, 0) && time <= minutesOfDayKst(now)) {
    return 'PAST';
  }
  return null;
}

export const scheduleProblemText: Record<ScheduleProblem, string> = {
  PAST: '지난 시간이에요. 지금보다 뒤의 날짜·시간을 골라 주세요.',
  TOO_FAR: '오늘부터 13일 뒤까지만 고를 수 있어요. 날짜를 다시 골라 주세요.',
  OUT_OF_HOURS: '출발 시간은 오전 05:00부터 오후 10:00까지만 고를 수 있어요.',
};

// The server's own refusal of the schedule (400 VALIDATION_ERROR), for a request that got past the form.
export const scheduleRefusedText =
  '고른 날짜·시간을 지금은 쓸 수 없어요. 날짜·시간을 다시 골라 주세요';
