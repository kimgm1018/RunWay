function fresh() {
  jest.resetModules();
  const consent = require('../remoteConsent')
    .remoteConsent as typeof import('../remoteConsent').remoteConsent;
  const keychain =
    require('react-native-keychain') as typeof import('react-native-keychain');
  return { consent, keychain };
}
afterEach(() => jest.restoreAllMocks());
test('a stored consent read that finishes after logout cannot authorize the next session', async () => {
  const { consent, keychain } = fresh();
  let release!: (value: unknown) => void;
  jest.spyOn(keychain, 'getGenericPassword').mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve as never;
      }),
  );
  const reading = consent.load();
  await consent.clear();
  release({ password: 'allowed' });
  await reading;
  expect(await consent.load()).toBe(false);
});
test('logout wins over a pending consent save in memory and persistent storage', async () => {
  const { consent, keychain } = fresh();
  const save = keychain.setGenericPassword;
  let release!: () => void;
  jest.spyOn(keychain, 'setGenericPassword').mockImplementationOnce(
    (...args) =>
      new Promise(resolve => {
        release = () => {
          void save(...args).then(resolve);
        };
      }),
  );
  const saving = consent.save();
  await Promise.resolve();
  const clearing = consent.clear();
  release();
  await saving;
  await clearing;
  expect(await consent.load()).toBe(false);
  expect(
    await keychain.getGenericPassword({
      service: 'com.runway.health.spotify.remote-consent',
    }),
  ).toBe(false);
});
