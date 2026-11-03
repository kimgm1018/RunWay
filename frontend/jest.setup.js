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

// react-native-image-picker is a native module; tests set what the picker answers per test (8.2 사진 바꾸기).
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));

// react-native-pager-view is a native pager; tests render every page and report page changes the way the
// native view does, so a test drives a swipe through onPageScroll and onPageSelected.
jest.mock('react-native-pager-view', () => {
  const React = require('react');
  const { View } = require('react-native');
  class PagerView extends React.Component {
    setPage(page) {
      this.props.onPageSelected?.({ nativeEvent: { position: page } });
    }
    setPageWithoutAnimation(page) {
      this.setPage(page);
    }
    setScrollEnabled() {}
    render() {
      return React.createElement(View, this.props, this.props.children);
    }
  }
  return { __esModule: true, default: PagerView };
});
