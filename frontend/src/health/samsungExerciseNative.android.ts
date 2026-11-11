import { NativeModules } from 'react-native';
import type { NativeSleepAccess } from './samsungSleep';
import type {
  ExerciseHeartRate,
  ExerciseNative,
} from './samsungExerciseLoad';

// S15P31E105-599: exercise heart rate calls on the SamsungHealth native module (SamsungHealthModule.kt). Access is
// asked in the combined dialog (requestSamsungHealthAccess).
type NativeSamsungExercise = {
  exerciseAccessStatus(): Promise<NativeSleepAccess>;
  readExerciseHeartRate(
    start: string,
    end: string,
  ): Promise<ExerciseHeartRate[]>;
  loadExerciseLoadState(): Promise<string | null>;
  saveExerciseLoadState(json: string | null): Promise<boolean>;
};

const native = NativeModules.SamsungHealth as NativeSamsungExercise | undefined;

function required(): NativeSamsungExercise {
  if (!native) {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  }
  return native;
}

export const samsungExerciseNative: ExerciseNative = {
  status: async () => (native ? native.exerciseAccessStatus() : 'unavailable'),
  read: window => required().readExerciseHeartRate(window.start, window.end),
  loadState: async () => (native ? native.loadExerciseLoadState() : null),
  saveState: json => required().saveExerciseLoadState(json),
};
