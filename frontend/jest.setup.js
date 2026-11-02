/* eslint-env jest */
// react-native-keychain is a native module; tests get an in-memory keystore that starts empty in every test,
// so a login in one test does not sign in the next one.
jest.mock('react-native-keychain', () => {
  const entries = new Map();
  return {
    __reset: () => entries.clear(),
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

beforeEach(() => {
  require('react-native-keychain').__reset();
});
