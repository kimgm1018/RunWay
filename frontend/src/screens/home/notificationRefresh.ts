import { AppState, type AppStateStatus } from 'react-native';

import type { AppNotification } from '../../data/types';

/** S15P31E105-801: how often 2.1 reads the inbox again while it stays on screen in the foreground. */
export const NOTIFICATION_REFRESH_MS = 60_000;

/**
 * While 2.1 is focused: reads the inbox again the moment the app comes back to the foreground, and every
 * {@link NOTIFICATION_REFRESH_MS} while it stays there. The timer only runs while the app is active, so nothing is
 * read in the background and coming back does not fire twice. Returns the function that stops it (on blur).
 */
export function startNotificationRefresh(
  refresh: () => void,
  intervalMs: number = NOTIFICATION_REFRESH_MS,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const startTimer = () => {
    if (timer === null) {
      timer = setInterval(refresh, intervalMs);
    }
  };
  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  let previous: AppStateStatus = AppState.currentState;
  if (previous === 'active') {
    startTimer();
  }
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') {
      if (previous !== 'active') {
        refresh();
      }
      startTimer();
    } else {
      stopTimer();
    }
    previous = state;
  });
  return () => {
    stopTimer();
    subscription.remove();
  };
}

/**
 * S15P31E105-801: the newest server id among the rows 2.9 loaded, sent as N02 `upToId` when leaving so a row that
 * arrived meanwhile stays unread. `undefined` when no row has a numeric id (an empty list, or mock rows).
 */
export function newestNotificationId(
  items: readonly Pick<AppNotification, 'id'>[] | null | undefined,
): number | undefined {
  let newest: number | undefined;
  for (const item of items ?? []) {
    const id = Number(item.id);
    if (Number.isSafeInteger(id) && id > 0 && (newest === undefined || id > newest)) {
      newest = id;
    }
  }
  return newest;
}

/** The larger of two optional ids; `undefined` only when both are. */
export function newerId(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  return b === undefined || a >= b ? a : b;
}

const pushListeners = new Set<() => void>();

/**
 * S15P31E105-815: a device push arrived while the app was in the foreground. FCM shows nothing then, so 2.1 reads
 * the inbox again and the bell's dot follows at once instead of at the next minute.
 */
export function notifyPushReceived(): void {
  pushListeners.forEach(listener => listener());
}

/** @returns stops listening */
export function onPushReceived(listener: () => void): () => void {
  pushListeners.add(listener);
  return () => {
    pushListeners.delete(listener);
  };
}
