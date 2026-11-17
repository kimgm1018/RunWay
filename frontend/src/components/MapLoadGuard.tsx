import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  authRetryDelayMs,
  getMapAuthState,
  liveMapCount,
  logMap,
  mapGone,
  mapMade,
  remakeStartDelayMs,
  reportMapLoaded,
  reportMapTimeout,
  retryMaps,
  scheduleMapCreate,
  subscribeMapAuth,
} from './naverMapAuth';
import { fontFamily, palette } from '../theme';

/**
 * S15P31E105-898: one NAVER map's life, watched so a blank map is made again or says so.
 *
 * Seen in the field: every map of a run blank, with no course lines either, which means the native maps never
 * said they were ready (onInitialized; the overlays wait for it, S15P31E105-692). So:
 * - each map logs when it is made, ready and drawn, with how many maps are alive;
 * - a map on screen that is not ready this long after it was made is made again (a new key), a few times with a
 *   growing pause, and then says it failed;
 * - a ready map that has not drawn its tiles this long later says it failed (a network failure at
 *   authorization; the SDK authorizes again when the connection comes back, and 다시 시도 makes it again);
 * - an auth failure from the SDK (401/429) shows on every map not yet drawn, and each of them is made again on its
 *   own after a growing pause jittered per map (authRetryDelayMs);
 * - a map made again first waits its own random 0–500 ms (remakeStartDelayMs), on top of the 150 ms spacing.
 * Android only: the load event (onMapLoaded) and the auth listener exist there.
 */
export const mapInitTimeoutMs = 5000;
export const mapLoadTimeoutMs = 12000;
/** Automatic remakes of a map that never says it is ready; the n-th waits n times this long first. */
export const mapAutoRemakes = 3;
export const mapRemakeGapMs = 1000;

// Read when used, so a test can play Android.
const watched = () => Platform.OS === 'android';

let nextGuardId = 1;

export type MapLoadGuard = {
  /** The map view's key: a new one makes the view again, which authorizes the key again. */
  attempt: number;
  /** Whether the map view may be made now (makes are spaced out, mapCreateGapMs). */
  created: boolean;
  failed: boolean;
  onInitialized: () => void;
  onMapLoaded: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  retry: () => void;
};

