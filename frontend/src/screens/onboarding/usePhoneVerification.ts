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

// How long a U28 code lives (users.md U28 expiresInSec), for a send whose answer was lost.
const CODE_LIFETIME_SEC = 180;

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
    // U28·U29 (users.md, S15P31E105-560).
    case 'PHONE_ACCOUNT_AMBIGUOUS':
      return {
        field: 'phone',
        message:
          '이 번호로 가입한 계정이 여러 개라 비밀번호를 찾을 수 없어요. 아이디로 로그인해 주세요.',
      };
    case 'VERIFICATION_RESEND_TOO_SOON':
      return {
        field: 'phone',
        message: '인증번호는 잠시 후에 다시 받을 수 있어요.',
      };
    case 'VERIFICATION_SEND_LIMIT_EXCEEDED':
      return {
        field: 'phone',
        message: '인증번호 요청 횟수를 넘었어요. 내일 다시 시도해 주세요.',
      };
    case 'SMS_UNAVAILABLE':
      return {
        field: 'phone',
        message:
          '인증번호를 보내지 못했을 수 있어요. 문자가 왔다면 입력하고, 오지 않았다면 잠시 후 다시 받아 주세요.',
      };
    default:
      return { field: 'phone', message: '잠시 후 다시 시도해 주세요.' };
  }
}

// Phone → code → verified, shared by 1.3 회원가입 and 1.2q 비밀번호 찾기.
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
    // A code already on screen is still live on the server unless a new one replaces it (users.md U28).
    const hadCode = phase === 'sent' || phase === 'verifying';
    setPhase('requesting');
    setError(null);
    const startOver = (seconds: number) => {
      setCodeDigits('');
      setLocked(false);
      setRemainingSec(seconds);
      setPhase('sent');
    };
    try {
      const { expiresInSec } = await auth.requestPhoneCode({
        phoneNumber,
        purpose,
      });
      if (mounted.current) {
        startOver(expiresInSec);
      }
    } catch (caught) {
      if (!mounted.current) {
        return;
      }
      setError(messageFor(caught));
      const failure = errorCode(caught);
      // An unclear send may still deliver a new code, which the server keeps (users.md U28), so the field opens
      // for it instead of pushing another paid SMS (review R-2).
      if (failure === 'SMS_UNAVAILABLE') {
        startOver(CODE_LIFETIME_SEC);
        return;
      }
      // Too soon or over the limit: nothing new was stored, so the code on screen still works.
      if (
        hadCode &&
        (failure === 'VERIFICATION_RESEND_TOO_SOON' ||
          failure === 'VERIFICATION_SEND_LIMIT_EXCEEDED')
      ) {
        setPhase('sent');
        return;
      }
      setCodeDigits('');
      setLocked(false);
      setPhase('idle');
    }
  }, [auth, phase, phoneNumber, purpose]);

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
          const failure = errorCode(caught);
          setError(messageFor(caught));
          // U29 tells the registration state only after a correct code. The server has used up the code,
          // so the screen goes back to the number step (users.md U29, S15P31E105-560 review R-1).
          if (
            failure === 'PHONE_ALREADY_REGISTERED' ||
            failure === 'PHONE_NOT_REGISTERED' ||
            failure === 'PHONE_ACCOUNT_AMBIGUOUS'
          ) {
            setPhase('idle');
            setCodeDigits('');
            return;
          }
          setPhase('sent');
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

  // The proof was used up or can no longer be trusted (U30 failed after taking it): back to the number step so a new
  // code can be requested (S15P31E105-560 review R-3). Registration answers keep their own message.
  const restart = useCallback((caught: unknown) => {
    const failure = errorCode(caught);
    setToken(null);
    setCodeDigits('');
    setLocked(false);
    setPhase('idle');
    setError(
      failure === 'PHONE_NOT_REGISTERED' ||
        failure === 'PHONE_ACCOUNT_AMBIGUOUS'
        ? messageFor(caught)
        : {
            field: 'phone',
            code: failure,
            message: '비밀번호를 바꾸지 못했어요. 인증번호를 다시 받아 주세요.',
          },
    );
  }, []);

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
    restart,
  };
}

export function formatRemaining(seconds: number) {
  const value = Math.max(seconds, 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(
    value % 60,
  ).padStart(2, '0')}`;
}
