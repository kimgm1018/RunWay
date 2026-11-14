import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { createMockRepositories, DataProvider } from '../src/data';
import type { RootStackParamList } from '../src/navigation/types';
import { PushBridge } from '../src/push/PushBridge';
import type { PushDevice, PushPayload } from '../src/push/pushDevice';
import { onPushReceived } from '../src/screens/home/notificationRefresh';

// S15P31E105-815 AC-10·AC-11: the app side of a tapped or foreground push.

function fakeNavigation(ready = true) {
  const listeners = new Set<() => void>();
  const navigation = {
    ready,
    isReady: () => navigation.ready,
    addListener: (_event: string, listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: jest.fn(),
    becomeReady: () => {
      navigation.ready = true;
      listeners.forEach(listener => listener());
    },
  };
  return navigation;
}

function fakeDevice(initial: PushPayload | null = null) {
  let opened: ((data: PushPayload) => void) | null = null;
  let foreground: (() => void) | null = null;
  const device: PushDevice & {
    tap: (data: PushPayload) => void;
    arrive: () => void;
  } = {
    available: () => true,
    requestPermission: jest.fn(async () => true),
    getToken: async () => 'token-1',
    deleteToken: async () => undefined,
    onTokenRefresh: () => () => undefined,
    onForegroundMessage: listener => {
      foreground = listener;
      return () => {
        foreground = null;
      };
    },
    initialOpened: async () => initial,
    onOpened: listener => {
      opened = listener;
      return () => {
        opened = null;
      };
    },
    tap: data => opened?.(data),
    arrive: () => foreground?.(),
  };
  return device;
}

const repositories = () => {
  const repos = createMockRepositories({ latencyMs: 0 });
  jest.spyOn(repos.notifications, 'registerPushToken');
  return repos;
};

async function render(props: {
  navigation: ReturnType<typeof fakeNavigation>;
  device: ReturnType<typeof fakeDevice>;
  signedIn: boolean;
  repos: ReturnType<typeof repositories>;
}) {
  const element = (signedIn: boolean) => (
    <DataProvider repositories={props.repos}>
      <PushBridge
        navigation={
          props.navigation as unknown as NavigationContainerRefWithCurrent<RootStackParamList>
        }
        signedIn={signedIn}
        device={props.device}
      />
    </DataProvider>
  );
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(element(props.signedIn));
  });
  return {
    screen,
    signIn: async () => {
      await act(async () => screen.update(element(true)));
    },
  };
}

it('opens the push that started the app once someone signs in', async () => {
  const navigation = fakeNavigation();
  const device = fakeDevice({ kind: 'CREW_JOIN_APPROVED', targetId: '5' });
  const repos = repositories();
  const { screen, signIn } = await render({
    navigation,
    device,
    signedIn: false,
    repos,
  });
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(repos.notifications.registerPushToken).not.toHaveBeenCalled();

  await signIn();
  expect(navigation.navigate).toHaveBeenCalledWith('CrewDetail', {
    crewId: '5',
  });
  expect(repos.notifications.registerPushToken).toHaveBeenCalledWith(
    'token-1',
  );
  await act(async () => screen.unmount());
});

it('waits for the navigator before opening a tapped push', async () => {
  const navigation = fakeNavigation(false);
  const device = fakeDevice({ kind: 'POST_COMMENT', targetId: '8' });
  const { screen } = await render({
    navigation,
    device,
    signedIn: true,
    repos: repositories(),
  });
  expect(navigation.navigate).not.toHaveBeenCalled();
  await act(async () => navigation.becomeReady());
  expect(navigation.navigate).toHaveBeenCalledWith('PostDetail', {
    postId: '8',
  });
  await act(async () => screen.unmount());
});

it('opens each push tapped while the app runs in the background', async () => {
  const navigation = fakeNavigation();
  const device = fakeDevice();
  const { screen } = await render({
    navigation,
    device,
    signedIn: true,
    repos: repositories(),
  });
  await act(async () =>
    device.tap({ kind: 'NEW_FOLLOWER', targetId: '3', notificationId: '1' }),
  );
  await act(async () =>
    device.tap({ kind: 'NEW_FOLLOWER', targetId: '3', notificationId: '1' }),
  );
  expect(navigation.navigate).toHaveBeenCalledTimes(2);
  expect(navigation.navigate).toHaveBeenLastCalledWith('RunnerProfile', {
    userId: '3',
  });
  await act(async () => screen.unmount());
});

it('tells 2.1 to refresh when a push arrives in the foreground', async () => {
  const device = fakeDevice();
  const heard = jest.fn();
  const stop = onPushReceived(heard);
  const { screen } = await render({
    navigation: fakeNavigation(),
    device,
    signedIn: true,
    repos: repositories(),
  });
  await act(async () => device.arrive());
  expect(heard).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
  device.arrive();
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
});