export function useMapLoadGuard(name: string): MapLoadGuard {
  const [id] = useState(() => nextGuardId++);
  const label = `map=${name}#${id}`;
  const [auth, setAuth] = useState(getMapAuthState);
  useEffect(() => subscribeMapAuth(setAuth), []);
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState(() => !watched());
  const [initialized, setInitialized] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [sized, setSized] = useState(false);
  const loadedRef = useRef(false);
  const createdAt = useRef(0);
  const remakes = useRef(0);
  const authRetries = useRef(0);

  const remake = useCallback(() => {
    setAttempt(value => value + 1);
    setCreated(!watched());
    setInitialized(false);
    setTimedOut(false);
  }, []);

  // Each attempt waits its turn to be made; a remade map first waits its own random start.
  useEffect(() => {
    if (!watched()) {
      return;
    }
    if (attempt === 0) {
      return scheduleMapCreate(() => setCreated(true));
    }
    let cancelCreate = () => {};
    const start = setTimeout(() => {
      cancelCreate = scheduleMapCreate(() => setCreated(true));
    }, remakeStartDelayMs());
    return () => {
      clearTimeout(start);
      cancelCreate();
    };
  }, [attempt]);

  // Made: counted among the live maps until it is remade or leaves.
  useEffect(() => {
    if (!created) {
      return;
    }
    createdAt.current = Date.now();
    const live = mapMade();
    if (watched()) {
      logMap(`made ${label} attempt=${attempt} live=${live}`, 'info');
    }
    return mapGone;
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, attempt]);

  // A retry anywhere makes this map again too, unless it already drew.
  const seenGeneration = useRef(auth.generation);
  useEffect(() => {
    if (auth.generation === seenGeneration.current) {
      return;
    }
    seenGeneration.current = auth.generation;
    if (!loadedRef.current) {
      remake();
    }
  }, [auth.generation, remake]);

  // The SDK refused the key: this map tries again on its own, each pause longer and drawn for this map alone.
  const authFailed = !!auth.failure;
  useEffect(() => {
    if (!watched() || !authFailed || loaded) {
      if (!authFailed) {
        authRetries.current = 0;
      }
      return;
    }
    const delay = authRetryDelayMs(authRetries.current);
    const timer = setTimeout(() => {
      authRetries.current += 1;
      logMap(
        `retry reason=auto ${label} retry=${authRetries.current} after=${delay}ms`,
      );
      remake();
    }, delay);
    return () => clearTimeout(timer);
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFailed, loaded, attempt, remake]);

  // On screen and made, but never ready: make it again a few times, then say so. A map out of sight (no size)
  // is not counted.
  useEffect(() => {
    if (!watched() || !created || !sized || initialized || loaded) {
      return;
    }
    let pause: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const again = remakes.current < mapAutoRemakes;
      logMap(
        `no ready signal ${label} attempt=${attempt} after=${mapInitTimeoutMs}ms live=${liveMapCount()} ${
          again
            ? `remake=${remakes.current + 1}/${mapAutoRemakes}`
            : 'giving up'
        }`,
      );
      if (again) {
        remakes.current += 1;
        pause = setTimeout(remake, mapRemakeGapMs * remakes.current);
      } else {
        setTimedOut(true);
      }
    }, mapInitTimeoutMs);
    return () => {
      clearTimeout(timer);
      if (pause) {
        clearTimeout(pause);
      }
    };
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, sized, initialized, loaded, attempt, remake]);

  // Ready but still blank: count down to calling it failed.
  useEffect(() => {
    if (!watched() || !initialized || !sized || loaded) {
      return;
    }
    const timer = setTimeout(() => {
      setTimedOut(true);
      reportMapTimeout(`${label} attempt=${attempt} live=${liveMapCount()}`);
    }, mapLoadTimeoutMs);
    return () => clearTimeout(timer);
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, sized, loaded, attempt]);

  const onInitialized = useCallback(() => {
    if (watched()) {
      logMap(
        `ready ${label} attempt=${attempt} +${
          Date.now() - createdAt.current
        }ms`,
        'info',
      );
    }
    setInitialized(true);
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const onMapLoaded = useCallback(() => {
    if (watched() && !loadedRef.current) {
      logMap(
        `drawn ${label} attempt=${attempt} +${
          Date.now() - createdAt.current
        }ms`,
        'info',
      );
    }
    loadedRef.current = true;
    remakes.current = 0;
    setLoaded(true);
    setTimedOut(false);
    reportMapLoaded();
    // label is fixed for this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSized(width > 0 && height > 0);
  }, []);
  const retry = useCallback(() => {
    remakes.current = 0;
    authRetries.current = 0;
    setTimedOut(false);
    // Every blank map is made again, this one with them.
    retryMaps('manual');
  }, []);

  return {
    attempt,
    created,
    failed: watched() && !loaded && (timedOut || !!auth.failure),
    onInitialized,
    onMapLoaded,
    onLayout,
    retry,
  };
}

/** Over a blank map: what happened and a way to try again. */
export function MapLoadFailure({
  onRetry,
  compact = false,
}: {
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <View style={styles.cover} testID="map-load-failure">
      <Text style={[styles.title, compact && styles.titleCompact]}>
        지도를 불러오지 못했어요
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="지도 다시 불러오기"
        hitSlop={8}
        onPress={onRetry}
        style={({ pressed }) => [
          styles.button,
          compact && styles.buttonCompact,
          pressed && styles.pressed,
        ]}
        testID="map-load-retry"
      >
        <Text style={[styles.buttonText, compact && styles.titleCompact]}>
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.paper,
    padding: 12,
  },
  title: {
    color: palette.sub,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    textAlign: 'center',
  },
  titleCompact: { fontSize: 12 },
  button: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: palette.ink,
  },
  buttonCompact: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonText: {
    color: palette.white,
    fontFamily: fontFamily.bold,
    fontSize: 14,
  },
  pressed: { opacity: 0.7 },
});
