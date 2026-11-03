import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { appConfig } from '../../config';
import { apiRequest } from '../../data/api/http';
import { tokenStore } from '../../data/api/tokenStore';
import {
  refreshWatchHealthConsent,
  setWatchHealthConsent,
} from '../../health/watchHealth';
import { readServerHealthConsent } from '../../health/serverHealthConsent';
import { SessionProvider, useSession } from '../SessionProvider';

jest.mock('../../health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
  refreshWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

let session!: ReturnType<typeof useSession>;
function Probe() {
  session = useSession();
  return null;
}

async function mount(initialSignedIn?: boolean) {
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <SessionProvider initialSignedIn={initialSignedIn}>
        <Probe />
      </SessionProvider>,
    );
  });
  return screen;
}

beforeEach(async () => {
  await tokenStore.clear();
  jest.mocked(refreshWatchHealthConsent).mockClear();
  jest.mocked(setWatchHealthConsent).mockClear();
});

test('signOut tells the watch the consent is withdrawn', async () => {
  const screen = await mount(true);
  await act(async () => session.signOut());
  expect(setWatchHealthConsent).toHaveBeenCalledWith('DISAGREE');
  expect(session.signedIn).toBe(false);
  await act(async () => screen.unmount());
});

test('a launch without saved tokens ends signed out', async () => {
  const screen = await mount();
  expect(session.restoring).toBe(false);
  expect(session.signedIn).toBe(false);
  await act(async () => screen.unmount());
});

test('signing in keeps the tokens for the next launch', async () => {
  const first = await mount();
  await act(async () => session.signIn(tokens));
  expect(session.signedIn).toBe(true);
  await act(async () => first.unmount());

  const relaunch = await mount();
  expect(session.signedIn).toBe(true);
  await act(async () => relaunch.unmount());
});

test('signOut forgets the saved tokens', async () => {
  await tokenStore.save(tokens);
  const screen = await mount();
  expect(session.signedIn).toBe(true);

  await act(async () => session.signOut());

  expect(tokenStore.current()).toBeNull();
  await expect(tokenStore.load()).resolves.toBeNull();
  await act(async () => screen.unmount());
});

test('a rejected access token signs the user out', async () => {
  await tokenStore.save(tokens);
  const screen = await mount();
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ code: 'UNAUTHORIZED', message: '인증이 필요합니다.' }),
  });

  await act(async () => {
    await expect(apiRequest('/users/me')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  expect(session.signedIn).toBe(false);
  expect(tokenStore.current()).toBeNull();
  await act(async () => screen.unmount());
});

// S15P31E105-313: a login or a restored session hands the consent to the watch again.
test('a restored session refreshes the watch consent once', async () => {
  await tokenStore.save(tokens);
  const screen = await mount();
  expect(session.signedIn).toBe(true);
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
});

test('signing in refreshes the watch consent after the signed-out launch check', async () => {
  const screen = await mount();
  // Signed out at launch: only a withdrawal whose delivery failed is re-sent.
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(1);

  await act(async () => session.signIn(tokens));

  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount());
});

test('signing out only withdraws, and the next sign-in refreshes again', async () => {
  const screen = await mount(true);
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(1);

  await act(async () => session.signOut());
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(1);
  expect(setWatchHealthConsent).toHaveBeenCalledWith('DISAGREE');

  await act(async () => session.signIn(tokens));
  expect(refreshWatchHealthConsent).toHaveBeenCalledTimes(2);
  await act(async () => screen.unmount());
});

test('a watch refresh that never settles does not hold the sign-in', async () => {
  jest
    .mocked(refreshWatchHealthConsent)
    .mockReturnValue(new Promise<void>(() => {}));
  const screen = await mount();
  await act(async () => session.signIn(tokens));
  expect(session.signedIn).toBe(true);
  await act(async () => screen.unmount());
  jest.mocked(refreshWatchHealthConsent).mockResolvedValue(undefined);
});

test('against the server a signed-in refresh reads W05 first, signed out it does not', async () => {
  const original = appConfig.dataSource;
  (appConfig as { dataSource: string }).dataSource = 'api';
  try {
    const screen = await mount();
    expect(refreshWatchHealthConsent).toHaveBeenLastCalledWith(undefined);

    await act(async () => session.signIn(tokens));
    expect(refreshWatchHealthConsent).toHaveBeenLastCalledWith(
      readServerHealthConsent,
    );
    await act(async () => screen.unmount());
  } finally {
    (appConfig as { dataSource: string }).dataSource = original;
  }
});

test('mock data never reads W05', async () => {
  const screen = await mount(true);
  expect(refreshWatchHealthConsent).toHaveBeenLastCalledWith(undefined);
  await act(async () => screen.unmount());
});
