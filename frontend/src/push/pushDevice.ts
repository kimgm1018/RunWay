import { PermissionsAndroid, Platform } from 'react-native';
import { getApps } from '@react-native-firebase/app';
import {
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
} from '@react-native-firebase/messaging';

/** The FCM data of a push (docs/design/api/notifications.md 앱 밖 푸시). */
export type PushPayload = { [key: string]: unknown } | undefined;

/**
 * This phone's side of device push (S15P31E105-815, ADR-0025), kept behind one seam so the rest of the app and the
 * tests do not touch Firebase directly.
 *
 * FCM token APIs are deprecated upstream in favor of installation-ID registration but keep working while that opt-in
 * is off; the server sends to tokens to match (ADR-0025 후속 작업).
 */
export type PushDevice = {
  /** false on iOS and on a build without google-services.json (no Firebase app): push is simply off. */
  available: () => boolean;
  /** Android 13+ asks for POST_NOTIFICATIONS; older Android has no runtime permission. */
  requestPermission: () => Promise<boolean>;
  getToken: () => Promise<string>;
  deleteToken: () => Promise<void>;
  onTokenRefresh: (listener: (token: string) => void) => () => void;
  /** A push that arrived while the app was in the foreground (FCM shows nothing then). */
  onForegroundMessage: (listener: () => void) => () => void;
  /** The push whose tap started the app, if any. */
  initialOpened: () => Promise<PushPayload | null>;
  /** A push tapped while the app was in the background. */
  onOpened: (listener: (data: PushPayload) => void) => () => void;
};

const hasFirebaseApp = () => {
  try {
    return getApps().length > 0;
  } catch {
    return false;
  }
};

const POST_NOTIFICATIONS_API = 33;

export const firebasePushDevice: PushDevice = {
  available: () => Platform.OS === 'android' && hasFirebaseApp(),
  requestPermission: async () => {
    if (Platform.OS !== 'android') {
      return false;
    }
    if (Number(Platform.Version) < POST_NOTIFICATIONS_API) {
      return true;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  },
  getToken: () => getToken(getMessaging()),
  deleteToken: () => deleteToken(getMessaging()),
  onTokenRefresh: listener => onTokenRefresh(getMessaging(), listener),
  onForegroundMessage: listener => onMessage(getMessaging(), () => listener()),
  initialOpened: async () =>
    (await getInitialNotification(getMessaging()))?.data ?? null,
  onOpened: listener =>
    onNotificationOpenedApp(getMessaging(), message => listener(message.data)),
};
