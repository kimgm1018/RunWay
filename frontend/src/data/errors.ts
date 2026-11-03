// Error codes the screens react to. Auth codes follow docs/design/api/users.md; phone codes have no spec yet.
// A list rather than a bare union so server responses can be checked against it (src/data/api/http.ts).
export const dataErrorCodes = [
  'INVALID_CREDENTIALS',
  'LOGIN_LOCKED',
  'LOGIN_ID_DUPLICATED',
  // U15 회원가입.
  'NICKNAME_DUPLICATED',
  'INVALID_PROFILE',
  'INVALID_PASSWORD_POLICY',
  'INVALID_CONSENT',
  // U16 아이디 확인: more than 60 checks a minute from one IP.
  'TOO_MANY_REQUESTS',
  // U06·U07 러닝 프로필.
  'PROFILE_NOT_SET',
  'INVALID_LEVEL',
  'INVALID_RUNNING_BASELINE',
  'PHONE_NOT_REGISTERED',
  'PHONE_ALREADY_REGISTERED',
  'VERIFICATION_CODE_MISMATCH',
  'VERIFICATION_ATTEMPTS_EXCEEDED',
  'VERIFICATION_EXPIRED',
  // H02 러닝 기록 상세 (docs/design/api/running-records.md).
  'RECORD_NOT_FOUND',
  // M04·M06 크루 정원 초과 (docs/design/api/crews.md).
  'CREW_CAPACITY_EXCEEDED',
  // M02–M08 크루.
  'CREW_NOT_FOUND',
  'ALREADY_MEMBER_OR_PENDING',
  'NOT_PENDING',
  'OWNER_CANNOT_LEAVE',
  // G03–G06 그룹런.
  'GROUP_NOT_FOUND',
  'FULL_OR_ALREADY_JOINED',
  'EDIT_NOT_ALLOWED',
  // CMT08 · CMT09 댓글 수정·삭제 (docs/design/api/community.md).
  'EMPTY_COMMENT',
  'NOT_AUTHOR',
  'COMMENT_NOT_FOUND',
  // U18 탈퇴 비밀번호 불일치.
  'INVALID_PASSWORD',
  // S01~S08 러닝 세션 제어 (docs/design/api/sessions.md, S15P31E105-256).
  'SESSION_NOT_FOUND',
  'SESSION_FORBIDDEN',
  'DEVICE_FORBIDDEN',
  'ACTIVE_SESSION_EXISTS',
  'STALE_STATE',
  'COMMAND_PENDING',
  'COMMAND_CONFLICT',
  'COMMAND_NOT_FOUND',
  'INVALID_SESSION_STATE',
  'INVALID_STATE',
  'CONTROL_DEVICE_CHANGED',
  'UPLOAD_PENDING',
  'COURSE_INACCESSIBLE',
  // W07 워치 운동 배치 동기화: 같은 ID의 다른 내용, 본문 규칙 위반 (S15P31E105-311).
  'BATCH_HASH_CONFLICT',
  'INVALID_BATCH',
  // W06 건강 기록 동기화 (docs/design/api/devices-health.md). R02 answers it too.
  'CONSENT_REQUIRED',
  // R02 최신 준비도: no result yet (docs/design/api/readiness.md).
  'ASSESSMENT_NOT_FOUND',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_RECORD_TYPE',
  // F01 이미지 업로드 (docs/design/api/files.md) and U05 with an imageId that is not my profile upload.
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_FILE',
  'INVALID_IMAGE',
  // 400 with the common VALIDATION_ERROR code: the server rejected the input format.
  'VALIDATION_ERROR',
  // 401 on a member API: the access token is missing, expired or rejected. The session signs out.
  'UNAUTHORIZED',
  // The request never got an answer: no connection or the timeout passed.
  'NETWORK_ERROR',
  // 5xx (INTERNAL_ERROR, SERVICE_UNAVAILABLE) without a domain code.
  'SERVER_ERROR',
  'UNKNOWN',
] as const;

export type DataErrorCode = (typeof dataErrorCodes)[number];

export class DataError extends Error {
  readonly code: DataErrorCode;
  // How many attempts have failed so far, when the server reports it (1.2 로그인 (2/5), 1.2s (1/5)).
  readonly failedCount: number | null;
  // HTTP status of the failed response; null when no response arrived or the error was made on the phone.
  readonly status: number | null;
  // 서버 오류 응답의 details(예: 409 ACTIVE_SESSION_EXISTS의 sessionId). 공통 요청 기반(S15P31E105-299)이 채운다.
  readonly details: Record<string, unknown> | null;

  constructor(
    code: DataErrorCode,
    message: string,
    failedCount: number | null = null,
    status: number | null = null,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.failedCount = failedCount;
    this.status = status;
    this.details = details;
  }
}

export function errorCode(error: unknown): DataErrorCode {
  return error instanceof DataError ? error.code : 'UNKNOWN';
}
