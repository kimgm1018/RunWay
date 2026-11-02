import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { apiRequest } from '../../data/api/http';
import { tokenStore } from '../../data/api/tokenStore';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { SessionProvider, useSession } from '../SessionProvider';

jest.mock('../../health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
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
