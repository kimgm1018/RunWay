import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { onUnauthorized } from '../data/api/http';
import { tokenStore, type AuthTokens } from '../data/api/tokenStore';
import { setWatchHealthConsent } from '../health/watchHealth';

type SessionValue = {
  signedIn: boolean;
  // True until the saved tokens have been read on launch.
  restoring: boolean;
  // Keeps the tokens in the keystore and enters the app. Without tokens it keeps the held ones, if any.
  signIn: (tokens?: AuthTokens) => void;
  // For an account that still has to finish 1.6 러닝 프로필: requests can use the tokens, but a relaunch starts signed out
  // so the next U01 sends the user back to setup (users.md 초기 설정과 화면 분기).
  holdTokens: (tokens: AuthTokens) => void;
  signOut: () => void;
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
  }, []);

  const holdTokens = useCallback((tokens: AuthTokens) => {
    tokenStore.hold(tokens);
  }, []);

  const signOut = useCallback(() => {
    // Fire and forget: withdraw consent on the watch and clear its records.
    void setWatchHealthConsent('DISAGREE');
    tokenStore.clear().catch(() => {});
    setSignedIn(false);
  }, []);

  // An expired or rejected access token sends the user back to 1.2 로그인 until refresh lands.
  useEffect(() => onUnauthorized(signOut), [signOut]);

  const value = useMemo(
    () => ({ signedIn, restoring, signIn, holdTokens, signOut }),
    [signedIn, restoring, signIn, holdTokens, signOut],
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
