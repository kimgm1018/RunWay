import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

/**
 * S15P31E105-898: whether the NAVER map could authorize, shared by every map on screen.
 *
 * The SDK authorizes once per map view when the view is made. If that fails (401 refused key, 429 quota, or no
 * network at the time) the map stays blank and the SDK does not try again by itself until the connection changes.
 * A new map view authorizes again, so a retry makes the map view again (MapLoadGuard). After an auth failure each
 * map that has not loaded retries on its own with a growing, jittered pause (authRetryDelayMs); 다시 시도 and the
 * app coming back to the front bump `generation`, which makes every such map again at once (each after its own
 * short random start, remakeStartDelayMs). A loaded map ends the failure.
 */

export type MapFailureCode = '401' | '429' | string;

export type MapAuthState = {
  /** The last failure not yet followed by a loaded map. */
  failure: { code: MapFailureCode; at: number } | null;
  /** Bumped on every retry; maps that have not loaded are made again. */
  generation: number;
};

type Native = {
  lastFailure?: () => Promise<{ code?: string; at?: number } | null>;
  clear?: () => void;
  log?: (level: string, message: string) => void;
};

// Read when used, so a test can stand in for the native module and the platform.
function getNative(): Native | undefined {
  return Platform.OS === 'android'
    ? NativeModules.RunwayNaverMapAuth
    : undefined;
}

/**
 * Pauses between one map's automatic retries after an auth failure; the last one repeats. Each pause is drawn
 * again for every map and every retry within ±20% (capped at 30 s), so the maps of one screen, and the phones of
 * a room, do not ask the SDK's auth server at the same instant: a 429 is a rate limit, and requests that arrive
 * together are what trips it. The first pause is short so a blip during a demo heals before anyone notices.
 */
export const retryDelaysMs = [3000, 6000, 12000, 24000, 30000];
export const retryJitter = 0.2;
export const retryCapMs = 30000;
/** A map made again waits a random part of this first, so the maps of one screen are not made in one burst. */
export const remakeStartMaxMs = 500;

/** Random numbers in [0, 1) for the jitter; a test can fix them. */
let random: () => number = Math.random;

export function setMapRandom(next: () => number) {
  random = next;
}

export function mapRandom() {
  return random();
}

/** The pause before a map's `retry`-th automatic retry (0 first), jittered by `r` in [0, 1). */
export function authRetryDelayMs(retry: number, r: number = random()) {
  const base = retryDelaysMs[Math.min(retry, retryDelaysMs.length - 1)];
  const jittered = base * (1 - retryJitter + 2 * retryJitter * r);
  return Math.round(Math.min(retryCapMs, jittered));
}

/** How long a map made again waits first, by `r` in [0, 1). */
export function remakeStartDelayMs(r: number = random()) {
  return Math.round(remakeStartMaxMs * r);
}

let state: MapAuthState = { failure: null, generation: 0 };
const listeners = new Set<(next: MapAuthState) => void>();
let started = false;

function set(next: MapAuthState) {
  state = next;
  listeners.forEach(listener => listener(state));
}

/**
 * The map's reports, in logcat under RunwayNaverMapAuth (Android) and in the JS console. `info` lines are the
 * timeline of each map (made, ready, drawn); `warn` lines are the problems.
 */
export function logMap(message: string, level: 'info' | 'warn' = 'warn') {
  const line = `[NaverMap] ${message}`;
  if (level === 'warn') {
    console.warn(line);
  }
  getNative()?.log?.(level, line);
}

// The maps alive now, for the logs: the field log showed two maps made 2 ms apart in the run whose maps all
// stayed blank (S15P31E105-898).
let liveMaps = 0;

export function mapMade() {
  liveMaps += 1;
  return liveMaps;
}

export function mapGone() {
  liveMaps = Math.max(0, liveMaps - 1);
}

export function liveMapCount() {
  return liveMaps;
}

/**
 * Space out the making of maps: each new map view is made at least this long after the one before (Android). A
 * screen of cards (the feed, saved courses, records) made several in the same frame; the SDK is not known to
 * handle that well, and a short gap costs a list only a beat per card.
 */
export const mapCreateGapMs = 150;
let nextCreateAt = 0;

/** Calls `create` when this map may be made; returns a cancel for a map that leaves first. */
export function scheduleMapCreate(create: () => void): () => void {
  const now = Date.now();
  const at = Math.max(now, nextCreateAt);
  nextCreateAt = at + mapCreateGapMs;
  if (at === now) {
    create();
    return () => {};
  }
  const timer = setTimeout(create, at - now);
  return () => clearTimeout(timer);
}

/** The SDK refused to authorize the key (401, 429, ...): every map that has not loaded shows it and retries. */
export function reportMapFailure(code: MapFailureCode, detail = '') {
  logMap(
    `auth failed code=${code}${detail ? ` ${detail}` : ''} live=${liveMaps}`,
  );
  set({ ...state, failure: { code, at: Date.now() } });
}

/**
 * One map has not drawn its tiles in time, which is what a network failure at authorization looks like (the SDK
 * gives no callback for it). Only that map shows it: a map that is just slow, or kept out of sight, loads on its
 * own, and the SDK authorizes again when the connection comes back.
 */
export function reportMapTimeout(detail: string) {
  logMap(`load timeout code=network ${detail}`);
}

/** Make every map that has not loaded again, which authorizes the key again. */
export function retryMaps(reason: 'manual' | 'foreground') {
  logMap(
    `retry reason=${reason} last=${state.failure?.code ?? 'none'} attempt=${
      state.generation + 1
    }`,
  );
  set({ ...state, generation: state.generation + 1 });
}

/** A map drew its tiles: whatever failed before is over. */
export function reportMapLoaded() {
  if (state.failure) {
    logMap(`recovered after code=${state.failure.code}`);
    getNative()?.clear?.();
    set({ ...state, failure: null });
  }
}

export function getMapAuthState() {
  return state;
}

export function subscribeMapAuth(listener: (next: MapAuthState) => void) {
  startMapAuthWatch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Listen to the SDK's auth failures (Android); safe to call more than once. */
export function startMapAuthWatch() {
  const native = getNative();
  if (started || !native) {
    return;
  }
  started = true;
  try {
    const emitter = new NativeEventEmitter(NativeModules.RunwayNaverMapAuth);
    emitter.addListener('RunwayNaverMapAuthFailed', event =>
      reportMapFailure(String(event?.code ?? 'unknown'), 'source=sdk'),
    );
    // A failure from before JS listened: the first maps can be made before this runs.
    native
      .lastFailure?.()
      .then(failure => {
        if (failure?.code && !state.failure) {
          reportMapFailure(String(failure.code), 'source=sdk-early');
        }
      })
      .catch(() => {});
    AppState.addEventListener('change', next => {
      if (next === 'active' && state.failure) {
        retryMaps('foreground');
      }
    });
  } catch {
    // Without the native module the load timeout still finds a blank map.
  }
}

/** Tests only. */
export function resetMapAuthForTests() {
  random = Math.random;
  state = { failure: null, generation: 0 };
  listeners.clear();
  liveMaps = 0;
  nextCreateAt = 0;
}
