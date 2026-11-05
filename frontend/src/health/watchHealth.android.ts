import { NativeModules } from 'react-native';
import type { HealthDataAccess } from '../data/types';
import { tokenStore } from '../data/api/tokenStore';
import type { WatchDailyHr } from './watchHealth';

export type { WatchDailyHr } from './watchHealth';

type NativeWatchHealth = {
  prepareAccount(userId: string): Promise<boolean>;
  setHealthConsent(
    access: HealthDataAccess,
    userId: string | null,
  ): Promise<void>;
  republishConsent(): Promise<void>;
  getDailyHr(userId: string): Promise<WatchDailyHr[]>;
  markUploaded(
    date: string,
    revision: number,
    collectionId: string,
  ): Promise<void>;
  markRejected(
    date: string,
    revision: number,
    collectionId: string,
  ): Promise<void>;
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

function owner(): string | null {
  const userId = tokenStore.current()?.userId;
  return Number.isSafeInteger(userId) && userId! > 0 ? String(userId) : null;
}

// Bind before reading or granting consent. A missing/older bridge fails closed.
async function prepare(): Promise<string | null> {
  const userId = owner();
  const session = tokenStore.session();
  if (!userId) return null;
  const ready = await quietly(module => module.prepareAccount(userId), false);
  return ready && tokenStore.session() === session && owner() === userId
    ? userId
    : null;
}

export async function setWatchHealthConsent(
  access: HealthDataAccess,
): Promise<void> {
  const userId = access === 'AGREEE' ? await prepare() : owner();
  if (access === 'AGREEE' && !userId) return;
  await quietly(module => module.setHealthConsent(access, userId), undefined);
}

// Pushes the server's consent when known; otherwise re-sends the saved one only if its last delivery failed.
export async function refreshWatchHealthConsent(
  readServerConsent?: () => Promise<HealthDataAccess | null>,
): Promise<void> {
  const session = tokenStore.session();
  if (readServerConsent && !(await prepare())) return;
  let access: HealthDataAccess | null = null;
  try {
    access = (await readServerConsent?.()) ?? null;
  } catch {
    access = null;
  }
  if (tokenStore.session() !== session) return;
  if (access) {
    await setWatchHealthConsent(access);
    return;
  }
  await quietly(module => module.republishConsent(), undefined);
}

export async function readWatchDailyHr(): Promise<WatchDailyHr[]> {
  const userId = await prepare();
  return userId ? quietly(module => module.getDailyHr(userId), []) : [];
}

export async function markWatchDailyHrUploaded(
  date: string,
  revision: number,
  collectionId?: string,
): Promise<void> {
  if (!collectionId) return;
  await quietly(
    module => module.markUploaded(date, revision, collectionId),
    undefined,
  );
}

export async function markWatchDailyHrRejected(
  date: string,
  revision: number,
  collectionId?: string,
): Promise<void> {
  if (!collectionId) return;
  await quietly(
    module => module.markRejected(date, revision, collectionId),
    undefined,
  );
}
