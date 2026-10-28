import type { HealthRecord } from './types';

export function chooseRestingRecord(
  records: HealthRecord[],
): HealthRecord | null {
  return (
    records
      .filter(
        r =>
          r.metric === 'restingHeartRate' &&
          Number.isFinite(r.value) &&
          r.value! > 0 &&
          Number.isFinite(Date.parse(r.startTime)),
      )
      .sort(
        (a, b) =>
          Date.parse(b.startTime) - Date.parse(a.startTime) ||
          a.source.id.localeCompare(b.source.id) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}
