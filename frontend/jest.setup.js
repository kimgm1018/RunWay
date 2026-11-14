/* eslint-env jest */
// A mounted app starts visible. RN's preset supplies a jest.fn here instead of a valid native AppState value.
require('react-native').AppState.currentState = 'active';
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

// 경로 재생 공유 (S15P31E105-704): the picture and the share sheet are native; tests get a file name and a sheet
// that resolves, and set failures per test.
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => '/data/cache/replay.png'),
}));
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn(async () => ({ success: true, message: '' })) },
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
  let mapsHeld = false;
  const heldMaps = [];
  // The map's load (its first tiles drawn, S15P31E105-719) follows right after; a test can hold just that back
  // (__holdMapsLoaded) and send it later (__loadHeldMaps), as a map whose tiles are slow does.
  let loadsHeld = false;
  const heldLoads = [];
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
    // The native map says it is ready right after it mounts; a test can hold that back
    // (__holdMapsReady) and send it later (__readyHeldMaps), as a slow map does (S15P31E105-692).
    const { onInitialized, onMapLoaded } = props;
    React.useEffect(() => {
      const load = () => {
        if (loadsHeld) {
          heldLoads.push(onMapLoaded);
        } else {
          onMapLoaded?.();
        }
      };
      if (mapsHeld) {
        heldMaps.push(() => {
          onInitialized?.();
          load();
        });
      } else {
        onInitialized?.();
        load();
      }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement(
      View,
      { testID: 'naver-map', style: props.style, onTapMap: props.onTapMap },
      props.children,
    );
  });
  return {
    __holdMapsReady: held => {
      mapsHeld = held;
    },
    __readyHeldMaps: () => heldMaps.splice(0).forEach(ready => ready?.()),
    __holdMapsLoaded: held => {
      loadsHeld = held;
    },
    __loadHeldMaps: () => heldLoads.splice(0).forEach(loaded => loaded?.()),
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

// react-native loads most of its modules lazily: index.js getters (View, Text, ScrollView, ...) and the paper
// renderer behind findNodeHandle are required on first use. Without this, every test file's first render
// requires and Babel-transforms about 1 MB of React Native inside that test's time limit, which under a full
// parallel run exceeded 15–20 s (S15P31E105-477). Loading them here charges that cost to the file's setup,
// which has no time limit. A component missing from this list still works; its first use is only slower.
{
  const ReactNative = require('react-native');
  for (const name of [
    'ActivityIndicator',
    'Alert',
    'Animated',
    'AppState',
    'BackHandler',
    'Dimensions',
    'Easing',
    'FlatList',
    'I18nManager',
    'Image',
    'Keyboard',
    'KeyboardAvoidingView',
    'Linking',
    'Modal',
    'NativeModules',
    'PanResponder',
    'Platform',
    'Pressable',
    'RefreshControl',
    'ScrollView',
    'StatusBar',
    'StyleSheet',
    'Text',
    'TextInput',
    'UIManager',
    'View',
    'processColor',
    'useAnimatedValue',
    'useWindowDimensions',
  ]) {
    void ReactNative[name];
  }
  // Animated components and Easing.bezier are lazy too, and findNodeHandle loads the 740 KB paper renderer.
  void ReactNative.Animated.View;
  void ReactNative.Animated.ScrollView;
  ReactNative.Easing.bezier(0, 0, 1, 1);
  ReactNative.findNodeHandle(null);
}

// 동작 줄이기 on by default, so screens show their final state at once (S15P31E105-478). A test that checks a motion
// turns it off with setReduceMotion(false).
beforeEach(() => {
  require('./src/components/Motion').setReduceMotion(true);
});

// The app ships with dataSource 'api' (S15P31E105-591). Screen tests are written against the mock repositories,
// so every test file starts on 'mock'; a test that needs the server path sets 'api' itself and restores it.
require('./src/config').appConfig.dataSource = 'mock';

// 그룹 탭 첫 화면 shows once per member (S15P31E105-697); tests open the group tab straight onto 6.0 unless
// they turn it back on (groupIntro.test.tsx).
beforeEach(() => {
  require('./src/data/group/groupIntroSeen').setGroupIntroSeenForTest(true);
});

// AppText draws figure and Latin runs in Archivo as nested Texts (S15P31E105-662). Component tests read a line's
// text straight from its Text node, so the split stays off here (global is globalThis in Jest); latinRuns.test.tsx turns it
// on to test it.
global.__RUNWAY_LATIN_SPLIT__ = false;

// S15P31E105-815: Firebase is native. Without a Firebase app (as in a build without google-services.json) device push
// is off, so screens never touch it; push tests pass their own PushDevice instead.
jest.mock('@react-native-firebase/app', () => ({ getApps: jest.fn(() => []) }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'mock-fcm-token'),
  deleteToken: jest.fn(async () => undefined),
  onTokenRefresh: jest.fn(() => () => undefined),
  onMessage: jest.fn(() => () => undefined),
  getInitialNotification: jest.fn(async () => null),
  onNotificationOpenedApp: jest.fn(() => () => undefined),
}));
