import { appConfig } from '../config';
import { apiRequest } from '../data/api/http';
import { tokenStore } from '../data/api/tokenStore';
import type { HealthDataAccess } from '../data/types';

// W05 동의 상태 조회 (docs/design/api/devices-health.md, S15P31E105-250 확정 계약).
type ConsentStatus = {
  items?: { consentType?: unknown; granted?: unknown }[];
};

export type ConsentReadDeps = {
  request: (path: string) => Promise<unknown>;
  accessToken: () => string | undefined;
  sessionKey?: () => string | undefined;
};

const defaultDeps: ConsentReadDeps = {
  request: path => apiRequest<ConsentStatus>(path),
  accessToken: () => tokenStore.current()?.accessToken,
  sessionKey: () =>
    tokenStore.current() ? String(tokenStore.session()) : undefined,
};

// The server's current health consent, or null when it is not known. Never turned into a guessed value.
// A failed call rejects; refreshWatchHealthConsent then re-sends only a saved consent whose delivery failed.
export async function readServerHealthConsent(
  deps: ConsentReadDeps = defaultDeps,
): Promise<HealthDataAccess | null> {
  const sessionKey = deps.sessionKey ?? deps.accessToken;
  const token = sessionKey();
  if (!token) {
    return null;
  }
  const body = (await deps.request('/consents')) as ConsentStatus | null;
  // Signed out (or another account) while W05 was in flight: an AGREEE must not overwrite the withdrawal.
  if (sessionKey() !== token) {
    return null;
  }
  const health = Array.isArray(body?.items)
    ? body.items.find(item => item?.consentType === 'HEALTH_DATA')
    : undefined;
  if (typeof health?.granted !== 'boolean') {
    return null;
  }
  return health.granted ? 'AGREEE' : 'DISAGREE';
}

// Mock data has no server consent, so the watch only gets a saved consent whose delivery failed.
export function serverHealthConsentReader() {
  return appConfig.dataSource === 'api' ? readServerHealthConsent : undefined;
}
