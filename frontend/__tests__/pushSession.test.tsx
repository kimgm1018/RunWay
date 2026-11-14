import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider, tokenStore } from '../src/data';
import type { PushDevice } from '../src/push/pushDevice';
import {
  forgetPushToken,
  releasePushToken,
  startPushRegistration,
} from '../src/push/pushRegistration';
import { SessionProvider, useSession } from '../src/session/SessionProvider';

// S15P31E105-815 AC-10: the token leaves the account before the login does, and a session that ends without a logout
// still stops pushes on this phone.

function fakeDevice(calls: string[], token: () => Promise<string>) {
  const device: PushDevice = {
    available: () => true,
    requestPermission: async () => true,
    getToken: token,
    deleteToken: async () => {
      calls.push('deleteToken');
    },
    onTokenRefresh: () => () => undefined,
    onForegroundMessage: () => () => undefined,
    initialOpened: async () => null,
    onOpened: () => () => undefined,
  };
  return device;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

it('logOut removes the push token (N04) before U03 ends the login', async () => {
  const calls: string[] = [];
  const repos = createMockRepositories({ latencyMs: 0 });
  jest
    .spyOn(repos.notifications, 'unregisterPushToken')
    .mockImplementation(async token => {
      calls.push(`N04 ${token} auth=${tokenStore.current() !== null}`);
    });
  jest.spyOn(repos.auth, 'logout').mockImplementation(async () => {
    calls.push('U03');
  });
  await tokenStore.save({
    accessToken: 'header.e30.signature',
    refreshToken: 'refresh-1',
  });
  let session: ReturnType<typeof useSession> | null = null;
  function Probe() {
    session = useSession();
    return null;
  }
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repos}>
        <SessionProvider
          initialSignedIn
          pushDevice={fakeDevice(calls, async () => 'tok-1')}
        >
          <Probe />
        </SessionProvider>
      </DataProvider>,
    );
  });
  calls.length = 0; // registration on sign-in is covered elsewhere
  await act(async () => {
    await session!.logOut();
  });
  expect(calls).toEqual(['N04 tok-1 auth=true', 'deleteToken', 'U03']);
  expect(session!.signedIn).toBe(false);
  await act(async () => screen.unmount());
});

it('forgetPushToken deletes only the phone token (no N04 without a login)', async () => {
  const calls: string[] = [];
  const device = fakeDevice(calls, async () => 'tok-1');
  forgetPushToken(device);
  await flush();
  expect(calls).toEqual(['deleteToken']);
});

it('a delete that finishes after logout gave up waits before the next account registers', async () => {
  jest.useFakeTimers();
  try {
    const calls: string[] = [];
    let answerToken: (token: string) => void = () => undefined;
    const slow = fakeDevice(
      calls,
      () =>
        new Promise<string>(resolve => {
          answerToken = resolve;
        }),
    );
    const api = {
      registerPushToken: jest.fn(async (token: string) => {
        calls.push(`N03 ${token}`);
      }),
      unregisterPushToken: jest.fn(async (token: string) => {
        calls.push(`N04 ${token}`);
      }),
    };
    // Logout gives up after 3 s while the token read is still hanging.
    const release = releasePushToken(slow, api, 3_000);
    await jest.advanceTimersByTimeAsync(3_000);
    await release;

    // The next account signs in at once; its registration must not run before the old delete ends.
    const next = { ...slow, getToken: async () => 'tok-next' };
    const stop = startPushRegistration(next, api);
    await jest.advanceTimersByTimeAsync(0);
    expect(api.registerPushToken).not.toHaveBeenCalled();

    answerToken('tok-old');
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    expect(calls).toEqual(['N04 tok-old', 'deleteToken', 'N03 tok-next']);
    stop();
  } finally {
    jest.useRealTimers();
  }
});

it('a token read that never answers holds the next registration for 15 s at most', async () => {
  jest.useFakeTimers();
  try {
    const calls: string[] = [];
    const stuck = fakeDevice(calls, () => new Promise<string>(() => undefined));
    const api = {
      registerPushToken: jest.fn(async () => undefined),
      unregisterPushToken: jest.fn(async () => undefined),
    };
    const release = releasePushToken(stuck, api, 3_000);
    await jest.advanceTimersByTimeAsync(3_000);
    await release;
    const stop = startPushRegistration(
      { ...stuck, getToken: async () => 'tok-next' },
      api,
    );
    await jest.advanceTimersByTimeAsync(11_999);
    expect(api.registerPushToken).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await flush();
    expect(api.registerPushToken).toHaveBeenCalledWith('tok-next');
    stop();
  } finally {
    jest.useRealTimers();
  }
});
