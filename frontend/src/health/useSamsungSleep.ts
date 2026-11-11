import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { appConfig } from '../config';
import { apiRequest } from '../data/api/http';
import { tokenStore } from '../data/api/tokenStore';
import {
  checkSleepAccess,
  readTodaySleep,
  resetSleepUploads,
  type SleepAccess,
  type SleepNative,
  type SleepSyncResponse,
  type SleepUploadDeps,
  type TodaySleep,
} from './samsungSleep';
import { samsungSleepNative } from './samsungSleepNative';
import {
  checkHeartRateAccess,
  readTodayRestingHr,
  requestSamsungAccess,
  type SamsungAccessRequest,
  type TodayRestingHr,
} from './samsungRestingHr';
import {
  requestSamsungHealthAccess,
  samsungHeartNative,
} from './samsungRestingHrNative';
import { readServerHealthConsent } from './serverHealthConsent';
import {
  checkExerciseAccess,
  exerciseAccessNative,
  resetExerciseUploads,
  uploadSamsungHealth,
  type ExerciseNative,
  type ExerciseUploadDeps,
} from './samsungExerciseLoad';
import { samsungExerciseNative } from './samsungExerciseNative';
import { healthRecordsUploaded } from './healthRecordsUploaded';

export const sleepUploadIntervalMs = 30 * 60 * 1000;

export function sleepUploadDeps(
  native: SleepNative = samsungSleepNative,
  heart: SleepNative = samsungHeartNative,
): SleepUploadDeps {
  return {
    native,
    heart,
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

// S15P31E105-599: the exercise heart rate summaries go through the same W06 client, consent and session checks.
export function exerciseUploadDeps(
  native: ExerciseNative = samsungExerciseNative,
): ExerciseUploadDeps {
  const { consent, sessionKey, owner, now, wait } = sleepUploadDeps();
  return {
    native,
    consent,
    sessionKey,
    owner,
    now,
    wait,
    send: body =>
      apiRequest<SleepSyncResponse>('/health-records/sync', {
        method: 'POST',
        body,
      }),
  };
}

// S15P31E105-675: the W06 uploads of Samsung Health, telling 2.1 to read today's readiness again once a request of this
// run stored at least one new record (accepted). Nothing new, a failure or a run joined from another caller says nothing.
export async function uploadSamsungHealthRecords(
  native: SleepNative = samsungSleepNative,
  heart: SleepNative = samsungHeartNative,
  exercise: ExerciseNative = samsungExerciseNative,
) {
  let accepted = false;
  const counted = <
    T extends { send: (body: never) => Promise<SleepSyncResponse> },
  >(
    deps: T,
  ): T => ({
    ...deps,
    send: (async (body: Parameters<T['send']>[0]) => {
      const response = await deps.send(body);
      if ((response?.acceptedCount ?? 0) > 0) {
        accepted = true;
      }
      return response;
    }) as T['send'],
  });
  try {
    return await uploadSamsungHealth(
      counted(sleepUploadDeps(native, heart)),
      counted(exerciseUploadDeps(exercise)),
    );
  } finally {
    if (accepted) {
      healthRecordsUploaded();
    }
  }
}

// S15P31E105-572·600: Samsung Health sleep and the phone's resting heart rate go to W06 in one request while signed in
// against the server: on sign-in, on returning to the foreground and every 30 minutes. S15P31E105-599: the exercise
// heart rate summaries follow right after, never at the same time. Signing out clears the sent marks so the next
// account sends its own.
export function useSamsungSleepUpload(
  signedIn: boolean,
  native: SleepNative = samsungSleepNative,
  heart: SleepNative = samsungHeartNative,
  exercise: ExerciseNative = samsungExerciseNative,
) {
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (!signedIn) {
      // Only an actual sign-out clears them; a cold start before the session is restored keeps them.
      if (wasSignedIn.current) {
        void resetSleepUploads(native);
        void resetSleepUploads(heart);
        void resetExerciseUploads(exercise);
      }
      wasSignedIn.current = false;
      return;
    }
    wasSignedIn.current = true;
    if (appConfig.dataSource !== 'api') {
      return;
    }
    const upload = () => {
      void uploadSamsungHealthRecords(native, heart, exercise);
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
  }, [signedIn, native, heart, exercise]);
}

export type SamsungSleepView = {
  access: SleepAccess | null;
  today: TodaySleep | null;
  // S15P31E105-600: heart rate read access and today's resting heart rate computed on this phone.
  heartAccess: SleepAccess | null;
  todayRestingHr: TodayRestingHr | null;
  // S15P31E105-599: exercise read access for the training load.
  exerciseAccess: SleepAccess | null;
  requesting: boolean;
  request: () => Promise<void>;
  refresh: () => Promise<void>;
};

// Sleep and heart rate access, today's phone sleep and resting heart rate for 2.1 and settings. Re-checked when the app
// returns to the foreground, so granting in Samsung Health and coming back shows the new state. `request` asks for both
// in one dialog (D-8), together with exercise for the training load (S15P31E105-599).
export function useSamsungSleep(
  native: SleepNative = samsungSleepNative,
  now: () => Date = () => new Date(),
  heart: SleepNative = samsungHeartNative,
  requestBoth: SamsungAccessRequest = requestSamsungHealthAccess,
  exercise: ExerciseNative = samsungExerciseNative,
): SamsungSleepView {
  const [access, setAccess] = useState<SleepAccess | null>(null);
  const [today, setToday] = useState<TodaySleep | null>(null);
  const [heartAccess, setHeartAccess] = useState<SleepAccess | null>(null);
  const [todayRestingHr, setTodayRestingHr] = useState<TodayRestingHr | null>(
    null,
  );
  const [exerciseAccess, setExerciseAccess] = useState<SleepAccess | null>(
    null,
  );
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
    const nextHeart = await checkHeartRateAccess(heart);
    const restingHr: TodayRestingHr =
      nextHeart === 'granted'
        ? await readTodayRestingHr(heart, nowRef.current())
        : {
            status:
              nextHeart === 'unavailable' ? 'unavailable' : 'accessRequired',
          };
    const nextExercise = await checkExerciseAccess(exercise);
    if (mounted.current) {
      setAccess(next);
      setToday(sleep);
      setHeartAccess(nextHeart);
      setTodayRestingHr(restingHr);
      setExerciseAccess(nextExercise);
    }
  }, [native, heart, exercise]);

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
      const next = await requestSamsungAccess(
        native,
        heart,
        requestBoth,
        exerciseAccessNative(exercise),
      );
      if (mounted.current) {
        setAccess(next.sleep);
        setHeartAccess(next.heartRate);
        setExerciseAccess(next.exercise ?? null);
      }
      await refresh();
      if (
        (next.sleep === 'granted' ||
          next.heartRate === 'granted' ||
          next.exercise === 'granted') &&
        appConfig.dataSource === 'api'
      ) {
        void uploadSamsungHealthRecords(native, heart, exercise);
      }
    } finally {
      if (mounted.current) {
        setRequesting(false);
      }
    }
  }, [native, heart, requestBoth, exercise, refresh]);

  return {
    access,
    today,
    heartAccess,
    todayRestingHr,
    exerciseAccess,
    requesting,
    request,
    refresh,
  };
}
