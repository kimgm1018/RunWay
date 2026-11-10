import type { ExerciseNative } from './samsungExerciseLoad';

// Samsung Health exists only on Android (samsungExerciseNative.android.ts). Elsewhere exercise access is unavailable.
export const samsungExerciseNative: ExerciseNative = {
  status: async () => 'unavailable',
  read: async () => {
    throw { code: 'SAMSUNG_UNAVAILABLE' };
  },
  loadState: async () => null,
  saveState: async () => false,
};
