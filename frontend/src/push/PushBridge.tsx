import { useEffect, useState } from 'react';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useRepositories } from '../data/DataProvider';
import { openPushTarget } from '../navigation/notificationTargets';
import type { RootStackParamList } from '../navigation/types';
import { notifyPushReceived } from '../screens/home/notificationRefresh';
import { firebasePushDevice, type PushDevice, type PushPayload } from './pushDevice';
import { startPushRegistration } from './pushRegistration';

/**
 * Device push on the app side (S15P31E105-815, ADR-0025). Registers this phone while signed in, opens the screen of a
 * tapped push — whether the tap started the app or brought it back — once the navigator is ready and someone is
 * signed in, and tells 2.1 to refresh when a push arrives in the foreground. Renders nothing.
 */
export function PushBridge({
  navigation,
  signedIn,
  device = firebasePushDevice,
}: {
  navigation: NavigationContainerRefWithCurrent<RootStackParamList>;
  signedIn: boolean;
  device?: PushDevice;
}) {
  const { notifications } = useRepositories();
  // `{ data }` so tapping the same push twice still opens it twice.
  const [opened, setOpened] = useState<{ data: PushPayload } | null>(null);
  const [ready, setReady] = useState(navigation.isReady());

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    return startPushRegistration(device, notifications);
  }, [device, notifications, signedIn]);

  useEffect(() => {
    if (!device.available()) {
      return;
    }
    let active = true;
    device.initialOpened().then(
      data => {
        if (active && data) {
          setOpened({ data });
        }
      },
      () => undefined,
    );
    const stopOpened = device.onOpened(data => setOpened({ data }));
    const stopForeground = device.onForegroundMessage(notifyPushReceived);
    return () => {
      active = false;
      stopOpened();
      stopForeground();
    };
  }, [device]);

  useEffect(() => {
    if (ready) {
      return;
    }
    if (navigation.isReady()) {
      setReady(true);
      return;
    }
    return navigation.addListener('state', () => {
      if (navigation.isReady()) {
        setReady(true);
      }
    });
  }, [navigation, ready]);

  useEffect(() => {
    if (opened && ready && signedIn) {
      setOpened(null);
      openPushTarget(navigation, opened.data);
    }
  }, [navigation, opened, ready, signedIn]);

  return null;
}
