/* eslint-env jest */
// react-native-keychain is a native module; tests get an in-memory keystore that starts empty.
jest.mock('react-native-keychain', () => {
  const entries = new Map();
  return {
    ACCESSIBLE: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
        'AccessibleAfterFirstUnlockThisDeviceOnly',
    },
    setGenericPassword: jest.fn(async (username, password, options) => {
      entries.set(options?.service, { username, password });
      return { service: options?.service, storage: 'mock' };
    }),
    getGenericPassword: jest.fn(async options => {
      const entry = entries.get(options?.service);
      return entry
        ? { ...entry, service: options?.service, storage: 'mock' }
        : false;
    }),
    resetGenericPassword: jest.fn(async options =>
      entries.delete(options?.service),
    ),
  };
});
