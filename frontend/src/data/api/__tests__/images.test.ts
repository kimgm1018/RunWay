import { appConfig } from '../../../config';
import { ownImageSource } from '../images';
import { tokenStore } from '../tokenStore';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const origin = appConfig.apiBaseUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1');

// Exercise RN 0.85.3's Android source-to-native conversion, rather than the Jest Image mock.
const AndroidImage = jest.requireActual(
  'react-native/Libraries/Image/Image.android',
).default;

test('the Android native image receives the owner Authorization header', async () => {
  tokenStore.hold({ accessToken: 'access-832', refreshToken: 'refresh-832' });
  let screen!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      screen = TestRenderer.create(
        React.createElement(AndroidImage, {
          source: ownImageSource(`${origin}/api/v1/images/own-run`),
          style: { width: 170, height: 200 },
        }),
      );
    });
    expect(
      screen.root.findAll(
        node => node.props.headers?.Authorization === 'Bearer access-832',
      ).length,
    ).toBeGreaterThan(0);
  } finally {
    if (screen) await act(async () => screen.unmount());
  }
});

afterEach(async () => {
  await tokenStore.clear().catch(() => undefined);
});

// S15P31E105-756 (ADR-0024): an own run thumbnail is asked with my token, but the token never leaves the API server.
test('ownImageSource adds my token only for an address on the API server', () => {
  tokenStore.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const own = `${origin}/api/v1/images/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`;

  expect(ownImageSource(own)).toEqual([
    {
      uri: own,
      headers: { Authorization: 'Bearer access-1' },
    },
  ]);
  for (const other of [
    'https://elsewhere.example/api/v1/images/x',
    `${origin}.elsewhere.example/api/v1/images/x`,
    own.replace(/^https:/, 'http:'),
  ]) {
    expect(ownImageSource(other)).toEqual({ uri: other });
  }
});

test('ownImageSource without a session asks without a header', async () => {
  await tokenStore.clear().catch(() => undefined);
  const own = `${origin}/api/v1/images/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`;

  expect(ownImageSource(own)).toEqual({ uri: own });
});
