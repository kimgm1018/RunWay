import * as HC from 'react-native-health-connect';
import DeviceInfo from 'react-native-device-info';
import { createAndroidReader } from './androidReader';
import { createSamsungReader } from './samsungReader';
import { createAndroidComposite } from './androidComposite';
import { samsungNative } from './samsungNative.android';

const healthConnect = createAndroidReader({
  availability: async () => {
    const status = await HC.getSdkStatus();
    if (
      status ===
      HC.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
    ) {
      return 'updateRequired';
    }
    if (status !== HC.SdkAvailabilityStatus.SDK_AVAILABLE) {
      return 'unavailable';
    }
    return (await HC.initialize()) ? 'available' : 'unavailable';
  },
  request: async types => {
    await HC.requestPermission(
      types.map(recordType => ({
        accessType: 'read',
        recordType: recordType as HC.RecordType,
      })),
    );
  },
  grantedTypes: async () =>
    (await HC.getGrantedPermissions())
      .filter(p => p.accessType === 'read')
      .map(p => p.recordType),
  readPage: (type, window, origin, pageToken) =>
    HC.readRecords(type as HC.RecordType, {
      timeRangeFilter: {
        operator: 'between',
        startTime: window.start,
        endTime: window.end,
      },
      dataOriginFilter: origin ? [origin] : undefined,
      pageToken,
      pageSize: 1000,
    }),
  aggregateSteps: async (window, origin) => {
    const result = await HC.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: {
        operator: 'between',
        startTime: window.start,
        endTime: window.end,
      },
      dataOriginFilter: [origin],
    });
    return result.COUNT_TOTAL ?? null;
  },
  openSettings: async () => {
    HC.openHealthConnectSettings();
  },
  device: async () => ({
    os: 'Android',
    manufacturer: await DeviceInfo.getManufacturer(),
    model: DeviceInfo.getModel(),
    version: DeviceInfo.getSystemVersion(),
  }),
});
export const provider = createAndroidComposite(
  createSamsungReader({
    ...samsungNative,
    device: healthConnect.getDeviceInfo,
  }),
  healthConnect,
);
