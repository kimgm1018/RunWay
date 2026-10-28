import * as HK from '@kingstinct/react-native-healthkit';
import DeviceInfo from 'react-native-device-info';
import { Linking } from 'react-native';
import { createIosReader, type IosSample } from './iosReader';
import type { SleepStage } from './types';

const quantityTypes = {
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  restingHeartRate: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  steps: 'HKQuantityTypeIdentifierStepCount',
  distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
} as const;
const identifiers = {
  ...quantityTypes,
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  exercise: 'HKWorkoutTypeIdentifier',
} as const;
const units = {
  heartRate: 'count/min',
  restingHeartRate: 'count/min',
  hrv: 'ms',
  steps: 'count',
  distance: 'm',
} as const;
const stages: Record<number, SleepStage['stage']> = {
  0: 'inBed',
  1: 'asleep',
  2: 'awake',
  3: 'light',
  4: 'deep',
  5: 'rem',
};
type SampleBase = {
  uuid: string;
  startDate: Date;
  endDate: Date;
  sourceRevision: { source: { bundleIdentifier: string; name: string } };
  metadata?: Record<string, unknown>;
};
function base(s: SampleBase): IosSample {
  return {
    id: s.uuid,
    startTime: s.startDate.toISOString(),
    endTime: s.endDate.toISOString(),
    source: {
      id: s.sourceRevision.source.bundleIdentifier,
      name: s.sourceRevision.source.name,
    },
    manuallyEntered: s.metadata?.HKWasUserEntered === true,
  };
}
export const provider = createIosReader({
  available: async () => HK.isHealthDataAvailable(),
  typeAvailable: metric => HK.isObjectTypeAvailable(identifiers[metric]),
  request: async () => {
    const completed = await HK.requestAuthorization({
      toRead: Object.values(identifiers).filter(id =>
        HK.isObjectTypeAvailable(id),
      ),
      toShare: [],
    });
    if (!completed) {
      throw new Error('Authorization did not complete');
    }
  },
  read: async (metric, window) => {
    const options = {
      limit: 0,
      ascending: false,
      filter: {
        date: {
          startDate: new Date(window.start),
          endDate: new Date(window.end),
        },
      },
    };
    if (metric === 'sleep') {
      const samples = await HK.queryCategorySamples(identifiers.sleep, {
        ...options,
        filter: {
          date: {
            ...options.filter.date,
            startDate: new Date(Date.parse(window.start) - 36 * 60 * 60 * 1000),
          },
        },
      });
      return samples.map(s => ({
        ...base(s),
        stages: [
          {
            startTime: s.startDate.toISOString(),
            endTime: s.endDate.toISOString(),
            stage: stages[s.value] ?? 'unknown',
          },
        ],
      }));
    }
    if (metric === 'exercise') {
      const proxies = await HK.queryWorkoutSamples(options);
      try {
        return proxies.map(proxy => {
          const s = proxy.toJSON();
          return {
            ...base(s),
            details: `운동 유형 ${s.workoutActivityType} · ${Math.round(
              s.duration.quantity,
            )} ${s.duration.unit}${
              s.totalDistance
                ? ` · ${s.totalDistance.quantity} ${s.totalDistance.unit}`
                : ''
            }`,
          };
        });
      } finally {
        proxies.forEach(proxy => proxy.dispose());
      }
    }
    const key = metric as keyof typeof quantityTypes;
    const samples = await HK.queryQuantitySamples(quantityTypes[key], {
      ...options,
      unit: units[key],
    });
    return samples.map(s => ({ ...base(s), value: s.quantity }));
  },
  aggregate: async (metric, window) => {
    const result = await HK.queryStatisticsForQuantity(
      quantityTypes[metric],
      ['cumulativeSum'],
      {
        unit: units[metric],
        filter: {
          date: {
            startDate: new Date(window.start),
            endDate: new Date(window.end),
          },
        },
      },
    );
    return result.sumQuantity?.quantity ?? null;
  },
  openSettings: async () => {
    await Linking.openSettings();
  },
  device: async () => ({
    os: 'iOS',
    manufacturer: 'Apple',
    model: DeviceInfo.getModel(),
    version: DeviceInfo.getSystemVersion(),
  }),
});
