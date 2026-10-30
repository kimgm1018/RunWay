import React, { createContext, useContext, useMemo, useState } from 'react';
import { setWatchHealthConsent } from '../health/watchHealth';

type SessionValue = {
  signedIn: boolean;
  signIn: () => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

// Holds only whether the user is signed in; tokens and persistence come with the auth API.
export function SessionProvider({
  children,
  initialSignedIn = false,
}: {
  children: React.ReactNode;
  initialSignedIn?: boolean;
}) {
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const value = useMemo(
    () => ({
      signedIn,
      signIn: () => setSignedIn(true),
      signOut: () => {
        // Fire and forget: withdraw consent on the watch and clear its records.
        void setWatchHealthConsent('DISAGREE');
        setSignedIn(false);
      },
    }),
    [signedIn],
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
