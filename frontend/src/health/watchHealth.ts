import type { HealthDataAccess } from '../data/types';

export type WatchDailyHr = {
  collectionId?: string;
  metricDate: string;
  revision: number;
  estimatedRestingHrBpm: number;
  method: string;
  validSampleCount: number;
  computedAt: string;
  uploaded: boolean;
  // W06 rejected this revision; it is not sent again (a newer revision is).
  rejected: boolean;
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
  _collectionId?: string,
): Promise<void> {}

export async function markWatchDailyHrRejected(
  _date: string,
  _revision: number,
  _collectionId?: string,
): Promise<void> {}
