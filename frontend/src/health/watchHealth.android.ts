import { NativeModules } from 'react-native';
import type { HealthDataAccess } from '../data/types';
import type { WatchDailyHr } from './watchHealth';

export type { WatchDailyHr } from './watchHealth';

type NativeWatchHealth = {
  setHealthConsent(access: HealthDataAccess): Promise<void>;
  republishConsent(): Promise<void>;
  getDailyHr(): Promise<WatchDailyHr[]>;
  markUploaded(date: string, revision: number): Promise<void>;
};

// Read per call so a missing module (tests, unsupported builds) is a quiet no-op.
function native() {
  return NativeModules.WatchHealth as NativeWatchHealth | undefined;
}

// Native failures (WATCH_UNAVAILABLE etc.) must never reach the UI.
async function quietly<T>(
  run: (module: NativeWatchHealth) => Promise<T>,
  fallback: T,
): Promise<T> {
  const module = native();
  if (!module) {
    return fallback;
  }
  try {
    return await run(module);
  } catch {
    return fallback;
  }
}

export async function setWatchHealthConsent(
  access: HealthDataAccess,
): Promise<void> {
  await quietly(module => module.setHealthConsent(access), undefined);
}

// Pushes the server's consent when known; otherwise re-sends the saved one only if its last delivery failed.
export async function refreshWatchHealthConsent(
  readServerConsent?: () => Promise<HealthDataAccess | null>,
): Promise<void> {
  let access: HealthDataAccess | null = null;
  try {
    access = (await readServerConsent?.()) ?? null;
  } catch {
    access = null;
  }
  if (access) {
    await setWatchHealthConsent(access);
    return;
  }
  await quietly(module => module.republishConsent(), undefined);
}

export async function readWatchDailyHr(): Promise<WatchDailyHr[]> {
  return quietly(module => module.getDailyHr(), []);
}

export async function markWatchDailyHrUploaded(
  date: string,
  revision: number,
): Promise<void> {
  await quietly(module => module.markUploaded(date, revision), undefined);
}
