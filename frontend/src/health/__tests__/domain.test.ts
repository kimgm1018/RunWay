import { makeReadWindow, overlaps } from '../time';
import { summarizeSleep } from '../sleep';
import { chooseRestingRecord } from '../selection';
import type { HealthRecord } from '../types';

const source = { id: 'com.sec.android.app.shealth', name: '삼성 헬스' };
const window = {
  start: '2026-10-19T15:00:00.000Z',
  end: '2026-10-20T01:00:00.000Z',
};
const sleep: HealthRecord = {
  id: 'sleep-1',
  metric: 'sleep',
  source,
  startTime: '2026-10-19T14:18:00.000Z',
  endTime: '2026-10-19T21:42:00.000Z',
  stages: [
    {
      startTime: '2026-10-19T14:18:00.000Z',
      endTime: '2026-10-19T21:42:00.000Z',
      stage: 'asleep',
    },
    {
      startTime: '2026-10-19T18:00:00.000Z',
      endTime: '2026-10-19T18:12:00.000Z',
      stage: 'awake',
    },
  ],
};

describe('health domain', () => {
  test('interval ending at midnight is excluded but an instant at midnight is included', () => {
    expect(overlaps('2026-10-19T14:00:00Z', window.start, window)).toBe(false);
    expect(overlaps(window.start, window.start, window)).toBe(true);
  });
  test('today and seven days use local calendar midnight, not a rolling 24 hours', () => {
    const now = new Date('2026-10-19T21:42:00.000Z');
    expect(makeReadWindow(1, now)).toEqual({
      start: '2026-10-19T15:00:00.000Z',
      end: '2026-10-19T21:42:00.000Z',
    });
    expect(makeReadWindow(7, now)).toEqual({
      start: '2026-10-13T15:00:00.000Z',
      end: '2026-10-19T21:42:00.000Z',
    });
  });
  test('overnight sleep keeps original session bounds and subtracts awake overlap', () => {
    expect(summarizeSleep([sleep], window)).toMatchObject({
      sessionMs: 26640000,
      asleepMs: 25920000,
      awakeMs: 720000,
    });
  });
  test('missing stages do not turn the whole session into actual sleep', () => {
    expect(summarizeSleep([{ ...sleep, stages: [] }], window)).toMatchObject({
      sessionMs: 26640000,
      asleepMs: null,
    });
  });
  test('duplicate sessions and overlapping sleep stages do not double count', () => {
    expect(
      summarizeSleep([sleep, { ...sleep, id: 'duplicate' }], window),
    ).toMatchObject({ sessionMs: 26640000, asleepMs: 25920000 });
  });
  test('partial stages keep actual total unknown and report only confirmed sleep', () => {
    const partial = {
      ...sleep,
      stages: [
        {
          startTime: sleep.startTime,
          endTime: '2026-10-19T15:18:00.000Z',
          stage: 'deep' as const,
        },
      ],
    };
    expect(summarizeSleep([partial], window)).toMatchObject({
      asleepMs: null,
      confirmedAsleepMs: 3600000,
    });
  });
  test('invalid and out-of-window sessions cannot change the summary', () => {
    const invalid = {
      ...sleep,
      startTime: sleep.endTime,
      endTime: sleep.startTime,
    };
    const future = {
      ...sleep,
      startTime: '2026-11-01T00:00:00Z',
      endTime: '2026-11-01T07:00:00Z',
    };
    expect(summarizeSleep([invalid, future], window)).toMatchObject({
      sessionMs: 0,
      asleepMs: null,
    });
  });
  test('inBed overlaps are not sleep and cannot double counted with asleep', () => {
    const bed = {
      ...sleep,
      stages: [
        {
          startTime: sleep.startTime,
          endTime: sleep.endTime,
          stage: 'inBed' as const,
        },
        ...sleep.stages!,
      ],
    };
    expect(summarizeSleep([bed], window).asleepMs).toBe(25920000);
  });
  test('resting heart rate selects latest valid record deterministically', () => {
    const base: HealthRecord = {
      id: 'a',
      metric: 'restingHeartRate',
      source,
      startTime: '2026-10-19T00:00:00Z',
      endTime: '2026-10-19T00:00:00Z',
      value: 58,
      unit: 'bpm',
    };
    const later = {
      ...base,
      id: 'b',
      startTime: '2026-10-20T00:00:00Z',
      endTime: '2026-10-20T00:00:00Z',
      value: 61,
    };
    expect(chooseRestingRecord([base, later])?.value).toBe(61);
    expect(chooseRestingRecord([{ ...later, value: NaN }, base])?.value).toBe(
      58,
    );
    expect(chooseRestingRecord([])).toBeNull();
  });
});
