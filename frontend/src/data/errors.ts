// Error codes the screens react to. Auth and phone verification codes follow docs/design/api/users.md (U28~U30).
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
  // U28~U30 휴대전화 인증·비밀번호 재설정 (users.md, S15P31E105-560).
  'PHONE_NOT_REGISTERED',
  'PHONE_ALREADY_REGISTERED',
  'PHONE_ACCOUNT_AMBIGUOUS',
  'VERIFICATION_CODE_MISMATCH',
  'VERIFICATION_ATTEMPTS_EXCEEDED',
  'VERIFICATION_EXPIRED',
  'VERIFICATION_RESEND_TOO_SOON',
  'VERIFICATION_SEND_LIMIT_EXCEEDED',
  'SMS_UNAVAILABLE',
  // H02 러닝 기록 상세 (docs/design/api/running-records.md).
  'RECORD_NOT_FOUND',
  // M04·M06 크루 정원 초과 (docs/design/api/crews.md).
  'CREW_CAPACITY_EXCEEDED',
  // M12 크루 설정 변경: the new capacity is under the current member count (S15P31E105-570).
  'CREW_CAPACITY_BELOW_MEMBERS',
  // M02–M08 크루.
  'CREW_NOT_FOUND',
  // CMT13 통합 검색: the query is under the server's minimum length.
  'QUERY_TOO_SHORT',
  // U21–U23 러너 프로필·팔로우: the runner is gone or withdrew, or I tried to follow myself.
  'USER_NOT_FOUND',
  'CANNOT_FOLLOW_SELF',
  // U25 팔로우 요청 승인·거절: the request is gone, or was cancelled or answered meanwhile.
  'REQUEST_NOT_FOUND',
  'REQUEST_STATE_CONFLICT',
  // U26 · U27 팔로워 · 팔로잉: a private account I am not an approved follower of (S15P31E105-534).
  'ACCOUNT_ACCESS_DENIED',
  // C10 생성 코스 저장: the C01 route is older than 30 minutes or was changed (COURSE_INACCESSIBLE is listed above).
  'COURSE_CANDIDATE_INVALID',
  // M03 크루 대표 사진: the imageKey is not a CREW photo I uploaded myself.
  'RESOURCE_NOT_OWNED',
  // 4.5 결과: the run finished on the server, but its record could not be read back yet (S15P31E105-529).
  'SAVE_UNCONFIRMED',
  // A screen action the server has no API for yet, e.g. saving a free run as my course (S15P31E105-529).
  'NOT_AVAILABLE',
  'ALREADY_MEMBER_OR_PENDING',
  'NOT_PENDING',
  'OWNER_CANNOT_LEAVE',
  'INVALID_SUCCESSOR',
  'NOT_ADMIN',
  'CANNOT_REMOVE_OWNER',
  'MEMBER_NOT_FOUND',
  // G03–G06 그룹런.
  'GROUP_NOT_FOUND',
  'INVALID_GROUP_STATE',
  'NOT_PARTICIPANT',
  'NOT_HOST',
  'RUN_ALREADY_STARTED',
  'FULL_OR_ALREADY_JOINED',
  'EDIT_NOT_ALLOWED',
  // G01·G04 목표 환산 실패 (422).
  'INVALID_GOAL',
  // CMT08 · CMT09 댓글 수정·삭제 (docs/design/api/community.md).
  'EMPTY_COMMENT',
  'NOT_AUTHOR',
  'COMMENT_NOT_FOUND',
  // U18 탈퇴 비밀번호 불일치.
  'INVALID_PASSWORD',
  // U18 회원탈퇴 (users.md, S15P31E105-523): 먼저 정리할 크루·그룹런·운동이 있음(409), 동의 없음(422),
  // DB 탈퇴는 확정됐지만 이미지 정리 미완료(503, details.withdrawalCompleted).
  'WITHDRAWAL_CONFLICT',
  'AGREEMENT_REQUIRED',
  'IMAGE_CLEANUP_PENDING',
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
  // P07 폰으로 기록 전환(PHONE_FALLBACK) 뒤의 BPM 요청 (pace-coaching.md, S15P31E105-257).
  'COACHING_UNAVAILABLE',
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
  // 3.1 현재 위치 on the phone (S15P31E105-494): no permission, location off, no fix in time, no location at all.
  'LOCATION_PERMISSION_DENIED',
  'LOCATION_DISABLED',
  'LOCATION_TIMEOUT',
  'LOCATION_UNAVAILABLE',
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
