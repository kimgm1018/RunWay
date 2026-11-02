import * as Keychain from 'react-native-keychain';

export type AuthTokens = { accessToken: string; refreshToken: string };

const service = 'com.runway.health.auth';

// The tokens in memory, read by every request. Kept outside React so code without a screen (the watch relay) can call the server too.
let current: AuthTokens | null = null;

function parse(saved: string): AuthTokens | null {
  try {
    const value = JSON.parse(saved);
    return typeof value?.accessToken === 'string' &&
      typeof value?.refreshToken === 'string'
      ? { accessToken: value.accessToken, refreshToken: value.refreshToken }
      : null;
  } catch {
    return null;
  }
}

// Access and refresh tokens in the device keystore, so a relaunch stays signed in.
export const tokenStore = {
  current: () => current,

  // Reads the saved tokens on launch. An unreadable entry counts as signed out.
  async load(): Promise<AuthTokens | null> {
    try {
      const saved = await Keychain.getGenericPassword({ service });
      current = saved ? parse(saved.password) : null;
    } catch {
      current = null;
    }
    return current;
  },

  async save(tokens: AuthTokens) {
    current = tokens;
    // AFTER_FIRST_UNLOCK keeps the tokens readable while the phone is locked mid-run (iOS; Android ignores it).
    await Keychain.setGenericPassword('runway', JSON.stringify(tokens), {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  async clear() {
    current = null;
    await Keychain.resetGenericPassword({ service });
  },
};
