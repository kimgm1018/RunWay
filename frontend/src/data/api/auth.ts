import type { AuthSession, Repositories } from '../types';
import { apiRequest } from './http';

// U01 response (docs/design/api/users.md). expiresInSec and refreshExpiresAt matter once refresh (U02) lands.
type LoginResponse = {
  user: { id: number; loginId: string };
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresAt: string;
  onboardingCompleted: boolean;
};

// U01 로그인. Wrong credentials come back as INVALID_CREDENTIALS, five in a row as LOGIN_LOCKED.
export const login: Repositories['auth']['login'] = async ({
  loginId,
  password,
}): Promise<AuthSession> => {
  const response = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { loginId, password },
    auth: false,
  });
  return {
    user: response.user,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    onboardingCompleted: response.onboardingCompleted,
  };
};
