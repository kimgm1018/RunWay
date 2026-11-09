import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { appConfig } from '../config';
import { apiRequest } from '../data/api/http';
import { tokenStore } from '../data/api/tokenStore';
import {
  checkSleepAccess,
  readTodaySleep,
  requestSleepAccess,
  resetSleepUploads,
  uploadSamsungSleep,
  type SleepAccess,
  type SleepNative,
  type SleepSyncResponse,
  type SleepUploadDeps,
  type TodaySleep,
} from './samsungSleep';
import { samsungSleepNative } from './samsungSleepNative';
import { readServerHealthConsent } from './serverHealthConsent';

export const sleepUploadIntervalMs = 30 * 60 * 1000;

export function sleepUploadDeps(
  native: SleepNative = samsungSleepNative,
): SleepUploadDeps {
  return {
    native,
    send: body =>
      apiRequest<SleepSyncResponse>('/health-records/sync', {
        method: 'POST',
        body,
      }),
    consent: () => readServerHealthConsent(),
    sessionKey: () =>
      tokenStore.current() ? String(tokenStore.session()) : undefined,
    owner: () => {
      const userId = tokenStore.current()?.userId;
      return userId === undefined ? undefined : String(userId);
    },
    now: () => new Date(),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

// S15P31E105-572: Samsung Health sleep goes to W06 while signed in against the server: on sign-in, on returning to the
// foreground and every 30 minutes. Signing out clears the sent marks so the next account sends its own.
export function useSamsungSleepUpload(
  signedIn: boolean,
  native: SleepNative = samsungSleepNative,
) {
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (!signedIn) {
      // Only an actual sign-out clears them; a cold start before the session is restored keeps them.
      if (wasSignedIn.current) {
        void resetSleepUploads(native);
      }
      wasSignedIn.current = false;
      return;
    }
    wasSignedIn.current = true;
    if (appConfig.dataSource !== 'api') {
      return;
    }
    const upload = () => {
      void uploadSamsungSleep(sleepUploadDeps(native));
    };
    upload();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') {
        upload();
      }
      previous = next;
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        upload();
      }
    }, sleepUploadIntervalMs);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [signedIn, native]);
}

export type SamsungSleepView = {
  access: SleepAccess | null;
  today: TodaySleep | null;
  requesting: boolean;
  request: () => Promise<void>;
  refresh: () => Promise<void>;
};

// Sleep access and today's phone sleep for 2.1 and settings. Re-checked when the app returns to the foreground,
// so granting in Samsung Health and coming back shows the new state.
export function useSamsungSleep(
  native: SleepNative = samsungSleepNative,
  now: () => Date = () => new Date(),
): SamsungSleepView {
  const [access, setAccess] = useState<SleepAccess | null>(null);
  const [today, setToday] = useState<TodaySleep | null>(null);
  const [requesting, setRequesting] = useState(false);
  const mounted = useRef(true);
  const nowRef = useRef(now);
  nowRef.current = now;

  const refresh = useCallback(async () => {
    const next = await checkSleepAccess(native);
    const sleep: TodaySleep =
      next === 'granted'
        ? await readTodaySleep(native, nowRef.current())
        : { status: next === 'unavailable' ? 'unavailable' : 'accessRequired' };
    if (mounted.current) {
      setAccess(next);
      setToday(sleep);
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') {
        void refresh();
      }
      previous = next;
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [refresh]);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestSleepAccess(native);
      if (mounted.current) {
        setAccess(next);
      }
      await refresh();
      if (next === 'granted' && appConfig.dataSource === 'api') {
        void uploadSamsungSleep(sleepUploadDeps(native));
      }
    } finally {
      if (mounted.current) {
        setRequesting(false);
      }
    }
  }, [native, refresh]);

  return { access, today, requesting, request, refresh };
}
