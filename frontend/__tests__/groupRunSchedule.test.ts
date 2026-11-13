import {
  scheduleDays,
  scheduleProblem,
  startTimes,
  timesOn,
} from '../src/screens/group/groupRunSchedule';

// S15P31E105-798 (TEAM QA T32): the 6.8 picker offers only what the server takes (S15P31E105-779): after now, up to
// 13 days from today in Korea, 05:00-22:00 Korea time. Synthetic dates only.

// 2026-11-13 10:20 in Korea.
const now = new Date('2026-11-13T10:20:00+09:00');

test('start times run every 30 minutes from 05:00 to 22:00', () => {
  expect(startTimes[0]).toBe(5 * 60);
  expect(startTimes[startTimes.length - 1]).toBe(22 * 60);
  expect(startTimes).toHaveLength(35);
});

test('today offers only the start times still ahead of now', () => {
  const today = timesOn('2026-11-13', now);
  expect(today[0]).toBe(10 * 60 + 30);
  expect(today.every(item => item > 10 * 60 + 20)).toBe(true);
  expect(timesOn('2026-11-14', now)).toEqual(startTimes);
});

test('a start time exactly now is already past', () => {
  const onSlot = new Date('2026-11-13T10:30:00+09:00');
  expect(timesOn('2026-11-13', onSlot)[0]).toBe(11 * 60);
  expect(scheduleProblem('2026-11-13', 10 * 60 + 30, onSlot)).toBe('PAST');
});

test('days run from today to 13 days ahead', () => {
  const days = scheduleDays(now);
  expect(days).toHaveLength(14);
  expect(days[0]).toBe('2026-11-13');
  expect(days[13]).toBe('2026-11-26');
});

test('today drops out once no start time is left', () => {
  const late = new Date('2026-11-13T22:10:00+09:00');
  expect(scheduleDays(late)[0]).toBe('2026-11-14');
  expect(scheduleDays(late)).toHaveLength(13);
});

test('the Korean date is used, not the UTC one', () => {
  // 00:30 on the 14th in Korea is still the 13th in UTC.
  const early = new Date('2026-11-14T00:30:00+09:00');
  expect(scheduleDays(early)[0]).toBe('2026-11-14');
});

test('problems: a past day or time, too far ahead, outside the hours', () => {
  expect(scheduleProblem('2026-11-12', 7 * 60, now)).toBe('PAST');
  expect(scheduleProblem('2026-11-13', 10 * 60, now)).toBe('PAST');
  expect(scheduleProblem('2026-11-13', 10 * 60 + 30, now)).toBeNull();
  expect(scheduleProblem('2026-11-26', 22 * 60, now)).toBeNull();
  expect(scheduleProblem('2026-11-27', 7 * 60, now)).toBe('TOO_FAR');
  expect(scheduleProblem('2026-11-20', 4 * 60 + 30, now)).toBe('OUT_OF_HOURS');
  expect(scheduleProblem('2026-11-20', 22 * 60 + 30, now)).toBe('OUT_OF_HOURS');
  expect(scheduleProblem(null, 7 * 60, now)).toBeNull();
});

test('a start picked earlier turns into a problem once the clock passes it', () => {
  const picked = scheduleProblem('2026-11-13', 11 * 60, now);
  expect(picked).toBeNull();
  const later = new Date('2026-11-13T11:05:00+09:00');
  expect(scheduleProblem('2026-11-13', 11 * 60, later)).toBe('PAST');
});
