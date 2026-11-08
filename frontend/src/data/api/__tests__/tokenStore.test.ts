import * as Keychain from 'react-native-keychain';
import { tokenStore } from '../tokenStore';

const tokens = {
  userId: 101,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  refreshExpiresAt: '2026-12-02T01:00:00Z',
};

beforeEach(async () => {
  await tokenStore.clear();
});

test('save writes the tokens to the keystore', async () => {
  await tokenStore.save(tokens);

  expect(tokenStore.current()).toEqual(tokens);
  expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
    'runway',
    JSON.stringify(tokens),
    expect.objectContaining({ service: 'com.runway.health.auth' }),
  );
});

test('a relaunch reads the saved tokens back from the keystore', async () => {
  // After a relaunch memory is empty and only the keystore entry is left.
  await Keychain.setGenericPassword('runway', JSON.stringify(tokens), {
    service: 'com.runway.health.auth',
  });
  expect(tokenStore.current()).toBeNull();

  await expect(tokenStore.load()).resolves.toEqual(tokens);
  expect(tokenStore.current()).toEqual(tokens);
});

test('clear removes the tokens from memory and the keystore', async () => {
  await tokenStore.save(tokens);
  await tokenStore.clear();

  expect(tokenStore.current()).toBeNull();
  await expect(tokenStore.load()).resolves.toBeNull();
});

test('a broken keystore entry counts as signed out', async () => {
  await Keychain.setGenericPassword('runway', 'not json', {
    service: 'com.runway.health.auth',
  });
  await expect(tokenStore.load()).resolves.toBeNull();
});

test('a keystore failure counts as signed out', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockRejectedValueOnce(new Error('keystore locked'));
  await expect(tokenStore.load()).resolves.toBeNull();
});

test('legacy entries stay readable without inventing an expiry', async () => {
  const legacy = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  await Keychain.setGenericPassword('runway', JSON.stringify(legacy), {
    service: 'com.runway.health.auth',
  });
  await expect(tokenStore.load()).resolves.toEqual(legacy);
  expect(tokenStore.current()?.refreshExpiresAt).toBeUndefined();
});
