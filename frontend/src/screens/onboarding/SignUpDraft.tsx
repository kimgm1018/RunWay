import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { BasicProfile, HealthDataAccess } from '../../data';
import { useSession } from '../../session/SessionProvider';

// U15 creates the account only once every required value is in, so 1.3–1.5 collect them here first.
export type SignUpDraft = {
  loginId: string;
  password: string;
  phoneNumber: string;
  healthDataAccess: HealthDataAccess;
  profile: BasicProfile | null;
  // Set after U15 succeeds; going back to 1.5 then updates the profile instead of signing up again.
  accountCreated: boolean;
};

const emptyDraft: SignUpDraft = {
  loginId: '',
  password: '',
  phoneNumber: '',
  healthDataAccess: 'DISAGREE',
  profile: null,
  accountCreated: false,
};

type SignUpDraftValue = {
  draft: SignUpDraft;
  update: (changes: Partial<SignUpDraft>) => void;
  reset: () => void;
};

const SignUpDraftContext = createContext<SignUpDraftValue | null>(null);

export function SignUpDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const update = useCallback(
    (changes: Partial<SignUpDraft>) =>
      setDraft(current => ({ ...current, ...changes })),
    [],
  );
  const reset = useCallback(() => setDraft(emptyDraft), []);
  const value = useMemo(
    () => ({ draft, update, reset }),
    [draft, update, reset],
  );
  return (
    <SignUpDraftContext.Provider value={value}>
      {children}
    </SignUpDraftContext.Provider>
  );
}

export function useSignUpDraft() {
  const value = useContext(SignUpDraftContext);
  if (!value) {
    throw new Error('useSignUpDraft must be used inside SignUpDraftProvider');
  }
  return value;
}

// Last step of onboarding (1.6w 휴대폰만, 1.7 시작하기): drop the draft and enter 2.1 홈.
export function useFinishOnboarding() {
  const { reset } = useSignUpDraft();
  const { signIn } = useSession();
  return useCallback(() => {
    reset();
    signIn();
  }, [reset, signIn]);
}
