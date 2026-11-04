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
import { spotifyTokens } from '../data/spotify/auth';
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
  // Leaves on the phone only: a rejected token (401) and the end of 회원탈퇴 use it.
  signOut: () => void;
  // 설정 로그아웃: revokes the refresh token on the server (U03) first, then signs out on the phone.
  logOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

// Holds whether the user is signed in and keeps the server tokens. Token refresh (U02) comes with S15P31E105-194.
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
        setSignedIn(tokens !== null);
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
    spotifyTokens.clear().catch(() => {});
    setSignedIn(false);
  }, []);

  // Waits for U03 (5 seconds at most) so the server forgets the login, then leaves like signOut. A failed U03
  // still signs out here; revokeOnServer keeps the token for the next launch instead of calling it revoked.
  const logOut = useCallback(async () => {
    const refreshToken = tokenStore.current()?.refreshToken;
    if (refreshToken) {
      await revokeOnServer(auth.logout, refreshToken);
    }
    signOut();
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

  // An expired or rejected access token sends the user back to 1.2 로그인 until refresh lands.
  useEffect(() => onUnauthorized(signOut), [signOut]);

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
