import { NativeModules, PermissionsAndroid } from 'react-native';
import { samsungSleepNative } from '../../health/samsungSleepNative';
import {
  readPhoneHealthPermissions,
  readWatchReadiness,
} from '../watchReadiness.android';

jest.mock('../../health/samsungSleepNative', () => ({
  samsungSleepNative: { status: jest.fn() },
}));

const status = samsungSleepNative.status as jest.Mock;

afterEach(() => {
  jest.restoreAllMocks();
  delete NativeModules.WatchSession;
});

test('checks Samsung Health sleep and precise phone GPS without requesting access', async () => {
  status.mockResolvedValue('granted');
  const check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  const request = jest.spyOn(PermissionsAndroid, 'request');
  expect(await readPhoneHealthPermissions()).toEqual({
    sleep: 'connected',
    location: 'connected',
  });
  expect(check).toHaveBeenCalledWith(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  expect(request).not.toHaveBeenCalled();
});

test('a known denial differs from an unavailable SDK', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  status.mockResolvedValue('required');
  expect(await readPhoneHealthPermissions()).toEqual({
    sleep: 'denied',
    location: 'denied',
  });
  status.mockRejectedValue(new Error('sdk unavailable'));
  expect((await readPhoneHealthPermissions()).sleep).toBe('unknown');
});

test('older/missing bridges fail closed; a fresh result is requested for the chosen node', async () => {
  expect(await readWatchReadiness('watch-1')).toEqual({
    appStatus: 'noResponse',
  });
  const probe = jest
    .fn()
    .mockResolvedValue({
      appStatus: 'responded',
      heartRate: true,
      activity: false,
    });
  NativeModules.WatchSession = { getWatchReadiness: probe };
  expect(await readWatchReadiness('watch-1')).toEqual({
    appStatus: 'responded',
    heartRate: true,
    activity: false,
  });
  expect(probe).toHaveBeenCalledWith('watch-1');
  probe.mockRejectedValue(new Error('transport unavailable'));
  expect(await readWatchReadiness('watch-1')).toEqual({
    appStatus: 'noResponse',
  });
});
