import type { HealthProvider } from './types';
import { emptyResult } from './catalog';
export const provider: HealthProvider = {
  platform: 'unsupported',
  checkAvailability: async () => 'unavailable',
  requestReadAccess: async () => {},
  readMetric: async (metric, window) =>
    emptyResult(metric, window, 'unavailable'),
  openAccessSettings: async () => {},
  getDeviceInfo: async () => ({
    os: '미지원',
    manufacturer: '',
    model: '',
    version: '',
  }),
};
