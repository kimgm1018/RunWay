// Cached "who am I" state from createCrewsApi (U04 myId). SessionProvider clears it on
// logout and expiry so the next login cannot reuse the previous account (S15P31E105-638).

let clearer: (() => void) | null = null;

export function registerApiIdentityCacheClear(clear: () => void) {
  clearer = clear;
}

export function clearApiIdentityCache() {
  clearer?.();
}
