import { appConfig } from '../../config';
import {
  readServerHealthConsent,
  serverHealthConsentReader,
  type ConsentReadDeps,
} from '../serverHealthConsent';

const items = (healthGranted: boolean) => ({
  items: [
    { consentType: 'TERMS_OF_SERVICE', granted: true },
    { consentType: 'PERSONAL_INFO', granted: true },
    { consentType: 'LOCATION_DATA', granted: true },
    { consentType: 'HEALTH_DATA', granted: healthGranted },
  ],
});

function deps(response: unknown, tokens = ['access-1', 'access-1']) {
  const accessToken = jest.fn();
  tokens.forEach(token => accessToken.mockReturnValueOnce(token));
  return {
    request: jest.fn().mockResolvedValue(response),
    accessToken,
  } satisfies ConsentReadDeps;
}

test('HEALTH_DATA granted maps to AGREE and W05 is called with GET /consents', async () => {
  const d = deps(items(true));
  await expect(readServerHealthConsent(d)).resolves.toBe('AGREE');
  expect(d.request).toHaveBeenCalledWith('/consents');
});

test('HEALTH_DATA not granted maps to DISAGREE', async () => {
  await expect(readServerHealthConsent(deps(items(false)))).resolves.toBe(
    'DISAGREE',
  );
});

test.each([
  ['no body', null],
  ['no items', {}],
  [
    'no HEALTH_DATA item',
    { items: [{ consentType: 'PERSONAL_INFO', granted: true }] },
  ],
  [
    'granted is not a boolean',
    { items: [{ consentType: 'HEALTH_DATA', granted: 'true' }] },
  ],
])('an unexpected answer (%s) is not turned into a value', async (_, body) => {
  await expect(readServerHealthConsent(deps(body))).resolves.toBeNull();
});

test('signed out: W05 is not called', async () => {
  const d = deps(items(true), [undefined as unknown as string]);
  await expect(readServerHealthConsent(d)).resolves.toBeNull();
  expect(d.request).not.toHaveBeenCalled();
});

test('an answer that arrives after the session changed is dropped', async () => {
  const d = deps(items(true), ['access-1', 'access-2']);
  await expect(readServerHealthConsent(d)).resolves.toBeNull();
});

test('a failed W05 call rejects so the caller falls back to the saved value', async () => {
  const d = deps(null);
  d.request.mockRejectedValue(new Error('offline'));
  await expect(readServerHealthConsent(d)).rejects.toThrow('offline');
});

test('the reader is only used against the server', () => {
  const original = appConfig.dataSource;
  try {
    (appConfig as { dataSource: string }).dataSource = 'api';
    expect(serverHealthConsentReader()).toBe(readServerHealthConsent);
    (appConfig as { dataSource: string }).dataSource = 'mock';
    expect(serverHealthConsentReader()).toBeUndefined();
  } finally {
    (appConfig as { dataSource: string }).dataSource = original;
  }
});

test.each([true, false])(
  'W05 preserves a %s consent answer after successful U02 rotation',
  async granted => {
    const { tokenStore } = require('../../data/api/tokenStore');
    await tokenStore.clear();
    tokenStore.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const respond = (status: number, body: unknown) => ({
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(respond(401, { code: 'UNAUTHORIZED' }))
      .mockResolvedValueOnce(
        respond(200, {
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresInSec: 599,
          refreshExpiresAt: '2026-12-01T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(respond(200, items(granted)));
    await expect(readServerHealthConsent()).resolves.toBe(
      granted ? 'AGREE' : 'DISAGREE',
    );
  },
);
