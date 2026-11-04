import * as Keychain from 'react-native-keychain';
import { DataError } from '../data/errors';
import type { Repositories } from '../data/types';

type Logout = Repositories['auth']['logout'];

// Refresh tokens whose U03 never got an answer, kept apart from the signed-in tokens (tokenStore.ts) so the
// next launch can send them again (users.md U03: 응답 유실 시 같은 토큰으로 재시도). Never logged.
const service = 'com.runway.health.pendingLogout';
// A few logouts in a row without a connection; older ones past this are left to expire on the server.
const keep = 5;

async function loadPending(): Promise<string[]> {
  try {
    const saved = await Keychain.getGenericPassword({ service });
    const value = saved ? JSON.parse(saved.password) : [];
    return Array.isArray(value)
      ? value.filter((token): token is string => typeof token === 'string')
      : [];
  } catch {
    return [];
  }
}

async function savePending(tokens: string[]) {
  try {
    if (tokens.length === 0) {
      await Keychain.resetGenericPassword({ service });
    } else {
      await Keychain.setGenericPassword('logout', JSON.stringify(tokens), {
        service,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }
  } catch {
    // Losing the list only means those logins expire on the server instead of being revoked.
  }
}

// 400 VALIDATION_ERROR means the token itself was refused; sending it again cannot succeed.
function retryable(error: unknown) {
  return !(error instanceof DataError && error.status === 400);
}

// Sends U03 for one refresh token. True once the server confirmed the revoke (204); on a network failure or
// 503 the token waits for the next launch, and the caller signs out on the phone either way.
export async function revokeOnServer(
  logout: Logout,
  refreshToken: string,
): Promise<boolean> {
  try {
    await logout(refreshToken);
    return true;
  } catch (error) {
    if (retryable(error)) {
      const pending = await loadPending();
      if (!pending.includes(refreshToken)) {
        await savePending([refreshToken, ...pending].slice(0, keep));
      }
    }
    return false;
  }
}

// At launch: sends U03 again for the logouts that never got an answer. Those still failing stay for next time.
export async function retryPendingLogouts(logout: Logout) {
  const pending = await loadPending();
  if (pending.length === 0) {
    return;
  }
  const left: string[] = [];
  for (const token of pending) {
    try {
      await logout(token);
    } catch (error) {
      if (retryable(error)) {
        left.push(token);
      }
    }
  }
  await savePending(left);
}
