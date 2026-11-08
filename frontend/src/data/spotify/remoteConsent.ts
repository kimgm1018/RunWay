import * as Keychain from 'react-native-keychain';
const service = 'com.runway.health.spotify.remote-consent';
let allowed: boolean | undefined;
let epoch = 0;
let writes = Promise.resolve();
export const remoteConsent = {
  version: () => epoch,
  async load() {
    if (allowed !== undefined) {
      return allowed;
    }
    const requested = epoch;
    try {
      const saved = await Keychain.getGenericPassword({ service });
      if (requested === epoch && allowed === undefined) {
        allowed = Boolean(saved && saved.password === 'allowed');
      }
    } catch {
      if (requested === epoch && allowed === undefined) {
        allowed = false;
      }
    }
    return allowed ?? false;
  },
  async save(expected = epoch) {
    const operation = writes.then(async () => {
      if (expected !== epoch) {
        return false;
      }
      await Keychain.setGenericPassword('spotify-remote', 'allowed', {
        service,
      });
      if (expected !== epoch) {
        return false;
      }
      allowed = true;
      return true;
    });
    writes = operation.then(
      () => {},
      () => {},
    );
    return operation;
  },
  async clear() {
    epoch++;
    allowed = false;
    const operation = writes.then(async () => {
      await Keychain.resetGenericPassword({ service });
    });
    writes = operation.then(
      () => {},
      () => {},
    );
    await operation;
  },
};
