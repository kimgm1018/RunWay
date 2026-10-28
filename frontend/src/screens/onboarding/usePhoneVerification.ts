import { useCallback, useEffect, useRef, useState } from 'react';
import {
  errorCode,
  useRepositories,
  DataError,
  type DataErrorCode,
  type PhoneVerificationPurpose,
} from '../../data';
import {
  digitsOnly,
  isValidPhoneNumber,
  isValidVerificationCode,
} from './validation';

export type VerificationPhase =
  | 'idle'
  | 'requesting'
  | 'sent'
  | 'verifying'
  | 'verified';

type FieldError = {
  field: 'phone' | 'code';
  message: string;
  code: DataErrorCode;
};

function messageFor(error: unknown): FieldError {
  const code = errorCode(error);
  return { ...describe(code, error), code };
}

function describe(
  code: DataErrorCode,
  error: unknown,
): Omit<FieldError, 'code'> {
  switch (code) {
    case 'PHONE_NOT_REGISTERED':
      return {
        field: 'phone',
        message:
          '가입되지 않은 전화번호예요. 번호를 다시 확인하거나 새로 가입해 주세요.',
      };
    case 'PHONE_ALREADY_REGISTERED':
      return {
        field: 'phone',
        message: '이미 가입된 전화번호예요. 로그인하거나 비밀번호를 찾아 주세요.',
      };
    case 'VERIFICATION_CODE_MISMATCH': {
      const count = error instanceof DataError ? error.failedCount : null;
      return {
        field: 'code',
        message: `인증번호가 맞지 않아요. 다시 입력해 주세요${
          count ? ` (${count}/5)` : ''
        }`,
      };
    }
    case 'VERIFICATION_ATTEMPTS_EXCEEDED':
      return {
        field: 'code',
        message: '인증번호를 5회 틀렸어요. 인증번호를 다시 받아 주세요.',
      };
    case 'VERIFICATION_EXPIRED':
      return {
        field: 'code',
        message: '인증 시간이 지났어요. 인증번호를 다시 받아 주세요.',
      };
    default:
      return { field: 'phone', message: '잠시 후 다시 시도해 주세요.' };
  }
}

// Phone → code → verified, shared by 1.3 회원가입 and 1.2q 전화번호로 찾기.
export function usePhoneVerification(purpose: PhoneVerificationPurpose) {
  const { auth } = useRepositories();
  const [phoneNumber, setPhoneDigits] = useState('');
  const [code, setCodeDigits] = useState('');
  const [phase, setPhase] = useState<VerificationPhase>('idle');
  const [remainingSec, setRemainingSec] = useState(0);
  const [error, setError] = useState<FieldError | null>(null);
  // Verification is locked after five misses until a new code is sent.
  const [locked, setLocked] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const counting = phase === 'sent' || phase === 'verifying';
  useEffect(() => {
    if (!counting || remainingSec <= 0) {
      return;
    }
    const timer = setTimeout(() => setRemainingSec(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [counting, remainingSec]);
  const expired = phase === 'sent' && remainingSec <= 0;

  const setPhoneNumber = useCallback(
    (text: string) => {
      const digits = digitsOnly(text).slice(0, 11);
      // Keyboards can resend the same text (or only the dashes change); that must not undo a sent code.
      if (digits === phoneNumber) {
        return;
      }
      setPhoneDigits(digits);
      // A changed number needs a fresh code.
      setPhase('idle');
      setCodeDigits('');
      setToken(null);
      setLocked(false);
      setError(null);
    },
    [phoneNumber],
  );

  const request = useCallback(async () => {
    setPhase('requesting');
    setError(null);
    setCodeDigits('');
    setLocked(false);
    try {
      const { expiresInSec } = await auth.requestPhoneCode({
        phoneNumber,
        purpose,
      });
      if (mounted.current) {
        setRemainingSec(expiresInSec);
        setPhase('sent');
      }
    } catch (caught) {
      if (mounted.current) {
        setPhase('idle');
        setError(messageFor(caught));
      }
    }
  }, [auth, phoneNumber, purpose]);

  const verify = useCallback(
    async (value: string) => {
      setPhase('verifying');
      setError(null);
      try {
        const result = await auth.verifyPhoneCode({
          phoneNumber,
          purpose,
          code: value,
        });
        if (mounted.current) {
          setToken(result.verificationToken);
          setPhase('verified');
        }
      } catch (caught) {
        if (mounted.current) {
          setPhase('sent');
          setError(messageFor(caught));
          const failure = errorCode(caught);
          if (
            failure === 'VERIFICATION_ATTEMPTS_EXCEEDED' ||
            failure === 'VERIFICATION_EXPIRED'
          ) {
            setLocked(true);
          }
        }
      }
    },
    [auth, phoneNumber, purpose],
  );

  const setCode = useCallback(
    (text: string) => {
      const value = digitsOnly(text).slice(0, 6);
      setCodeDigits(value);
      if (phase === 'sent' && !locked && isValidVerificationCode(value)) {
        verify(value);
      }
    },
    [locked, phase, verify],
  );

  return {
    phoneNumber,
    setPhoneNumber,
    phoneValid: isValidPhoneNumber(phoneNumber),
    code,
    setCode,
    phase,
    remainingSec,
    expired,
    // The code field stays editable only while a live code can still be checked.
    codeEditable: phase === 'sent' && !locked && !expired,
    error: expired
      ? messageFor(new DataError('VERIFICATION_EXPIRED', '인증 시간 만료'))
      : error,
    token,
    request,
  };
}

export function formatRemaining(seconds: number) {
  const value = Math.max(seconds, 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(
    value % 60,
  ).padStart(2, '0')}`;
}
