import { appConfig } from '../../../config';
import { ownImageSource } from '../images';
import { tokenStore } from '../tokenStore';

const origin = appConfig.apiBaseUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1');

afterEach(async () => {
  await tokenStore.clear().catch(() => undefined);
});

// S15P31E105-756 (ADR-0024): an own run thumbnail is asked with my token, but the token never leaves the API server.
test('ownImageSource adds my token only for an address on the API server', () => {
  tokenStore.hold({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  const own = `${origin}/api/v1/images/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`;

  expect(ownImageSource(own)).toEqual({
    uri: own,
    headers: { Authorization: 'Bearer access-1' },
  });
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
