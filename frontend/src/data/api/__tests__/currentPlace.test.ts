import { DataError } from '../../errors';
import type { PhoneFix, PhoneLocation } from '../../types';
import {
  CURRENT_PLACE_LABEL,
  UNKNOWN_PLACE_LABEL,
  createCurrentPlace,
} from '../currentPlace';

// 2.0F · 2.0C · 2.0 현재 위치 in the server mode (S15P31E105-635): the phone's own fix, never the mock's place.

const fix: PhoneFix = {
  latitude: 35.1,
  longitude: 129.1,
  accuracyM: 8,
  altitudeM: null,
  time: 1,
};

function location(current: () => Promise<PhoneFix>): PhoneLocation {
  return {
    start: async () => true,
    stop: async () => undefined,
    subscribe: () => () => undefined,
    requestPermission: async () => true,
    current,
  };
}

const unknown = { name: UNKNOWN_PLACE_LABEL, gps: 'none', position: null };

test('a fix gives its position, a good signal and the geocoder name', async () => {
  const nameOf = jest.fn(async () => '광안리해수욕장');
  const getCurrentPlace = createCurrentPlace(
    location(async () => fix),
    nameOf,
  );

  await expect(getCurrentPlace()).resolves.toEqual({
    name: '광안리해수욕장',
    gps: 'good',
    position: [129.1, 35.1],
  });
  expect(nameOf).toHaveBeenCalledWith([129.1, 35.1]);
});

test('without a name or with a wide fix it says 현재 위치 and a weak signal', async () => {
  const getCurrentPlace = createCurrentPlace(
    location(async () => ({ ...fix, accuracyM: 120 })),
    async () => {
      throw new Error('no geocoder');
    },
  );

  await expect(getCurrentPlace()).resolves.toEqual({
    name: CURRENT_PLACE_LABEL,
    gps: 'weak',
    position: [129.1, 35.1],
  });
});

test('no permission, location off or no fix says it cannot find the place', async () => {
  for (const code of [
    'LOCATION_PERMISSION_DENIED',
    'LOCATION_DISABLED',
    'LOCATION_TIMEOUT',
  ] as const) {
    const getCurrentPlace = createCurrentPlace(
      location(async () => {
        throw new DataError(code, '현재 위치를 찾지 못했어요');
      }),
      async () => 'never',
    );
    await expect(getCurrentPlace()).resolves.toEqual(unknown);
  }
});

test('a device without phone location says it cannot find the place', async () => {
  await expect(createCurrentPlace(undefined)()).resolves.toEqual(unknown);
});
