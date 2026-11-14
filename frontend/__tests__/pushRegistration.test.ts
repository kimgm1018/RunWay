import type { PushDevice } from '../src/push/pushDevice';
import {
  PENDING_DELETE_WAIT_MS,
  releasePushToken,
  startPushRegistration,
} from '../src/push/pushRegistration';

// S15P31E105-815 AC-10: notification permission and the token's life on this phone.

type FakeDevice = PushDevice & {
  refresh: (token: string) => void;
  calls: string[];
};

function fakeDevice(options: {
  available?: boolean;
  granted?: boolean | Error;
  token?: string | Promise<string>;
}): FakeDevice {
  const refreshListeners = new Set<(token: string) => void>();
  const calls: string[] = [];
  return {
    calls,
    refresh: token => refreshListeners.forEach(listener => listener(token)),
    available: () => options.available ?? true,
    requestPermission: async () => {
      calls.push('permission');
      if (options.granted instanceof Error) {
        throw options.granted;
      }
      return options.granted ?? true;
    },
    getToken: async () => options.token ?? 'token-1',
    deleteToken: async () => {
      calls.push('deleteToken');
    },
    onTokenRefresh: listener => {
      refreshListeners.add(listener);
      return () => refreshListeners.delete(listener);
    },
    onForegroundMessage: () => () => undefined,
    initialOpened: async () => null,
    onOpened: () => () => undefined,
  };
}

function fakeApi(fail = false) {
  const calls: string[] = [];
  return {
    calls,
    registerPushToken: jest.fn(async (token: string) => {
      calls.push(`PUT ${token}`);
      if (fail) {
        throw new Error('offline');
      }
    }),
    unregisterPushToken: jest.fn(async (token: string) => {
      calls.push(`DELETE ${token}`);
      if (fail) {
        throw new Error('offline');
      }
    }),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('startPushRegistration', () => {
  it('registers the token once permission is granted and again when FCM rotates it', async () => {
    const device = fakeDevice({});
    const api = fakeApi();
    const stop = startPushRegistration(device, api);
    await flush();
    expect(device.calls).toEqual(['permission']);
    expect(api.calls).toEqual(['PUT token-1']);

    device.refresh('token-2');
    await flush();
    expect(api.calls).toEqual(['PUT token-1', 'PUT token-2']);
    stop();
  });

  it('registers nothing and removes an earlier token when permission is refused', async () => {
    const device = fakeDevice({ granted: false });
    const api = fakeApi();
    const stop = startPushRegistration(device, api);
    await flush();
    expect(api.registerPushToken).not.toHaveBeenCalled();
    expect(api.calls).toEqual(['DELETE token-1']);
    device.refresh('token-2');
    await flush();
    expect(api.registerPushToken).not.toHaveBeenCalled();
    stop();
  });

  it('treats a failing permission request as refused', async () => {
    const api = fakeApi();
    const stop = startPushRegistration(
      fakeDevice({ granted: new Error('no activity') }),
      api,
    );
    await flush();
    expect(api.registerPushToken).not.toHaveBeenCalled();
    stop();
  });

  it('does nothing without Firebase (iOS, or a build without google-services.json)', async () => {
    const device = fakeDevice({ available: false });
    const api = fakeApi();
    startPushRegistration(device, api)();
    await flush();
    expect(device.calls).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it('keeps going quietly when N03 fails', async () => {
    const device = fakeDevice({});
    const api = fakeApi(true);
    const stop = startPushRegistration(device, api);
    await flush();
    device.refresh('token-2');
    await flush();
    expect(api.calls).toEqual(['PUT token-1', 'PUT token-2']);
    stop();
  });

  it('stops listening for rotations after sign-out', async () => {
    const device = fakeDevice({});
    const api = fakeApi();
    const stop = startPushRegistration(device, api);
    await flush();
    stop();
    device.refresh('token-2');
    await flush();
    expect(api.calls).toEqual(['PUT token-1']);
  });

  it('does not register when signed out before permission was answered', async () => {
    let answer: (granted: boolean) => void = () => undefined;
    const device = {
      ...fakeDevice({}),
      requestPermission: () =>
        new Promise<boolean>(resolve => {
          answer = resolve;
        }),
    };
    const api = fakeApi();
    const stop = startPushRegistration(device, api);
    stop();
    answer(true);
    await flush();
    expect(api.calls).toEqual([]);
  });
});

describe('releasePushToken', () => {
  it('removes the token from the account, then deletes it on the phone', async () => {
    const device = fakeDevice({});
    const api = fakeApi();
    await releasePushToken(device, api);
    expect(api.calls).toEqual(['DELETE token-1']);
    expect(device.calls).toEqual(['deleteToken']);
  });

  it('still deletes the phone token when N04 fails', async () => {
    const device = fakeDevice({});
    const api = fakeApi(true);
    await expect(releasePushToken(device, api)).resolves.toBeUndefined();
    expect(device.calls).toEqual(['deleteToken']);
  });

  it('stops the running registration so a rotation after logout is not registered', async () => {
    const device = fakeDevice({});
    const api = fakeApi();
    startPushRegistration(device, api);
    await flush();
    await releasePushToken(device, api);
    device.refresh('token-after-logout');
    await flush();
    expect(api.calls).toEqual(['PUT token-1', 'DELETE token-1']);
  });

  it('gives up after the timeout so logout is never held by a hanging token read', async () => {
    jest.useFakeTimers();
    try {
      const device = fakeDevice({ token: new Promise<string>(() => undefined) });
      const api = fakeApi();
      let done = false;
      const release = releasePushToken(device, api, 3_000).then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(2_999);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await release;
      expect(done).toBe(true);
      expect(api.calls).toEqual([]);
      // Let the module's bounded wait for this hanging delete run out, so later tests start unblocked.
      await jest.advanceTimersByTimeAsync(PENDING_DELETE_WAIT_MS);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing without Firebase', async () => {
    const device = fakeDevice({ available: false });
    const api = fakeApi();
    await releasePushToken(device, api);
    expect(api.calls).toEqual([]);
    expect(device.calls).toEqual([]);
  });
});
