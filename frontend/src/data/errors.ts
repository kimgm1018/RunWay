// Error codes the screens react to. Auth codes follow docs/design/api/users.md; phone codes have no spec yet.
export type DataErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'LOGIN_LOCKED'
  | 'LOGIN_ID_DUPLICATED'
  | 'PHONE_NOT_REGISTERED'
  | 'PHONE_ALREADY_REGISTERED'
  | 'VERIFICATION_CODE_MISMATCH'
  | 'VERIFICATION_ATTEMPTS_EXCEEDED'
  | 'VERIFICATION_EXPIRED'
  // H02 러닝 기록 상세 (docs/design/api/running-records.md).
  | 'RECORD_NOT_FOUND'
  // M04·M06 크루 정원 초과 (docs/design/api/crews.md).
  | 'CREW_CAPACITY_EXCEEDED'
  // U18 탈퇴 비밀번호 불일치.
  | 'INVALID_PASSWORD'
  | 'UNKNOWN';

export class DataError extends Error {
  readonly code: DataErrorCode;
  // How many attempts have failed so far, when the server reports it (1.2 로그인 (2/5), 1.2s (1/5)).
  readonly failedCount: number | null;

  constructor(
    code: DataErrorCode,
    message: string,
    failedCount: number | null = null,
  ) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.failedCount = failedCount;
  }
}

export function errorCode(error: unknown): DataErrorCode {
  return error instanceof DataError ? error.code : 'UNKNOWN';
}
