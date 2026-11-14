import type { Repositories } from '../data/types';
import type { PushDevice } from './pushDevice';

type PushTokens = Pick<
  Repositories['notifications'],
  'registerPushToken' | 'unregisterPushToken'
>;

/** How long logging out waits for N04 and the token delete before it goes on (S15P31E105-815). */
export const RELEASE_TIMEOUT_MS = 3_000;

let stopActive: (() => void) | null = null;
// A release or forget still deleting this phone's token. The next registration waits for it, so a delete that ends
// late (after logout gave up waiting) cannot remove the token the next account just registered.
// Bounded, so a token read that never answers cannot hold registration until the app restarts.
let pendingDelete: Promise<void> = Promise.resolve();
export const PENDING_DELETE_WAIT_MS = 15_000;

const settleWithin = (work: Promise<void>, ms: number) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    work.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

const quietly = (work: () => Promise<unknown>) =>
  work().then(
    () => undefined,
    () => undefined,
  );

/**
 * While signed in (S15P31E105-815, ADR-0025): asks for the notification permission, then registers this phone's FCM
 * token with N03 and again whenever FCM rotates it. Refused permission registers nothing and removes a token an
 * earlier grant left on the server (N04), so a refused phone gets no push. Failures are silent: push is a
 * convenience on top of 2.9 알림, which keeps every notification either way.
 *
 * @returns stops listening for token changes (sign-out)
 */
export function startPushRegistration(
  device: PushDevice,
  api: PushTokens,
): () => void {
  if (!device.available()) {
    return () => undefined;
  }
  let active = true;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    active = false;
    unsubscribe?.();
    unsubscribe = null;
    if (stopActive === stop) {
      stopActive = null;
    }
  };
  stopActive?.();
  stopActive = stop;
  void (async () => {
    await pendingDelete;
    if (!active) {
      return;
    }
    let granted = false;
    try {
      granted = await device.requestPermission();
    } catch {
      granted = false;
    }
    if (!active) {
      return;
    }
    if (!granted) {
      await quietly(async () => {
        const token = await device.getToken();
        if (active) {
          await api.unregisterPushToken(token);
        }
      });
      return;
    }
    await quietly(async () => {
      const token = await device.getToken();
      if (active) {
        await api.registerPushToken(token);
      }
    });
    if (!active) {
      return;
    }
    unsubscribe = device.onTokenRefresh(token => {
      if (active) {
        void quietly(() => api.registerPushToken(token));
      }
    });
  })();
  return stop;
}

/**
 * Before logging out (S15P31E105-815): stops registration, removes this phone's token from the account (N04, still
 * with the access token) and deletes the token on the phone so a server row that N04 missed fails as UNREGISTERED and
 * is cleaned up on the next send. Never throws and gives up after {@link RELEASE_TIMEOUT_MS} so logout is not held.
 */
export async function releasePushToken(
  device: PushDevice,
  api: PushTokens,
  timeoutMs: number = RELEASE_TIMEOUT_MS,
): Promise<void> {
  stopActive?.();
  if (!device.available()) {
    return;
  }
  const release = (async () => {
    await quietly(async () =>
      api.unregisterPushToken(await device.getToken()),
    );
    await quietly(() => device.deleteToken());
  })();
  // Joined, not replaced: an expiry during this logout (N04 refused) must not drop the wait for this delete.
  pendingDelete = Promise.all([
    pendingDelete,
    settleWithin(release, PENDING_DELETE_WAIT_MS),
  ]).then(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([release, timeout]);
  clearTimeout(timer);
}

/**
 * When the session ends without a logout (expired login, 다시 로그인 before a run; S15P31E105-815): there is no access
 * token for N04, so only the phone's token is deleted. The server row then fails as UNREGISTERED and is removed on the
 * next send, and a signed-out phone stops showing the account's pushes. The next sign-in registers a new token.
 */
export function forgetPushToken(device: PushDevice): void {
  stopActive?.();
  if (!device.available()) {
    return;
  }
  pendingDelete = Promise.all([
    pendingDelete,
    settleWithin(
      quietly(() => device.deleteToken()),
      PENDING_DELETE_WAIT_MS,
    ),
  ]).then(() => undefined);
}
