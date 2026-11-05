import * as Keychain from 'react-native-keychain';

export type AuthTokens = {
  userId?: number;
  accessToken: string;
  refreshToken: string;
  // Older installations did not retain this metadata. They must sign in before a new run.
  refreshExpiresAt?: string;
};

const service = 'com.runway.health.auth';

// The tokens in memory, read by every request. Kept outside React so code without a screen (the watch relay) can call the server too.
let current: AuthTokens | null = null;
let generation = 0;
let persistent = false;
// Serialize keystore writes: a late rotation must never resurrect a cleared session.
let writes: Promise<unknown> = Promise.resolve();
function write<T>(run: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => {}).then(run);
  writes = next;
  return next;
}

function parse(saved: string): AuthTokens | null {
  try {
    const value = JSON.parse(saved);
    return typeof value?.accessToken === 'string' &&
      typeof value?.refreshToken === 'string'
      ? {
          ...(Number.isSafeInteger(value.userId) && value.userId > 0
            ? { userId: value.userId }
            : {}),
          accessToken: value.accessToken,
          refreshToken: value.refreshToken,
          ...(typeof value.refreshExpiresAt === 'string'
            ? { refreshExpiresAt: value.refreshExpiresAt }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

// Access and refresh tokens in the device keystore, so a relaunch stays signed in.
export const tokenStore = {
  current: () => current,
  session: () => generation,

  // Reads the saved tokens on launch. An unreadable entry counts as signed out.
  async load(): Promise<AuthTokens | null> {
    const reading = ++generation;
    await writes.catch(() => {});
    try {
      const saved = await Keychain.getGenericPassword({ service });
      if (generation !== reading) return current;
      current = saved ? parse(saved.password) : null;
      persistent = current !== null;
    } catch {
      if (generation === reading) current = null;
    }
    return current;
  },

  // Uses the tokens for this run without writing them to the keystore.
  hold(tokens: AuthTokens) {
    generation++;
    persistent = false;
    current = tokens;
  },

  async save(tokens: AuthTokens) {
    generation++;
    persistent = true;
    current = tokens;
    // AFTER_FIRST_UNLOCK keeps the tokens readable while the phone is locked mid-run (iOS; Android ignores it).
    await write(() =>
      Keychain.setGenericPassword('runway', JSON.stringify(tokens), {
        service,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      }),
    );
  },

  async rotate(session: number, tokens: AuthTokens): Promise<boolean> {
    if (generation !== session || !current) return false;
    if (persistent) {
      const stored = await write(() =>
        Keychain.setGenericPassword('runway', JSON.stringify(tokens), {
          service,
          accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      );
      if (!stored) throw new Error('인증정보를 저장하지 못했습니다.');
    }
    if (generation !== session || !current) return false;
    current = tokens;
    return true;
  },

  async clear() {
    generation++;
    persistent = false;
    current = null;
    await write(() => Keychain.resetGenericPassword({ service }));
  },
};
