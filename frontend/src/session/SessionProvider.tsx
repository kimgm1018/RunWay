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
  // Pass the U01·U15 tokens so they are kept in the keystore; mock sign-ins have none.
  signIn: (tokens?: AuthTokens) => void;
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
    if (tokens) {
      // Fire and forget: the tokens are already in memory for this run.
      tokenStore.save(tokens).catch(() => {});
    }
    setSignedIn(true);
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
    () => ({ signedIn, restoring, signIn, signOut }),
    [signedIn, restoring, signIn, signOut],
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
