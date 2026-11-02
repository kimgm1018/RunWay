import { useEffect } from 'react';
import { AppState } from 'react-native';
import { appConfig } from '../config';
import {
  resetWatchDailyHrUploadState,
  uploadWatchDailyHr,
} from './watchDailyHrUpload';

// The watch recomputes the estimate hourly; while the app stays open, check twice an hour.
export const uploadIntervalMs = 30 * 60 * 1000;

// Runs W06 uploads while signed in against the server: on sign-in, on returning to the foreground and periodically.
export function useWatchDailyHrUpload(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) {
      // Records skipped for the previous account must not be skipped for the next one.
      resetWatchDailyHrUploadState();
      return;
    }
    if (appConfig.dataSource !== 'api') {
      return;
    }
    const upload = () => {
      void uploadWatchDailyHr();
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
    }, uploadIntervalMs);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [signedIn]);
}
