import { formatRecordPace } from '../src/format';

// S15P31E105-834: a run with no distance has no average pace, and the server sends 0 for it.
// Shown as 0′00″ it reads as a real pace, so it is shown as not measured instead (as on the run result).
test('a real average pace keeps its figure', () => {
  expect(formatRecordPace(357.5)).toBe('5′58″');
  expect(formatRecordPace(360)).toBe('6′00″');
});

test('no distance, no pace: 0 or a missing pace is not measured', () => {
  expect(formatRecordPace(0)).toBeNull();
  expect(formatRecordPace(null)).toBeNull();
  expect(formatRecordPace(undefined)).toBeNull();
  expect(formatRecordPace(Number.NaN)).toBeNull();
  expect(formatRecordPace(Number.POSITIVE_INFINITY)).toBeNull();
  expect(formatRecordPace(-1)).toBeNull();
});
