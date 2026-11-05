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

// react-native-get-random-values polyfills crypto.getRandomValues through a native module; Node already has it.
jest.mock('react-native-get-random-values', () => ({}));

// @mj-studio/react-native-naver-map is a native map; tests get plain views (RunMap's markers keep their
// children, so labels on the map can be found) and a ref whose camera calls do nothing. A test taps the map
// with fireEvent(map, 'tapMap', { latitude, longitude }).
jest.mock('@mj-studio/react-native-naver-map', () => {
  const React = require('react');
  const { View } = require('react-native');
  const overlay = name => {
    const Overlay = props =>
      React.createElement(View, { testID: name }, props.children);
    Overlay.displayName = name;
    return Overlay;
  };
  const NaverMapView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      animateCameraTo: jest.fn(),
      animateCameraBy: jest.fn(),
      animateRegionTo: jest.fn(),
      animateCameraWithTwoCoords: jest.fn(),
      cancelAnimation: jest.fn(),
      setLocationTrackingMode: jest.fn(),
      screenToCoordinate: jest.fn(async () => ({
        isValid: false,
        latitude: 0,
        longitude: 0,
      })),
      coordinateToScreen: jest.fn(async () => ({
        isValid: false,
        screenX: 0,
        screenY: 0,
      })),
    }));
    return React.createElement(
      View,
      { testID: 'naver-map', style: props.style, onTapMap: props.onTapMap },
      props.children,
    );
  });
  return {
    NaverMapView,
    NaverMapMarkerOverlay: overlay('naver-map-marker'),
    NaverMapPathOverlay: overlay('naver-map-path'),
    NaverMapMultiPathOverlay: overlay('naver-map-multipath'),
    NaverMapPolylineOverlay: overlay('naver-map-polyline'),
    NaverMapCircleOverlay: overlay('naver-map-circle'),
  };
});

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

// lottie-react-native plays its animation natively; tests only need the view in the tree.
jest.mock('lottie-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LottieView = React.forwardRef((props, ref) =>
    React.createElement(View, { ...props, ref }),
  );
  return { __esModule: true, default: LottieView };
});
