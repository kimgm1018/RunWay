import type {
  AuthSession,
  LoginIdAvailability,
  Repositories,
  SignUpRequest,
} from '../types';
import { apiRequest } from './http';

// U01·U15 response (docs/design/api/users.md).
type SessionResponse = {
  user: { id: number; loginId: string };
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresAt: string;
  onboardingCompleted: boolean;
};

function toSession(response: SessionResponse): AuthSession {
  return {
    user: response.user,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    refreshExpiresAt: response.refreshExpiresAt,
    onboardingCompleted: response.onboardingCompleted,
  };
}

// U01 로그인. Wrong credentials come back as INVALID_CREDENTIALS, five in a row as LOGIN_LOCKED.
export const login: Repositories['auth']['login'] = async ({
  loginId,
  password,
}) =>
  toSession(
    await apiRequest<SessionResponse>('/auth/login', {
      method: 'POST',
      body: { loginId, password },
      auth: false,
    }),
  );

// U16 아이디 사용 가능 여부. Checking does not reserve the ID; U15 decides.
export const checkLoginId: Repositories['auth']['checkLoginId'] = loginId =>
  apiRequest<LoginIdAvailability>('/auth/login-id/availability', {
    query: { loginId },
    auth: false,
  });

// U03 로그아웃. Sent without the access token so an expired one does not stop it; 5 seconds at most, since
// the user is waiting to leave (S15P31E105-393). Unknown or already revoked tokens also get 204.
export const logout: Repositories['auth']['logout'] = async refreshToken => {
  await apiRequest<void>('/auth/logout', {
    method: 'POST',
    body: { refreshToken },
    auth: false,
    timeoutMs: 5_000,
  });
};

// U15 회원가입. 1.4 only lets the user continue once the three required consents are given,
// so they go as granted and health data follows the user's choice.
export const signUp: Repositories['auth']['signUp'] = async ({
  healthDataAccess,
  ...request
}: SignUpRequest) =>
  toSession(
    await apiRequest<SessionResponse>('/auth/signup', {
      method: 'POST',
      body: {
        ...request,
        consents: [
          { consentType: 'TERMS_OF_SERVICE', granted: true },
          { consentType: 'PERSONAL_INFO', granted: true },
          { consentType: 'LOCATION_DATA', granted: true },
          {
            consentType: 'HEALTH_DATA',
            granted: healthDataAccess === 'AGREEE',
          },
        ],
      },
      auth: false,
    }),
  );
