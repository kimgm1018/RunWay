import type { ReadWindow } from './types';

export function makeReadWindow(days: 1 | 7, now: Date): ReadWindow {
  if (![1, 7].includes(days) || !Number.isFinite(now.getTime())) {
    throw new Error('Invalid read period');
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return { start: start.toISOString(), end: now.toISOString() };
}

export function overlaps(
  start: string,
  end: string,
  window: ReadWindow,
): boolean {
  const a = Date.parse(start);
  const b = Date.parse(end);
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    b >= a &&
    a < Date.parse(window.end) &&
    (a === b ? b >= Date.parse(window.start) : b > Date.parse(window.start))
  );
}
