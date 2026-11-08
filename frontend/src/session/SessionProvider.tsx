import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert } from 'react-native';
import { appConfig } from '../config';
import { useRepositories } from '../data/DataProvider';
import { onUnauthorized } from '../data/api/http';
import { tokenStore, type AuthTokens } from '../data/api/tokenStore';
import { clearSpotifySession } from '../data/spotify/session';
import { serverHealthConsentReader } from '../health/serverHealthConsent';
import { useWatchDailyHrUpload } from '../health/useWatchDailyHrUpload';
import {
  refreshWatchHealthConsent,
  setWatchHealthConsent,
} from '../health/watchHealth';
import { retryPendingLogouts, revokeOnServer } from './serverLogout';

type SessionValue = {
  signedIn: boolean;
  // True until the saved tokens have been read on launch.
  restoring: boolean;
  loginRequired: boolean;
  // Called only before a new run, never from an expiry timer or a resume path.
  ensureRunLogin: () => boolean;
  // Keeps the tokens in the keystore and enters the app. Without tokens it keeps the held ones, if any.
  signIn: (tokens?: AuthTokens) => void;
  // For an account that still has to finish 1.6 러닝 프로필: requests can use the tokens, but a relaunch starts signed out
  // so the next U01 sends the user back to setup (users.md 초기 설정과 화면 분기).
  holdTokens: (tokens: AuthTokens) => void;
  // Explicit local sign-out and completed withdrawal clear watch health records.
  signOut: () => void;
  // 설정 로그아웃: revokes the refresh token on the server (U03) first, then signs out on the phone.
  logOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

// Holds the UI session; U02 rotation is shared by all HTTP callers.
export function SessionProvider({
  children,
  initialSignedIn = false,
}: {
  children: React.ReactNode;
  initialSignedIn?: boolean;
}) {
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const [restoring, setRestoring] = useState(!initialSignedIn);
  const [loginRequired, setLoginRequired] = useState(false);
  const { auth } = useRepositories();

  // S15P31E105-393: a logout whose U03 got no answer is sent again once per launch. Fire and forget.
  useEffect(() => {
    void retryPendingLogouts(auth.logout);
  }, [auth]);

  useEffect(() => {
    if (initialSignedIn) {
      return;
    }
    let active = true;
    tokenStore.load().then(tokens => {
      if (active) {
        // Older installs cannot identify the owner of pending daily HR. Reauthenticate once.
        const needsOwner =
          tokens !== null && appConfig.dataSource === 'api' && !tokens.userId;
        if (needsOwner) void tokenStore.clear().catch(() => {});
        setSignedIn(tokens !== null && !needsOwner);
        setLoginRequired(needsOwner);
        setRestoring(false);
      }
    });
    return () => {
      active = false;
    };
  }, [initialSignedIn]);

  const signIn = useCallback((tokens?: AuthTokens) => {
    const kept = tokens ?? tokenStore.current();
    if (kept) {
      // Fire and forget: the tokens are already in memory for this run.
      tokenStore.save(kept).catch(() => {});
    }
    setSignedIn(true);
    setLoginRequired(false);
  }, []);

  const ensureRunLogin = useCallback(() => {
    const kept = tokenStore.current();
    // The mock-only, initially signed-in preview has no server-issued credentials.
    if (!kept && appConfig.dataSource === 'mock') {
      return true;
    }
    const deadline = Date.parse(kept?.refreshExpiresAt ?? '');
    if (
      Number.isFinite(deadline) &&
      deadline - Date.now() >= 24 * 60 * 60 * 1000
    ) {
      return true;
    }
    Alert.alert(
      '러닝 전에 다시 로그인해 주세요',
      '운동 중 로그인 유지 기간이 끝나지 않도록, 다시 로그인한 뒤 러닝을 시작해 주세요.',
      [
        { text: '나중에', style: 'cancel' },
        {
          text: '다시 로그인',
          onPress: () => {
            // Reauthentication is not withdrawal of health-data consent.
            tokenStore.clear().catch(() => {});
            setLoginRequired(true);
            setSignedIn(false);
          },
        },
      ],
    );
    return false;
  }, []);

  const holdTokens = useCallback((tokens: AuthTokens) => {
    tokenStore.hold(tokens);
  }, []);

  const signOut = useCallback(() => {
    // Fire and forget: withdraw consent on the watch and clear its records.
    void setWatchHealthConsent('DISAGREE');
    tokenStore.clear().catch(() => {});
    // The next person on this phone should not inherit the Spotify account.
    clearSpotifySession().catch(() => {});
    setSignedIn(false);
  }, []);

  // Waits for U03 (5 seconds at most) so the server forgets the login, then leaves like signOut. A failed U03
  // still signs out here; revokeOnServer keeps the token for the next launch instead of calling it revoked.
  const logOut = useCallback(async () => {
    const refreshToken = tokenStore.current()?.refreshToken;
    // Invalidate pending U02 before waiting for U03. Old refresh tokens can revoke their family.
    void tokenStore.clear().catch(() => {});
    const leaving = tokenStore.session();
    if (refreshToken) {
      await revokeOnServer(auth.logout, refreshToken);
    }
    if (tokenStore.session() === leaving) signOut();
  }, [auth, signOut]);

  // S15P31E105-313: a login or a restored session hands the server's current consent (W05) to the watch, since
  // signOut left it at DISAGREE. If W05 cannot be read, only a saved consent whose delivery failed is re-sent.
  // Signed out, it runs once at launch for a failed withdrawal. Fire and forget: a failed refresh or a missing
  // watch never holds the sign-in.
  const launchChecked = useRef(false);
  useEffect(() => {
    if (restoring) {
      return;
    }
    if (signedIn || !launchChecked.current) {
      void refreshWatchHealthConsent(
        signedIn ? serverHealthConsentReader() : undefined,
      );
    }
    launchChecked.current = true;
  }, [signedIn, restoring]);

  // S15P31E105-281: the watch daily heart-rate estimate goes to W06 while signed in.
  useWatchDailyHrUpload(signedIn);

  // Session expiry is not health-consent withdrawal. Pending watch records survive reauthentication.
  const expireSession = useCallback(() => {
    clearSpotifySession().catch(() => {});
    setLoginRequired(true);
    setSignedIn(false);
  }, []);
  useEffect(() => onUnauthorized(expireSession), [expireSession]);

  const value = useMemo(
    () => ({
      signedIn,
      restoring,
      loginRequired,
      ensureRunLogin,
      signIn,
      holdTokens,
      signOut,
      logOut,
    }),
    [
      signedIn,
      restoring,
      loginRequired,
      ensureRunLogin,
      signIn,
      holdTokens,
      signOut,
      logOut,
    ],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}
