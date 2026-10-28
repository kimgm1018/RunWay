import { sleepSummaryByDay } from '../sleep';
import type { HealthRecord } from '../types';
const hour = 3600000;
const window = { start: '2026-10-12T15:00:00Z', end: '2026-10-20T09:00:00Z' };
const night: HealthRecord = {
  id: 'night',
  metric: 'sleep',
  source: { id: 'samsung', name: '삼성 헬스' },
  startTime: '2026-10-19T22:00:00+09:00',
  endTime: '2026-10-20T06:00:00+09:00',
  reportedSleepMs: 6 * hour,
  sleepScore: 84,
  stages: [],
};
test.each([false, true])(
  'same record with another ID keeps supplied duration, day count and score (stages %s)',
  withStages => {
    const row = {
      ...night,
      stages: withStages
        ? [
            {
              startTime: night.startTime,
              endTime: night.endTime,
              stage: 'asleep' as const,
            },
          ]
        : [],
    };
    const single = sleepSummaryByDay([row], window);
    expect(single.value).toBe(6 * hour);
    expect(
      sleepSummaryByDay([row, { ...row, id: 'duplicate' }], window),
    ).toEqual(single);
  },
);
test.each(['samsung', 'other-source'])(
  'overlap across wake dates cannot become two valid days (%s)',
  source => {
    const partial = {
      ...night,
      id: 'partial',
      endTime: '2026-10-19T23:00:00+09:00',
      reportedSleepMs: hour,
      source: { id: source, name: source },
    };
    const result = sleepSummaryByDay([night, partial], window);
    expect(result.value).toBeNull();
    expect(result.note).not.toContain('확인 2일');
  },
);
test('cross-date overlaps with complete stages become one episode on final wake date', () => {
  const whole = {
    ...night,
    reportedSleepMs: 8 * hour,
    stages: [
      {
        startTime: night.startTime,
        endTime: night.endTime,
        stage: 'asleep' as const,
      },
    ],
  };
  const partial = {
    ...whole,
    id: 'partial',
    endTime: '2026-10-19T23:00:00+09:00',
    reportedSleepMs: hour,
    stages: [
      {
        startTime: night.startTime,
        endTime: '2026-10-19T23:00:00+09:00',
        stage: 'asleep' as const,
      },
    ],
  };
  expect(sleepSummaryByDay([whole, partial], window)).toMatchObject({
    value: 8 * hour,
    note: expect.stringContaining('확인 1일'),
  });
});
test('unresolved overlap invalidates involved wake days but keeps unrelated complete days', () => {
  const partial = {
    ...night,
    id: 'partial',
    endTime: '2026-10-19T23:00:00+09:00',
    reportedSleepMs: hour,
  };
  const nap = {
    ...night,
    id: 'nap',
    startTime: '2026-10-19T12:00:00+09:00',
    endTime: '2026-10-19T13:00:00+09:00',
    reportedSleepMs: hour,
  };
  const previous = {
    ...night,
    id: 'previous',
    startTime: '2026-10-17T22:00:00+09:00',
    endTime: '2026-10-18T06:00:00+09:00',
  };
  expect(
    sleepSummaryByDay([night, partial, nap, previous], window),
  ).toMatchObject({
    value: 6 * hour,
    note: expect.stringContaining('확인 1일'),
  });
});
test('genuinely different overlapping records retain conservative unknown policy', () => {
  expect(
    sleepSummaryByDay(
      [night, { ...night, id: 'different', reportedSleepMs: 7 * hour }],
      window,
    ).value,
  ).toBeNull();
});
test('nonoverlapping records that merely touch remain separate wake dates', () => {
  const preceding = {
    ...night,
    id: 'preceding',
    startTime: '2026-10-19T21:00:00+09:00',
    endTime: night.startTime,
    reportedSleepMs: hour,
  };
  expect(sleepSummaryByDay([night, preceding], window)).toMatchObject({
    value: 3.5 * hour,
    note: expect.stringContaining('확인 2일'),
  });
});
