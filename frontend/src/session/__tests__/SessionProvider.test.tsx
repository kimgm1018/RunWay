import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { SessionProvider, useSession } from '../SessionProvider';

jest.mock('../../health/watchHealth', () => ({
  setWatchHealthConsent: jest.fn().mockResolvedValue(undefined),
}));

test('signOut tells the watch the consent is withdrawn', async () => {
  let session!: ReturnType<typeof useSession>;
  function Probe() {
    session = useSession();
    return null;
  }
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <SessionProvider initialSignedIn>
        <Probe />
      </SessionProvider>,
    );
  });
  await act(async () => session.signOut());
  expect(setWatchHealthConsent).toHaveBeenCalledWith('DISAGREE');
  expect(session.signedIn).toBe(false);
  await act(async () => screen.unmount());
});
