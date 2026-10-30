import type { HealthDataAccess } from '../data/types';

export type WatchDailyHr = {
  metricDate: string;
  revision: number;
  estimatedRestingHrBpm: number;
  validSampleCount: number;
  computedAt: string;
  uploaded: boolean;
};

// iOS and other platforms have no watch daily heart-rate bridge.
export async function setWatchHealthConsent(
  _access: HealthDataAccess,
): Promise<void> {}

export async function refreshWatchHealthConsent(
  _readServerConsent?: () => Promise<HealthDataAccess | null>,
): Promise<void> {}

export async function readWatchDailyHr(): Promise<WatchDailyHr[]> {
  return [];
}

export async function markWatchDailyHrUploaded(
  _date: string,
  _revision: number,
): Promise<void> {}
