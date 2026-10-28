import type { HealthMetric, HealthProvider, ReadWindow } from './types';
import { emptyResult } from './catalog';
async function read(
  provider: HealthProvider,
  metric: HealthMetric,
  window: ReadWindow,
) {
  try {
    if ((await provider.checkAvailability()) !== 'available') {
      return emptyResult(metric, window, 'unavailable');
    }
    return await provider.readMetric(metric, window);
  } catch {
    return emptyResult(metric, window, 'error');
  }
}
export function createAndroidComposite(
  samsung: HealthProvider,
  healthConnect: HealthProvider,
): HealthProvider {
  return {
    platform: 'android',
    checkAvailability: async () => {
      const outcomes = await Promise.allSettled([
        samsung.checkAvailability(),
        healthConnect.checkAvailability(),
      ]);
      const statuses = outcomes.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (statuses.includes('available')) {
        return 'available';
      }
      if (statuses.includes('updateRequired')) {
        return 'updateRequired';
      }
      if (!statuses.length) {
        throw new Error('Health service check failed');
      }
      return 'unavailable';
    },
    requestReadAccess: async () => {
      const errors: unknown[] = [];
      for (const provider of [samsung, healthConnect]) {
        try {
          if ((await provider.checkAvailability()) === 'available') {
            await provider.requestReadAccess();
          }
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) {
        throw errors[0];
      }
    },
    readMetric: async (metric, window) => {
      const direct = await read(samsung, metric, window);
      if (direct.status !== 'empty' && direct.status !== 'unavailable') {
        return {
          ...direct,
          readRoute: 'samsungDirect',
          sourceMode:
            direct.status === 'ready' ? 'samsungDirect' : direct.sourceMode,
        };
      }
      return {
        ...(await read(healthConnect, metric, window)),
        readRoute: 'healthConnect',
        fallbackFrom: direct.status,
      };
    },
    openAccessSettings: healthConnect.openAccessSettings,
    openSamsungSettings: samsung.openAccessSettings,
    getDeviceInfo: healthConnect.getDeviceInfo,
  };
}
